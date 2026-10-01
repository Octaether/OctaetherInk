// Edit session: blocks show their rendered output; clicking a block edits it in place with the
// caret on exactly the character that was clicked (source maps, see caret.ts).
//
// A paragraph is edited as its Markdown. Any other block is edited as its own source, header
// included (`Math: x^2`, ```Python … ```), so its type and properties change right there. Typing
// that still reads as one block is written as you go; text that reads as something else (a
// paragraph, several blocks, nothing) becomes that when the editor closes.

import { type BlockNode, aliasOf, blockSource, createBlockNode, editorOffset, readSource, serializeNode, walkNode } from '@octaether/core-format';
import type { Change, NoteModel } from '@octaether/core-model';
import { type Registry, type RenderHost, kebab } from '@octaether/core-render';
import type { EditorKind } from '@octaether/core-sdk';
import { indentBlock, insertTemplate, mergeBackward, neighbourKey, outdentBlock, splitText } from './action';
import { sourceOffsetAtPoint, sourceRangeOfSelection } from './caret';
import { isApplePlatform } from './hotkey';

export type ClickToEdit = 'SingleClick' | 'DoubleClick' | 'HotkeyOnly';

export interface TextRange {
	key: string;
	/** In the open editor: offsets in its text. In the rendered view: offsets in the block's body. */
	start: number;
	end: number;
	/** Where the range lives: the open editor or the rendered view. */
	source: 'Editor' | 'View';
}

export interface EditSessionOption {
	clickToEdit(): ClickToEdit;
	/** The Read view: clicks don't edit or select. */
	readOnly?(): boolean;
	/** Spell checking in text blocks (default on). */
	spellcheck?(): boolean;
	onStateChange?(state: { selectedKey: string | undefined; editingKey: string | undefined }): void;
	/** "/" typed at the start of an empty text block (query = text after it); undefined closes the menu. */
	onSlash?(key: string, query: string | undefined, anchor: HTMLElement): void;
}

/** A block edited as its own source (anything but a paragraph). */
interface FullSource {
	/** Where each body line starts in the editor's text (rendered pieces carry body offsets). */
	lineStartList: number[];
	/** The text as last written to the note. */
	written: string;
	/** The text reads as something else than one block of a kind: it is applied when the editor closes. */
	pending: boolean;
}

interface OpenEditor {
	key: string;
	kind: EditorKind;
	textarea: HTMLTextAreaElement;
	hiddenContent: HTMLElement | undefined;
	slash: boolean;
	full: FullSource | undefined;
	/** The block holding the edited one, outlined too so you can see where you are. */
	parentFrame: HTMLElement | undefined;
}

/** Elements marked data-oi-keep-editor (menus, the format bar) don't close the editor when focused. */
const keepSelector = '[data-oi-keep-editor]';
/** A line that starts a block with `Type:` (its body goes on the indented lines after it). */
const headerLinePattern = /^[A-Z][A-Za-z0-9]*(?:@\d+)?(?:[ \t]+\^[a-z0-9]+)?(?:[ \t]*\{.*\})?:(?:[ \t]|$)/;

/** Drops a parsed block's exact lines, so it is written in full (an unclosed fence gets its closing line). */
function settle(node: BlockNode): BlockNode {
	walkNode([node], (item) => {
		item.rawLineList = undefined;
		item.headLineList = undefined;
	});
	return node;
}

export class EditSession {
	private open: OpenEditor | undefined;
	private selectedKey: string | undefined;
	private readonly disposeList: (() => void)[] = [];

	constructor(
		readonly host: RenderHost,
		readonly registry: Registry,
		readonly model: () => NoteModel | undefined,
		readonly option: EditSessionOption,
	) {
		const root = host.root;
		const onClick = (event: MouseEvent): void => this.onPointer(event, 'Click');
		const onDoubleClick = (event: MouseEvent): void => this.onPointer(event, 'DoubleClick');
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target as Element | null;
			if (!this.open || !target) return;
			const frame = host.frameOf(this.open.key);
			if (frame?.contains(target) || target.closest(keepSelector)) return;
			if (!root.contains(target)) this.close();
		};
		root.addEventListener('click', onClick);
		root.addEventListener('dblclick', onDoubleClick);
		document.addEventListener('pointerdown', onPointerDown, true);
		this.disposeList.push(
			() => root.removeEventListener('click', onClick),
			() => root.removeEventListener('dblclick', onDoubleClick),
			() => document.removeEventListener('pointerdown', onPointerDown, true),
		);
	}

	destroy(): void {
		this.close();
		for (const dispose of this.disposeList) dispose();
	}

	editingKey(): string | undefined {
		return this.open?.key;
	}

	selected(): string | undefined {
		return this.selectedKey;
	}

	activeTextarea(): HTMLTextAreaElement | undefined {
		return this.open?.textarea;
	}

	select(key: string | undefined): void {
		if (this.selectedKey) this.host.frameOf(this.selectedKey)?.removeAttribute('data-oi-selected');
		this.selectedKey = key;
		if (key && !this.open) this.host.frameOf(key)?.setAttribute('data-oi-selected', '');
		this.emit();
	}

	/** Text is selected on the page itself (not in an editor), so keys act on it rather than on a block. */
	hasViewSelection(): boolean {
		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
		return this.host.root.contains(selection.getRangeAt(0).commonAncestorContainer);
	}

	/** The selected text: in the open editor, or a selection in the rendered view mapped to source. */
	textRange(): TextRange | undefined {
		if (this.open) {
			const { selectionStart, selectionEnd } = this.open.textarea;
			return { key: this.open.key, start: selectionStart, end: selectionEnd, source: 'Editor' };
		}
		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
		const key = this.host.keyAt(selection.getRangeAt(0).commonAncestorContainer.parentElement);
		const content = key ? this.host.contentOf(key) : undefined;
		const range = content ? sourceRangeOfSelection(content) : undefined;
		return key && range ? { key, ...range, source: 'View' } : undefined;
	}

	/**
	 * Rewrites part of a block (formatting) as one undo step. With the block's editor open the
	 * transform gets the editor's text, as `textRange()` measured it; otherwise the body.
	 */
	replace(key: string, transform: (text: string) => { text: string; start: number; end: number }): void {
		const model = this.model();
		if (!model?.get(key)) return;
		const open = this.open;
		if (open?.key !== key) {
			model.setBody(key, transform(model.bodyOf(key)).text);
			return;
		}
		const result = transform(open.textarea.value);
		open.textarea.value = result.text;
		open.textarea.setSelectionRange(result.start, result.end);
		this.resize(open.textarea);
		this.writeBack(false);
		open.textarea.focus();
	}

	/** Handles keys in the rendered view (no editor open). Returns true when used. */
	handleKey(event: KeyboardEvent): boolean {
		if (this.open || event.ctrlKey || event.metaKey || event.altKey || this.option.readOnly?.()) return false;
		const model = this.model();
		// text selected on the page: Delete and Backspace remove it, a typed character replaces it
		if (model && this.hasViewSelection()) {
			const typed = event.key.length === 1 ? event.key : undefined;
			if (event.key !== 'Delete' && event.key !== 'Backspace' && typed === undefined) return false;
			const range = this.textRange();
			if (!range || range.source !== 'View' || !model.get(range.key)) return false;
			event.preventDefault();
			const insert = typed ?? '';
			model.setBody(range.key, `${model.bodyOf(range.key).slice(0, range.start)}${insert}${model.bodyOf(range.key).slice(range.end)}`);
			document.getSelection()?.removeAllRanges();
			const caret = range.start + insert.length;
			this.edit(range.key, { start: caret, end: caret });
			return true;
		}
		if (event.key === 'Escape' && this.selectedKey) {
			this.select(undefined);
			return true;
		}
		if (event.key === 'Enter' && this.selectedKey) {
			event.preventDefault();
			this.edit(this.selectedKey);
			return true;
		}
		if (event.key === 'Tab' && this.selectedKey && model) {
			event.preventDefault();
			if (event.shiftKey) outdentBlock(model, this.selectedKey);
			else indentBlock(model, this.selectedKey);
			this.select(this.selectedKey);
			return true;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const keyList = this.host.orderedKeyList();
			if (keyList.length === 0) return false;
			const index = this.selectedKey ? keyList.indexOf(this.selectedKey) : -1;
			const next = event.key === 'ArrowDown' ? Math.min(index + 1, keyList.length - 1) : Math.max(index - 1, 0);
			event.preventDefault();
			this.select(keyList[next]);
			this.host.frameOf(keyList[next]!)?.scrollIntoView({ block: 'nearest' });
			return true;
		}
		return false;
	}

	/** Opens the editor for a block with the caret (or a selection) at a body position. */
	edit(key: string, range?: { start: number; end: number }): void {
		const model = this.model();
		const node = model?.get(key);
		if (!model || !node || this.option.readOnly?.()) return;
		if (this.open?.key === key) {
			// already editing this block: just move the caret
			const { textarea } = this.open;
			if (range) textarea.setSelectionRange(this.toText(this.open, node.body, range.start), this.toText(this.open, node.body, range.end));
			textarea.focus({ preventScroll: true });
			return;
		}
		const definition = this.registry.blockType(node.type);
		// containers are selected, unless they have text of their own to edit (a callout's title)
		if (definition?.layout && !definition.edit) {
			this.select(key);
			return;
		}
		this.close();
		this.select(key);
		const frame = this.host.frameOf(key);
		const content = this.host.contentOf(key);
		if (!frame || !content) return;
		const kind: EditorKind = definition?.edit?.kind ?? 'SourcePreview';
		// a block with controls of its own (a Property block) takes the focus there, not in a text editor
		if (kind === 'Structured') {
			content.querySelector<HTMLElement>('[data-oi-focus], input, select, button')?.focus({ preventScroll: true });
			return;
		}
		// a paragraph is edited as its Markdown; any other block as its own source, `Math:` included
		let full: FullSource | undefined;
		let text = node.body;
		if (!node.implicit) {
			const source = blockSource(node, model.option);
			text = source.text;
			full = { lineStartList: source.lineStartList, written: source.text, pending: false };
		}
		frame.removeAttribute('data-oi-selected');
		frame.setAttribute('data-oi-editing', '');
		const textarea = document.createElement('textarea');
		textarea.className = `oi-source oi-source-${kebab(kind)}${full ? ' oi-source-full' : ''}`;
		textarea.value = text;
		textarea.rows = 1;
		textarea.spellcheck = kind === 'InlineText' && !full && (this.option.spellcheck?.() ?? true);
		textarea.setAttribute('aria-label', `${node.type} source`);
		if (kind === 'InlineText' && !full) {
			// match the rendered typography so editing feels like typing on the page
			const sample = content.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li, blockquote, td') ?? content;
			const style = getComputedStyle(sample);
			for (const name of ['font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing'] as const) textarea.style.setProperty(name, style.getPropertyValue(name));
		}
		textarea.addEventListener('input', () => {
			this.resize(textarea);
			this.writeBack();
			this.checkSlash();
		});
		textarea.addEventListener('keydown', (event) => this.onEditorKey(event));
		textarea.addEventListener('blur', (event) => {
			const next = event.relatedTarget as Element | null;
			if (next?.closest(keepSelector)) return;
			setTimeout(() => {
				const active = document.activeElement;
				if (this.open?.textarea === textarea && active !== textarea && !active?.closest(keepSelector)) this.close();
			}, 0);
		});
		frame.insertBefore(textarea, content);
		const hiddenContent = kind === 'InlineText' ? content : undefined;
		if (hiddenContent) hiddenContent.hidden = true;
		// the block around this one (a callout, a column, a list item) is outlined too
		const parentFrame = frame.parentElement?.closest<HTMLElement>('.oi-frame') ?? undefined;
		if (parentFrame && this.host.root.contains(parentFrame)) parentFrame.setAttribute('data-oi-editing-parent', '');
		const open: OpenEditor = { key, kind, textarea, hiddenContent, slash: false, full, parentFrame };
		this.open = open;
		this.resize(textarea);
		textarea.focus({ preventScroll: true });
		// a click lands on its character; otherwise the caret goes to the end of the body
		const start = this.toText(open, node.body, range ? range.start : node.body.length);
		const end = range ? this.toText(open, node.body, range.end) : start;
		textarea.setSelectionRange(start, end);
		this.emit();
	}

	/** Undo or redo from inside the block editor, keeping the editor on the block that changed. */
	history(kind: 'Undo' | 'Redo'): boolean {
		const model = this.model();
		const open = this.open;
		if (!model) return false;
		if (!open) return kind === 'Undo' ? model.undo() : model.redo();
		const before = new Map(model.keyList().map((key) => [key, model.bodyOf(key)] as const));
		let changed: Change | undefined;
		const stop = model.subscribe((change) => {
			changed = change;
		});
		const done = kind === 'Undo' ? model.undo() : model.redo();
		stop();
		if (!done || !changed) return done;
		const change = changed as Change;
		const target = model.get(open.key) && (change.changedKeySet.has(open.key) || !change.structure) ? open.key : [...change.changedKeySet].find((key) => model.get(key));
		if (!target) {
			// only structure changed (an insert or a move was undone): leave the editor
			if (!model.get(open.key)) this.close();
			return true;
		}
		const node = model.get(target)!;
		if (target !== open.key) {
			// the caret goes to the end of what changed
			this.edit(target, { start: changeEnd(before.get(target) ?? '', node.body), end: changeEnd(before.get(target) ?? '', node.body) });
			return true;
		}
		const previous = open.textarea.value;
		let text = node.body;
		if (open.full) {
			const source = blockSource(node, model.option);
			text = source.text;
			open.full = { lineStartList: source.lineStartList, written: source.text, pending: false };
		}
		if (previous !== text) {
			open.textarea.value = text;
			this.resize(open.textarea);
		}
		const caret = changeEnd(previous, text);
		open.textarea.setSelectionRange(caret, caret);
		return true;
	}

	close(): void {
		const open = this.open;
		if (!open) return;
		this.open = undefined;
		if (open.slash) this.option.onSlash?.(open.key, undefined, open.textarea);
		const text = open.textarea.value;
		open.textarea.remove();
		if (open.hiddenContent) open.hiddenContent.hidden = false;
		open.parentFrame?.removeAttribute('data-oi-editing-parent');
		const frame = this.host.frameOf(open.key);
		frame?.removeAttribute('data-oi-editing');
		const model = this.model();
		if (model && open.full?.pending) this.commitSource(model, open.key, text);
		const node = model?.get(open.key);
		if (model && node?.type === 'Text' && node.implicit && !open.full) {
			if (node.body.trim() === '' && node.childList.length === 0) {
				// an empty paragraph is not worth keeping
				model.delete(open.key);
			} else if (/\n[ \t]*\n/.test(node.body)) {
				this.splitParagraph(model, open.key);
			}
		}
		if (this.selectedKey && !model?.get(this.selectedKey)) this.selectedKey = undefined;
		if (this.selectedKey) this.host.frameOf(this.selectedKey)?.setAttribute('data-oi-selected', '');
		this.emit();
	}

	// ------------------------------------------------------------ internals

	/** Body offset → offset in the open editor's text. */
	private toText(open: OpenEditor, body: string, offset: number): number {
		const length = open.textarea.value.length;
		return open.full ? editorOffset(body, open.full.lineStartList, length, offset) : Math.min(offset, length);
	}

	/** Writes the editor's text into the note; `coalesce` joins a burst of typing into one undo step. */
	private writeBack(coalesce = true): void {
		const open = this.open;
		const model = this.model();
		if (!open || !model?.get(open.key)) return;
		const option = coalesce ? { coalesceKey: `Type:${open.key}` } : {};
		const full = open.full;
		if (!full) {
			model.setBody(open.key, open.textarea.value, option);
			return;
		}
		const text = open.textarea.value;
		if (text === full.written) return;
		const read = readSource(text, model.option);
		const only = read.itemList.length === 1 ? read.itemList[0]! : undefined;
		// only text that reads as one block (not a paragraph, nothing left open) is written as you type
		if (!only || only.implicit || read.problemList.length > 0) {
			full.pending = true;
			return;
		}
		try {
			model.setSource(open.key, text, option);
			full.written = text;
			full.pending = false;
			full.lineStartList = read.lineStartMap.get(only.key) ?? [];
		} catch {
			// it can't become that here (a type that can't hold the blocks inside this one): decided on close
			full.pending = true;
		}
	}

	/** An editor's text that reads as something else: it becomes what it reads as. */
	private commitSource(model: NoteModel, key: string, text: string): void {
		const node = model.get(key);
		if (!node) return;
		const read = readSource(text, model.option);
		// with a problem (a fence left open), blocks are written in full so they can't swallow what follows
		const fix = (item: BlockNode): BlockNode => (read.problemList.length > 0 ? settle(item) : item);
		try {
			const only = read.itemList.length === 1 ? read.itemList[0]! : undefined;
			if (only && only.childList.length === 0 && (only.content === 'Item' || node.childList.length === 0)) {
				model.setSource(key, read.problemList.length > 0 ? serializeNode(fix(only), model.option).join('\n') : text);
				return;
			}
			// several blocks, or none: they take its place, and the blocks it held follow them
			model.transact(() => {
				const place = model.placeOf(key);
				let afterKey = key;
				for (const item of read.itemList) afterKey = model.insert(place.parentKey, afterKey, fix(item));
				for (const child of [...node.childList]) {
					model.move(child.key, place.parentKey, afterKey);
					afterKey = child.key;
				}
				model.delete(key);
			});
		} catch {
			// the note keeps the block as it was
		}
	}

	/** `Math:`, `Code: Python`, ```Python, or $$ typed alone in a paragraph: the source of the block it opens. */
	private openerSource(model: NoteModel, line: string): string | undefined {
		const read = readSource(line, model.option);
		const node = read.itemList.length === 1 ? read.itemList[0]! : undefined;
		if (node && !node.implicit && node.childList.length === 0) return serializeNode(settle(node), model.option).join('\n');
		const alias = aliasOf(line.trim(), model.option);
		if (alias && alias.after.trim() === '') return serializeNode(createBlockNode(alias.alias.type, { alias: alias.marker }), model.option).join('\n');
		return undefined;
	}

	private resize(textarea: HTMLTextAreaElement): void {
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	private checkSlash(): void {
		const open = this.open;
		if (!open || open.kind !== 'InlineText' || open.full) return;
		const match = /^\/([^\s/]*)$/.exec(open.textarea.value);
		if (match) {
			open.slash = true;
			this.option.onSlash?.(open.key, match[1]!, this.host.frameOf(open.key) ?? open.textarea);
		} else if (open.slash) {
			open.slash = false;
			this.option.onSlash?.(open.key, undefined, open.textarea);
		}
	}

	private onEditorKey(event: KeyboardEvent): void {
		const open = this.open;
		const model = this.model();
		if (!open || !model || event.isComposing) return;
		// undo and redo work while typing: they step through the note's history, splits and merges included
		const primary = isApplePlatform() ? event.metaKey : event.ctrlKey;
		if (primary && !event.altKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
			event.preventDefault();
			event.stopPropagation();
			this.history(event.code === 'KeyY' || event.shiftKey ? 'Redo' : 'Undo');
			return;
		}
		const textarea = open.textarea;
		const { selectionStart, selectionEnd, value } = textarea;
		const collapsed = selectionStart === selectionEnd;
		if (open.slash && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) return; // the slash menu handles these
		if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
			event.preventDefault();
			event.stopPropagation();
			const key = open.key;
			this.close();
			this.select(model.get(key) ? key : undefined);
			return;
		}
		const text = open.kind === 'InlineText';
		const plainText = !open.full && model.get(open.key)?.type === 'Text';
		if (event.key === 'Enter' && !event.shiftKey && !event.altKey && plainText) {
			event.preventDefault();
			// `Math:` or ``` typed alone in a paragraph turns it into that block
			const opener = selectionEnd === value.length && !value.includes('\n') ? this.openerSource(model, value) : undefined;
			if (opener !== undefined) {
				const key = open.key;
				try {
					model.setSource(key, opener);
					this.close();
					this.edit(key);
					return;
				} catch {
					// the paragraph holds blocks that one can't: Enter splits it as usual
				}
			}
			const next = splitText(model, open.key, selectionEnd);
			this.edit(next.key, { start: next.caret, end: next.caret });
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.altKey && text) {
			// the title of a container (a callout): Enter continues inside it
			event.preventDefault();
			const key = open.key;
			this.close();
			const node = model.get(key);
			if (!node || node.content !== 'Item') return;
			this.edit(node.childList[0]?.key ?? insertTemplate(model, key, null, '')[0]!, { start: 0, end: 0 });
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.altKey && open.full) {
			// a new line keeps the indentation of the one before it; after `Math:` it starts the indented body
			event.preventDefault();
			const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
			const line = value.slice(lineStart, selectionStart);
			let indent = /^[ \t]*/.exec(line)![0];
			if (lineStart === 0 && headerLinePattern.test(line)) indent = '\t';
			textarea.setRangeText(`\n${indent}`, selectionStart, selectionEnd, 'end');
			this.resize(textarea);
			this.writeBack();
			return;
		}
		if (event.key === 'Backspace' && collapsed && selectionStart === 0) {
			if (plainText) {
				const target = mergeBackward(model, open.key);
				if (target) {
					event.preventDefault();
					this.edit(target.key, { start: target.caret, end: target.caret });
				}
			} else if (value === '') {
				event.preventDefault();
				const previous = neighbourKey(model, open.key, -1);
				const key = open.key;
				if (open.full) open.full.pending = false;
				this.close();
				const node = model.get(key);
				if (!node) return;
				model.transact(() => {
					// the blocks it held stay, where it was
					const place = model.placeOf(key);
					let afterKey = key;
					for (const child of [...node.childList]) {
						model.move(child.key, place.parentKey, afterKey);
						afterKey = child.key;
					}
					model.delete(key);
				});
				if (previous && model.get(previous)) this.edit(previous);
			}
			return;
		}
		if (event.key === 'Tab') {
			event.preventDefault();
			if (text) {
				// in a paragraph or a title, Tab nests the block under the one above
				const moved = event.shiftKey ? outdentBlock(model, open.key) : indentBlock(model, open.key);
				if (moved) {
					textarea.focus({ preventScroll: true });
					textarea.setSelectionRange(selectionStart, selectionEnd);
				}
			} else if (!event.shiftKey) {
				textarea.setRangeText('\t', selectionStart, selectionEnd, 'end');
				this.writeBack();
			}
			return;
		}
		const atFirstLine = !value.slice(0, selectionStart).includes('\n');
		const atLastLine = !value.slice(selectionEnd).includes('\n');
		if (event.key === 'ArrowUp' && collapsed && (text ? atFirstLine : selectionStart === 0)) {
			const previous = neighbourKey(model, open.key, -1, (node) => !this.registry.blockType(node.type)?.layout);
			if (previous) {
				event.preventDefault();
				this.edit(previous);
			}
			return;
		}
		if (event.key === 'ArrowDown' && collapsed && (text ? atLastLine : selectionEnd === value.length)) {
			const next = neighbourKey(model, open.key, 1, (node) => !this.registry.blockType(node.type)?.layout);
			if (next) {
				event.preventDefault();
				this.edit(next, { start: 0, end: 0 });
			}
		}
	}

	private onPointer(event: MouseEvent, kind: 'Click' | 'DoubleClick'): void {
		const target = event.target as Element | null;
		if (!target || event.button !== 0 || this.option.readOnly?.()) return;
		if (this.open && this.host.frameOf(this.open.key)?.querySelector('textarea')?.contains(target)) return;
		if (target.closest('[data-oi-interactive], input, select, button, a[href], [data-oi-link]')) return;
		if (kind === 'Click' && this.hasViewSelection()) {
			// the user is selecting text (to format it, delete it, or type over it), not a block
			if (!this.open) this.select(undefined);
			return;
		}
		const key = this.host.keyAt(target);
		const model = this.model();
		if (!key || !model?.get(key)) {
			this.close();
			this.select(undefined);
			return;
		}
		const mode = this.option.clickToEdit();
		const wantEdit = (mode === 'SingleClick' && kind === 'Click') || (mode === 'DoubleClick' && kind === 'DoubleClick');
		if (!wantEdit) {
			if (kind === 'Click' && this.open?.key !== key) {
				this.close();
				this.select(key);
			}
			return;
		}
		const content = this.host.contentOf(key);
		const offset = content ? sourceOffsetAtPoint(content, event.clientX, event.clientY, target) : undefined;
		if (this.open?.key === key) return;
		this.edit(key, offset === undefined ? undefined : { start: offset, end: offset });
	}

	/** A blank line typed inside a paragraph starts a new block. */
	private splitParagraph(model: NoteModel, key: string): void {
		const partList = model.bodyOf(key).split(/\n[ \t]*\n+/).filter((part) => part.trim() !== '');
		if (partList.length < 2) return;
		const place = model.placeOf(key);
		model.transact(() => {
			model.setBody(key, partList[0]!);
			let afterKey = key;
			for (const part of partList.slice(1)) {
				for (const node of model.parseFragment(part)) afterKey = model.insert(place.parentKey, afterKey, node);
			}
		});
	}

	private emit(): void {
		this.option.onStateChange?.({ selectedKey: this.selectedKey, editingKey: this.open?.key });
	}
}

/** Where a change ends in the new text (for the caret after an undo). */
function changeEnd(previous: string, next: string): number {
	let prefix = 0;
	while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
	let suffix = 0;
	while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
	return next.length - suffix;
}
