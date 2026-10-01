// The note model: a parsed document plus a key index. Every change is an Operation on
// stable runtime keys (never indexes), so the same operations drive undo, autosave, sync,
// and later real-time collaboration.

import {
	type BlockNode,
	type FormatOption,
	type NoteDocument,
	type PropertyValue,
	cloneValue,
	createKey,
	ensureNoteProperty,
	getSectionValue,
	indentText,
	markChanged,
	markChildChanged,
	ownSourceText,
	parseNote,
	readSource,
	relevel,
	serializeDocument,
	setSectionValue,
	valueEqual,
	walkNode,
} from '@octaether/core-format';

export type Operation =
	| { kind: 'Block.Insert'; parentKey: string | null; afterKey: string | null; node: BlockNode }
	| { kind: 'Block.Delete'; key: string }
	| { kind: 'Block.Move'; key: string; parentKey: string | null; afterKey: string | null }
	| { kind: 'Block.Body.Set'; key: string; body: string }
	| { kind: 'Block.Property.Set'; key: string; name: string; value: PropertyValue | undefined }
	/** A block's own source (its header and body at level 0, not its children): the type, properties, and body at once. */
	| { kind: 'Block.Source.Set'; key: string; text: string }
	| { kind: 'Note.Property.Set'; name: string; value: PropertyValue | undefined }
	/** The whole note as text (the source view); unchanged blocks keep their keys. */
	| { kind: 'Note.Text.Set'; text: string };

export type ChangeOrigin = 'Local' | 'Undo' | 'Redo' | 'Remote';

export interface Change {
	/** Blocks whose own content or properties changed. */
	changedKeySet: Set<string>;
	/** Blocks were inserted, deleted, or moved. */
	structure: boolean;
	notePropertyChanged: boolean;
	origin: ChangeOrigin;
	operationList: Operation[];
}

/**
 * A step in the note's history that isn't a text change, such as renaming the note's file. Undo
 * and redo call it, in order with the edits around it.
 */
export interface HistoryAction {
	label: string;
	undo(): void;
	redo(): void;
}

interface Transaction {
	forwardList: Operation[];
	inverseList: Operation[];
	coalesceKey: string | undefined;
	time: number;
	action?: HistoryAction;
}

export interface TransactOption {
	/** Consecutive transactions with the same key within 1 s merge into one undo step (typing). */
	coalesceKey?: string;
}

export class ModelError extends Error {}

const coalesceMs = 1000;

/** Bodies can't end with blank lines or hold whitespace-only lines (they would not survive a save). */
export function normalizeBody(body: string): string {
	return body
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => (line.trim() === '' ? '' : line))
		.join('\n')
		.replace(/\n+$/, '');
}

/** Gives freshly parsed blocks the keys of old blocks with the same text, so their frames stay as they are. */
function reuseKey(oldList: readonly BlockNode[], newList: readonly BlockNode[]): void {
	const text = (node: BlockNode): string => `${node.level}|${(node.rawLineList ?? []).join('\n')}`;
	const poolMap = new Map<string, BlockNode[]>();
	for (const node of oldList) {
		if (!node.rawLineList) continue;
		const pool = poolMap.get(text(node)) ?? [];
		pool.push(node);
		poolMap.set(text(node), pool);
	}
	const copy = (from: BlockNode, to: BlockNode): void => {
		to.key = from.key;
		from.childList.forEach((child, index) => {
			const target = to.childList[index];
			if (target) copy(child, target);
		});
	};
	for (const node of newList) {
		const match = poolMap.get(text(node))?.shift();
		if (match) copy(match, node);
	}
}

export class NoteModel {
	readonly document: NoteDocument;
	readonly option: FormatOption;
	/** Increases on every change; compare with a saved revision to know whether the note is dirty. */
	revision = 0;
	private readonly nodeMap = new Map<string, BlockNode>();
	private readonly parentMap = new Map<string, BlockNode | null>();
	private readonly undoList: Transaction[] = [];
	private readonly redoList: Transaction[] = [];
	private readonly listenerSet = new Set<(change: Change) => void>();
	private batch: { forwardList: Operation[]; inverseList: Operation[]; change: Change } | undefined;

	constructor(document: NoteDocument, option: FormatOption = {}) {
		this.document = document;
		this.option = option;
		this.reindex();
	}

	static fromText(text: string, option: FormatOption = {}): NoteModel {
		return new NoteModel(parseNote(text, option), option);
	}

	/** Parses OI source (a template or pasted text) into blocks ready to insert. */
	parseFragment(text: string): BlockNode[] {
		return parseNote(text, this.option).itemList;
	}

	/** Adds missing `Id` / `Format` note properties; returns true when the note changed. */
	ensureNoteProperty(): boolean {
		const changed = ensureNoteProperty(this.document);
		if (changed) this.revision++;
		return changed;
	}

	serialize(): string {
		return serializeDocument(this.document, this.option);
	}

	// ------------------------------------------------------------ read

	get(key: string): BlockNode | undefined {
		return this.nodeMap.get(key);
	}

	parentOf(key: string): BlockNode | null | undefined {
		return this.parentMap.get(key);
	}

	childListOf(parentKey: string | null): BlockNode[] {
		if (parentKey === null) return this.document.itemList;
		const parent = this.nodeMap.get(parentKey);
		if (!parent || parent.content !== 'Item') throw new ModelError(`"${parentKey}" cannot hold blocks`);
		return parent.childList;
	}

	/** Where a block sits: its parent key, its sibling list, and its index there. */
	placeOf(key: string): { parentKey: string | null; list: BlockNode[]; index: number } {
		const node = this.require(key);
		const parent = this.parentMap.get(key) ?? null;
		const list = parent ? parent.childList : this.document.itemList;
		return { parentKey: parent?.key ?? null, list, index: list.indexOf(node) };
	}

	bodyOf(key: string): string {
		return this.require(key).body;
	}

	noteProperty(name: string): PropertyValue | undefined {
		return this.document.front ? getSectionValue(this.document.front, name) : undefined;
	}

	keyList(): string[] {
		return [...this.nodeMap.keys()];
	}

	// ------------------------------------------------------------ write

	subscribe(listener: (change: Change) => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	setBody(key: string, body: string, option: TransactOption = {}): void {
		this.transact(() => this.apply({ kind: 'Block.Body.Set', key, body }), option);
	}

	setProperty(key: string, name: string, value: PropertyValue | undefined, option: TransactOption = {}): void {
		this.transact(() => this.apply({ kind: 'Block.Property.Set', key, name, value }), option);
	}

	setNoteProperty(name: string, value: PropertyValue | undefined): void {
		this.transact(() => this.apply({ kind: 'Note.Property.Set', name, value }));
	}

	/** A block's own source as the block editor shows it (header and body, at level 0). */
	sourceOf(key: string): string {
		return ownSourceText(this.require(key), this.option);
	}

	/**
	 * Replaces a block's own source (`Math: x^2` → `Chem: H_2O`): its type, properties, and body
	 * change at once and its lines are kept as typed. The text must be one block with nothing
	 * inside it; a block that holds others can only become a type that holds blocks.
	 */
	setSource(key: string, text: string, option: TransactOption = {}): void {
		this.transact(() => this.apply({ kind: 'Block.Source.Set', key, text }), option);
	}

	/**
	 * Reads the note again with the current format option (an alias was switched on or off).
	 * Blocks that read the same keep their keys; the history is kept only when every block did.
	 */
	reparse(): void {
		const text = this.serialize();
		const next = parseNote(text, this.option);
		const oldKeySet = new Set(this.nodeMap.keys());
		reuseKey(this.document.itemList, next.itemList);
		Object.assign(this.document, { front: next.front, itemList: next.itemList, tailLineList: next.tailLineList, problemList: next.problemList });
		this.reindex();
		if ([...oldKeySet].some((key) => !this.nodeMap.has(key))) {
			this.undoList.length = 0;
			this.redoList.length = 0;
		}
		const change: Change = { changedKeySet: new Set(), structure: true, notePropertyChanged: true, origin: 'Remote', operationList: [] };
		for (const listener of this.listenerSet) listener(change);
	}

	/** Replaces the whole note from source text as one undo step (blocks that didn't change keep their keys). */
	setText(text: string, option: TransactOption = {}): void {
		if (text === this.serialize()) return;
		this.transact(() => this.apply({ kind: 'Note.Text.Set', text }), option);
	}

	/** Inserts a block (and its children) after `afterKey` in `parentKey` (null = the note); returns its key. */
	insert(parentKey: string | null, afterKey: string | null, node: BlockNode): string {
		let key = '';
		this.transact(() => {
			const prepared = this.prepareInsert(node);
			key = prepared.key;
			this.apply({ kind: 'Block.Insert', parentKey, afterKey, node: prepared });
		});
		return key;
	}

	delete(key: string): void {
		this.transact(() => this.apply({ kind: 'Block.Delete', key }));
	}

	move(key: string, parentKey: string | null, afterKey: string | null): void {
		this.transact(() => this.apply({ kind: 'Block.Move', key, parentKey, afterKey }));
	}

	/** Runs `work` as one undo step and emits one change. Nested calls join the outer one; errors roll back. */
	transact(work: () => void, option: TransactOption = {}, origin: ChangeOrigin = 'Local'): void {
		if (this.batch) {
			work();
			return;
		}
		const change: Change = { changedKeySet: new Set(), structure: false, notePropertyChanged: false, origin, operationList: [] };
		const batch = { forwardList: [] as Operation[], inverseList: [] as Operation[], change };
		this.batch = batch;
		try {
			work();
		} catch (error) {
			for (const inverse of [...batch.inverseList].reverse()) this.applyRaw(inverse);
			throw error;
		} finally {
			this.batch = undefined;
		}
		if (batch.forwardList.length > 0) this.finish(batch, option, origin);
	}

	/** Applies one operation (local edit, undo, or a remote peer) and returns its inverse. */
	apply(operation: Operation): Operation {
		const inverse = this.applyRaw(operation);
		if (this.batch) {
			this.batch.forwardList.push(operation);
			this.batch.inverseList.push(inverse);
			this.batch.change.operationList.push(operation);
			if (operation.kind === 'Block.Body.Set' || operation.kind === 'Block.Property.Set' || operation.kind === 'Block.Source.Set') this.batch.change.changedKeySet.add(operation.key);
			else if (operation.kind === 'Note.Property.Set') this.batch.change.notePropertyChanged = true;
			else if (operation.kind === 'Note.Text.Set') {
				this.batch.change.structure = true;
				this.batch.change.notePropertyChanged = true;
			} else this.batch.change.structure = true;
		}
		return inverse;
	}

	/** Adds a step that isn't a text change (renaming the file) to the history; it is done already. */
	record(action: HistoryAction): void {
		this.undoList.push({ forwardList: [], inverseList: [], coalesceKey: undefined, time: Date.now(), action });
		this.redoList.length = 0;
	}

	/** The label of the step Undo would take back, when it isn't a text change. */
	undoAction(): string | undefined {
		return this.undoList[this.undoList.length - 1]?.action?.label;
	}

	undo(): boolean {
		const transaction = this.undoList.pop();
		if (!transaction) return false;
		if (transaction.action) {
			transaction.action.undo();
			this.redoList.push(transaction);
			return true;
		}
		this.transact(() => {
			for (const operation of [...transaction.inverseList].reverse()) this.apply(operation);
		}, {}, 'Undo');
		this.redoList.push({ ...transaction, coalesceKey: undefined, time: 0 });
		return true;
	}

	redo(): boolean {
		const transaction = this.redoList.pop();
		if (!transaction) return false;
		if (transaction.action) {
			transaction.action.redo();
			this.undoList.push(transaction);
			return true;
		}
		this.transact(() => {
			for (const operation of transaction.forwardList) this.apply(operation);
		}, {}, 'Redo');
		this.undoList.push({ ...transaction, coalesceKey: undefined, time: 0 });
		return true;
	}

	canUndo(): boolean {
		return this.undoList.length > 0;
	}

	canRedo(): boolean {
		return this.redoList.length > 0;
	}

	// ------------------------------------------------------------ internals

	private finish(batch: { forwardList: Operation[]; inverseList: Operation[]; change: Change }, option: TransactOption, origin: ChangeOrigin): void {
		this.revision++;
		if (origin === 'Local') {
			const now = Date.now();
			const last = this.undoList[this.undoList.length - 1];
			if (option.coalesceKey && last && last.coalesceKey === option.coalesceKey && now - last.time < coalesceMs) {
				last.forwardList.push(...batch.forwardList);
				last.inverseList.push(...batch.inverseList);
				last.time = now;
			} else {
				this.undoList.push({ forwardList: batch.forwardList, inverseList: batch.inverseList, coalesceKey: option.coalesceKey, time: now });
			}
			this.redoList.length = 0;
		}
		for (const listener of this.listenerSet) listener(batch.change);
	}

	private require(key: string): BlockNode {
		const node = this.nodeMap.get(key);
		if (!node) throw new ModelError(`no block with key "${key}"`);
		return node;
	}

	private reindex(): void {
		this.nodeMap.clear();
		this.parentMap.clear();
		walkNode(this.document.itemList, (node, parent) => {
			this.nodeMap.set(node.key, node);
			this.parentMap.set(node.key, parent ?? null);
		});
	}

	/** A deep copy whose keys are fresh where they would collide with blocks already in the note. */
	private prepareInsert(node: BlockNode): BlockNode {
		const copy = structuredClone(node);
		walkNode([copy], (item) => {
			if (this.nodeMap.has(item.key)) item.key = createKey();
		});
		return copy;
	}

	private listFor(parentKey: string | null): { list: BlockNode[]; level: number; parent: BlockNode | undefined } {
		if (parentKey === null) return { list: this.document.itemList, level: 0, parent: undefined };
		const parent = this.require(parentKey);
		if (parent.content !== 'Item') throw new ModelError(`a ${parent.type} block cannot hold blocks`);
		return { list: parent.childList, level: parent.level + 1, parent };
	}

	private place(parentKey: string | null, afterKey: string | null, node: BlockNode): void {
		const { list, level, parent } = this.listFor(parentKey);
		let index = 0;
		if (afterKey !== null) {
			index = list.findIndex((item) => item.key === afterKey) + 1;
			if (index === 0) throw new ModelError(`no sibling "${afterKey}" in the target list`);
		}
		relevel(node, level);
		// a moved block keeps its blank lines only where they still make sense
		if (index === 0 || (node.gapLineList && node.gapLineList.length === 0)) node.gapLineList = undefined;
		const next = list[index];
		if (next && next.gapLineList && next.gapLineList.length === 0) next.gapLineList = undefined;
		list.splice(index, 0, node);
		markChildChanged(this.document, parent);
	}

	private applyRaw(operation: Operation): Operation {
		switch (operation.kind) {
			case 'Block.Body.Set': {
				const node = this.require(operation.key);
				const body = normalizeBody(operation.body);
				const previous = node.body;
				if (body !== previous) {
					node.body = body;
					markChanged(this.document, node);
				}
				return { kind: 'Block.Body.Set', key: operation.key, body: previous };
			}
			case 'Block.Property.Set': {
				const node = this.require(operation.key);
				const previous = node.property.get(operation.name);
				if (!valueEqual(previous, operation.value)) {
					if (operation.value === undefined) node.property.delete(operation.name);
					else node.property.set(operation.name, cloneValue(operation.value));
					markChanged(this.document, node);
				}
				return { kind: 'Block.Property.Set', key: operation.key, name: operation.name, value: previous };
			}
			case 'Block.Source.Set': {
				const node = this.require(operation.key);
				const previous = ownSourceText(node, this.option);
				const hasChild = node.childList.length > 0;
				// read with a stand-in child line when the block holds others, so the text reads as it will in the file
				const read = readSource(hasChild ? `${operation.text.replace(/\s+$/, '')}\n\t.` : operation.text, this.option);
				const next = read.itemList.length === 1 ? read.itemList[0]! : undefined;
				if (!next || (!hasChild && next.childList.length > 0)) throw new ModelError('the text must be one block, with nothing inside it');
				if (hasChild && next.content !== 'Item') throw new ModelError(`a ${next.type} block can't hold the blocks inside this one`);
				const typeChanged = next.type !== node.type || next.implicit !== node.implicit;
				node.type = next.type;
				node.implicit = next.implicit;
				node.version = next.version;
				node.id = next.id;
				node.property = next.property;
				node.body = next.body;
				node.content = next.content;
				if (next.alias === undefined) delete node.alias;
				else node.alias = next.alias;
				markChanged(this.document, node);
				// the lines as typed, at the block's depth
				const indent = indentText(node.level);
				const lineList = (next.headLineList ?? []).map((line) => (line === '' ? '' : indent + line));
				node.headLineList = lineList;
				if (node.content === 'Raw') node.rawLineList = lineList;
				if (typeChanged) {
					// "no blank line" between two blocks only holds when both keep their kind (a paragraph would swallow the next line)
					if (node.gapLineList?.length === 0) node.gapLineList = undefined;
					const place = this.placeOf(operation.key);
					const after = place.list[place.index + 1];
					if (after?.gapLineList?.length === 0) after.gapLineList = undefined;
				}
				return { kind: 'Block.Source.Set', key: operation.key, text: previous };
			}
			case 'Note.Property.Set': {
				const front = this.document.front ?? { level: 0, entryList: [], problemList: [] };
				const previous = getSectionValue(front, operation.name);
				// new properties go above the system fields, which stay last
				setSectionValue(front, operation.name, operation.value === undefined ? undefined : cloneValue(operation.value), ['Id', 'Format']);
				if (!this.document.front) {
					this.document.front = front;
					const first = this.document.itemList[0];
					if (first && first.gapLineList && first.gapLineList.length === 0) first.gapLineList = [''];
				}
				return { kind: 'Note.Property.Set', name: operation.name, value: previous };
			}
			case 'Note.Text.Set': {
				const previous = this.serialize();
				const next = parseNote(operation.text, this.option);
				reuseKey(this.document.itemList, next.itemList);
				Object.assign(this.document, {
					front: next.front,
					itemList: next.itemList,
					tailLineList: next.tailLineList,
					bom: next.bom,
					newline: next.newline,
					finalNewline: next.finalNewline,
					problemList: next.problemList,
				});
				this.reindex();
				return { kind: 'Note.Text.Set', text: previous };
			}
			case 'Block.Insert': {
				const node = structuredClone(operation.node);
				this.place(operation.parentKey, operation.afterKey, node);
				this.reindex();
				return { kind: 'Block.Delete', key: node.key };
			}
			case 'Block.Delete': {
				const where = this.placeOf(operation.key);
				const parent = this.parentMap.get(operation.key) ?? undefined;
				const previous = where.index > 0 ? where.list[where.index - 1] : undefined;
				const [removed] = where.list.splice(where.index, 1);
				markChildChanged(this.document, parent);
				this.reindex();
				return { kind: 'Block.Insert', parentKey: where.parentKey, afterKey: previous?.key ?? null, node: structuredClone(removed!) };
			}
			case 'Block.Move': {
				for (let cursor: BlockNode | null | undefined = operation.parentKey === null ? null : this.require(operation.parentKey); cursor; cursor = this.parentMap.get(cursor.key)) {
					if (cursor.key === operation.key) throw new ModelError('a block cannot move into itself');
				}
				if (operation.afterKey === operation.key) throw new ModelError('a block cannot move after itself');
				const where = this.placeOf(operation.key);
				const oldParent = this.parentMap.get(operation.key) ?? undefined;
				const previous = where.index > 0 ? where.list[where.index - 1] : undefined;
				const [node] = where.list.splice(where.index, 1);
				markChildChanged(this.document, oldParent);
				this.reindex();
				try {
					this.place(operation.parentKey, operation.afterKey, node!);
				} catch (error) {
					where.list.splice(where.index, 0, node!);
					this.reindex();
					throw error;
				}
				this.reindex();
				return { kind: 'Block.Move', key: operation.key, parentKey: where.parentKey, afterKey: previous?.key ?? null };
			}
		}
	}
}
