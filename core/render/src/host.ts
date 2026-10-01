// Render host: one frame per block, keyed by runtime key. A frame's content re-renders only
// when its render key (type, own text, properties, module switch) changes. Any text or
// container block gets a child area; containers place it through their layout protocol.
//
//   <div class="oi-frame" data-oi-key data-oi-type>
//     <div class="oi-content">…module output…</div>
//     <div class="oi-child">…child frames…</div>
//   </div>

import { type BlockNode, type PropertyMap, type PropertyValue, serializeNode } from '@octaether/core-format';
import type { Change, NoteModel } from '@octaether/core-model';
import { type BlockTypeDefinition, type ChildFrame, type InlineContext, type RenderContext, type RenderHandle, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import type { Registry } from './registry';
import { envelopeStyle, kebab, resolveLength } from './style';
import { type ThemeRegistry, applyThemeVariable, resolveColor, themeContext } from './theme';

interface FrameRecord {
	key: string;
	element: HTMLElement;
	content: HTMLElement;
	childArea: HTMLElement | undefined;
	type: string;
	renderKey: string;
	handle: RenderHandle | undefined;
	definition: BlockTypeDefinition | undefined;
}

export { escapeHtml };

function stableText(value: PropertyValue): string {
	if (value instanceof Map) return `{${[...value].map(([key, item]) => `${JSON.stringify(key)}:${stableText(item)}`).join(',')}}`;
	if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
	return JSON.stringify(value);
}

export function resolveBlock(node: BlockNode): ResolvedBlock {
	return { key: node.key, id: node.id, type: node.type, version: node.version, body: node.body, property: node.property, node };
}

export class RenderHost {
	private model: NoteModel | undefined;
	private readOnly = false;
	private unsubscribeModel: (() => void) | undefined;
	private readonly recordMap = new Map<string, FrameRecord>();
	private readonly styleElementMap = new Map<string, HTMLStyleElement>();
	private readonly disposeList: (() => void)[] = [];

	constructor(
		readonly root: HTMLElement,
		readonly registry: Registry,
		readonly themeRegistry: ThemeRegistry,
	) {
		root.classList.add('oi-note');
		this.disposeList.push(
			registry.subscribe(() => {
				this.installModuleStyle();
				this.applyTheme();
				this.refresh();
			}),
			themeRegistry.subscribe(() => this.applyTheme()),
		);
		this.installModuleStyle();
		this.applyTheme();
	}

	mount(model: NoteModel): void {
		this.unmount();
		this.model = model;
		this.unsubscribeModel = model.subscribe((change) => this.onChange(change));
		this.reconcile();
	}

	unmount(): void {
		this.unsubscribeModel?.();
		this.unsubscribeModel = undefined;
		for (const record of this.recordMap.values()) this.destroyHandle(record);
		this.recordMap.clear();
		this.root.replaceChildren();
		this.model = undefined;
	}

	destroy(): void {
		this.unmount();
		for (const dispose of this.disposeList) dispose();
		for (const element of this.styleElementMap.values()) element.remove();
		this.styleElementMap.clear();
	}

	/** The Read view: modules hide editing affordances (`context.readOnly()`, `.oi-read-only`). */
	setReadOnly(readOnly: boolean): void {
		if (this.readOnly === readOnly) return;
		this.readOnly = readOnly;
		this.root.classList.toggle('oi-read-only', readOnly);
		this.refresh();
	}

	isReadOnly(): boolean {
		return this.readOnly;
	}

	/** Re-renders everything (after modules were switched on or off). */
	refresh(): void {
		for (const record of this.recordMap.values()) record.renderKey = '';
		this.reconcile();
	}

	frameOf(key: string): HTMLElement | undefined {
		return this.recordMap.get(key)?.element;
	}

	contentOf(key: string): HTMLElement | undefined {
		return this.recordMap.get(key)?.content;
	}

	/** The key of the innermost block around an element. */
	keyAt(element: Element | null): string | undefined {
		return element?.closest<HTMLElement>('.oi-frame')?.dataset.oiKey;
	}

	/** Blocks in reading order (depth first), for keyboard navigation. */
	orderedKeyList(): string[] {
		return [...this.root.querySelectorAll<HTMLElement>('.oi-frame')].map((element) => element.dataset.oiKey!).filter(Boolean);
	}

	inlineContext(): InlineContext {
		const context: InlineContext = {
			theme: themeContext(this.themeRegistry.current()),
			resolveColor: (value) => resolveColor(value, (token) => this.isKnownToken(token)),
			renderInline: (type, content, property, offset) => {
				const inline = this.registry.inlineRenderer(type);
				if (!inline) return undefined;
				try {
					return inline.render(content, property, context, offset);
				} catch {
					return undefined;
				}
			},
			setting: (id) => this.registry.setting(id),
		};
		return context;
	}

	context(key: string): RenderContext {
		const model = this.model!;
		return {
			...this.inlineContext(),
			note: model,
			extension: (name) => this.registry.extension(name),
			setProperty: (name, value) => {
				if (model.get(key)) model.setProperty(key, name, value);
			},
			setBody: (body) => {
				if (model.get(key)) model.setBody(key, body);
			},
			readOnly: () => this.readOnly,
		};
	}

	// ------------------------------------------------------------ internals

	private isKnownToken(token: string): boolean {
		if (token in this.themeRegistry.current().token) return true;
		return this.registry.moduleTokenList().some((moduleToken) => token in moduleToken);
	}

	private onChange(change: Change): void {
		if (change.structure || !this.model) {
			this.reconcile();
			return;
		}
		const parentSet = new Set<string | null>();
		for (const key of change.changedKeySet) {
			const record = this.recordMap.get(key);
			const node = this.model.get(key);
			if (!record || !node) continue;
			this.renderRecord(record, node, this.coordinateOf(this.model.parentOf(key)?.key ?? null));
			parentSet.add(this.model.parentOf(key)?.key ?? null);
		}
		for (const parentKey of parentSet) this.arrange(parentKey);
	}

	private reconcile(): void {
		const model = this.model;
		if (!model) return;
		this.root.classList.toggle('oi-empty', model.document.itemList.length === 0);
		this.renderList(this.root, model.document.itemList, null);
		this.arrange(null);
		for (const [key, record] of this.recordMap) {
			if (!model.get(key)) {
				this.destroyHandle(record);
				record.element.remove();
				this.recordMap.delete(key);
			}
		}
	}

	private renderList(area: HTMLElement, nodeList: readonly BlockNode[], parentKey: string | null): void {
		const coordinate = this.coordinateOf(parentKey);
		const seen = new Set<string>();
		let cursor = area.firstElementChild;
		for (const node of nodeList) {
			seen.add(node.key);
			let record = this.recordMap.get(node.key);
			if (!record) {
				record = this.createRecord(node.key);
				this.recordMap.set(node.key, record);
			}
			if (record.element === cursor) cursor = cursor.nextElementSibling;
			else area.insertBefore(record.element, cursor);
			this.renderRecord(record, node, coordinate);
		}
		for (const child of [...area.children]) {
			const key = (child as HTMLElement).dataset.oiKey;
			if (child.classList.contains('oi-frame') && key !== undefined && !seen.has(key)) child.remove();
		}
	}

	private createRecord(key: string): FrameRecord {
		const element = document.createElement('div');
		const content = document.createElement('div');
		content.className = 'oi-content';
		element.append(content);
		return { key, element, content, childArea: undefined, type: '', renderKey: '', handle: undefined, definition: undefined };
	}

	/** Coordinate space of a container (null = the note root). */
	private coordinateOf(containerKey: string | null): 'Flow' | 'Fixed' {
		if (containerKey === null) {
			const layout = this.model?.noteProperty('Layout');
			return this.registry.blockType(typeof layout === 'string' ? layout : 'Flow')?.layout?.coordinate ?? 'Flow';
		}
		return this.recordMap.get(containerKey)?.definition?.layout?.coordinate ?? 'Flow';
	}

	private renderRecord(record: FrameRecord, node: BlockNode, coordinate: 'Flow' | 'Fixed'): void {
		const block = resolveBlock(node);
		const definition = this.registry.blockType(block.type);
		const renderKey = [block.type, block.version, definition ? 'On' : 'Off', this.registry.revision, stableText(block.property), block.body].join('|');
		if (record.renderKey !== renderKey) {
			this.applyEnvelope(record, block, definition, coordinate);
			const sameType = record.type === block.type && record.definition === definition;
			record.type = block.type;
			record.definition = definition;
			this.renderContent(record, block, sameType);
			this.markBroken(record);
			record.renderKey = renderKey;
		}
		if (node.content === 'Item' && node.childList.length > 0) {
			if (!record.childArea) {
				record.childArea = document.createElement('div');
				record.element.append(record.childArea);
			}
			record.childArea.className = 'oi-child';
			this.renderList(record.childArea, node.childList, record.key);
			this.arrange(record.key);
		} else if (record.childArea) {
			record.childArea.remove();
			record.childArea = undefined;
		}
	}

	private applyEnvelope(record: FrameRecord, block: ResolvedBlock, definition: BlockTypeDefinition | undefined, coordinate: 'Flow' | 'Fixed'): void {
		const { element, content } = record;
		const fallback = definition?.defaultProperty?.((id) => this.registry.setting(id));
		const style = envelopeStyle(fallback && fallback.size > 0 ? new Map([...fallback, ...block.property]) : block.property, {
			parentCoordinate: coordinate,
			resolveColor: (value) => resolveColor(value, (token) => this.isKnownToken(token)),
		});
		const editing = element.hasAttribute('data-oi-editing');
		element.removeAttribute('style');
		content.removeAttribute('style');
		let extraClassList: string[] = [];
		try {
			extraClassList = definition?.frameClassList?.(block) ?? [];
		} catch {
			extraClassList = [];
		}
		element.className = ['oi-frame', block.node.content === 'Item' ? 'oi-item' : 'oi-raw', ...extraClassList, ...style.presetList.map((preset) => `oi-preset-${kebab(preset)}`)]
			.filter(Boolean)
			.join(' ');
		element.dataset.oiKey = block.key;
		element.dataset.oiType = block.type;
		if (editing) element.setAttribute('data-oi-editing', '');
		const themeName = block.property.get('Theme');
		const blockTheme = typeof themeName === 'string' ? this.themeRegistry.get(themeName) : undefined;
		if (blockTheme) {
			applyThemeVariable(element, blockTheme, this.registry.moduleTokenList());
			element.style.color = 'var(--oi-color-text)';
			element.style.background = 'var(--oi-color-background)';
		} else {
			delete element.dataset.oiTheme;
			delete element.dataset.oiMode;
		}
		for (const [name, value] of style.frame) element.style.setProperty(name, value);
		for (const [name, value] of style.content) content.style.setProperty(name, value);
	}

	private renderContent(record: FrameRecord, block: ResolvedBlock, sameType: boolean): void {
		const context = this.context(record.key);
		if (sameType && record.handle?.update) {
			try {
				if (record.handle.update(block, context) === 'Done') return;
			} catch (error) {
				this.showError(record, block, error);
				return;
			}
		}
		this.destroyHandle(record);
		record.content.replaceChildren();
		record.content.className = 'oi-content';
		if (!record.definition) {
			this.showPlaceholder(record, block);
			return;
		}
		try {
			record.handle = record.definition.render.mount(record.content, block, context) ?? undefined;
		} catch (error) {
			this.showError(record, block, error);
		}
	}

	private arrange(containerKey: string | null): void {
		const model = this.model;
		if (!model) return;
		const layoutType = containerKey === null ? model.noteProperty('Layout') : undefined;
		const record = containerKey === null ? undefined : this.recordMap.get(containerKey);
		const definition = containerKey === null ? this.registry.blockType(typeof layoutType === 'string' ? layoutType : 'Flow') : record?.definition;
		const area = containerKey === null ? this.root : record?.childArea;
		const layout = definition?.layout;
		if (!layout || !area) return;
		const nodeList = containerKey === null ? model.document.itemList : (model.get(containerKey)?.childList ?? []);
		const childList: ChildFrame[] = [];
		for (const node of nodeList) {
			const child = this.recordMap.get(node.key);
			if (child) childList.push({ key: child.key, element: child.element, property: node.property as PropertyMap, type: node.type });
		}
		const container: ResolvedBlock =
			containerKey === null
				? { key: '', id: undefined, type: definition.name, version: 1, body: '', property: new Map(), node: { ...model.document.itemList[0]!, childList: model.document.itemList } }
				: resolveBlock(model.get(containerKey)!);
		try {
			layout.arrange(area, container, childList, { theme: themeContext(this.themeRegistry.current()), resolveLength, setting: (id) => this.registry.setting(id) });
		} catch (error) {
			area.dataset.oiProblem = error instanceof Error ? error.message : String(error);
		}
	}

	private showPlaceholder(record: FrameRecord, block: ResolvedBlock): void {
		const owner = this.registry.ownerOf(block.type);
		const reason = owner ? `the ${owner} module is off (Setting → Module)` : 'no module is installed for this block type';
		const lineList = serializeNode({ ...block.node, childList: [] }, this.registry.formatOption());
		record.content.innerHTML =
			`<div class="oi-placeholder" data-reason="${owner ? 'Off' : 'Missing'}"><div class="oi-placeholder-label">${escapeHtml(block.type)}: ${escapeHtml(reason)}. Its text is kept as it is.</div>` +
			`<pre>${escapeHtml(lineList.join('\n').replace(/^\t+/gm, ''))}</pre></div>`;
	}

	/** A block that can't render as intended gets an outline in a warning colour, with its text still shown. */
	private markBroken(record: FrameRecord): void {
		const { element, content } = record;
		const placeholder = content.querySelector<HTMLElement>(':scope > .oi-placeholder');
		const failed = content.querySelector(':scope > .oi-error');
		const problem = !placeholder && !failed && content.querySelector('[data-oi-problem]') !== null;
		element.classList.toggle('oi-broken', Boolean(placeholder || failed));
		element.classList.toggle('oi-has-problem', problem);
		if (placeholder || failed) element.dataset.oiBroken = placeholder ? (placeholder.dataset.reason ?? 'Missing') : 'Error';
		else delete element.dataset.oiBroken;
	}

	private showError(record: FrameRecord, block: ResolvedBlock, error: unknown): void {
		this.destroyHandle(record);
		const message = error instanceof Error ? error.message : String(error);
		record.content.innerHTML =
			`<div class="oi-error"><div class="oi-error-label">${escapeHtml(block.type)} could not render: ${escapeHtml(message)}</div>` +
			`<pre data-oi-s="0">${escapeHtml(block.body)}</pre></div>`;
	}

	private destroyHandle(record: FrameRecord): void {
		try {
			record.handle?.destroy?.();
		} catch {
			// a failing destroy must not break the note
		}
		record.handle = undefined;
	}

	private applyTheme(): void {
		const theme = this.themeRegistry.current();
		applyThemeVariable(this.root, theme, this.registry.moduleTokenList());
		const context = themeContext(theme);
		for (const record of this.recordMap.values()) {
			try {
				record.handle?.theme?.(context);
			} catch {
				// a failed repaint keeps the previous paint
			}
		}
	}

	private installModuleStyle(): void {
		if (typeof document === 'undefined') return;
		const wanted = new Map(this.registry.styleList().map((item) => [item.name, item.style]));
		for (const [name, element] of this.styleElementMap) {
			if (!wanted.has(name)) {
				element.remove();
				this.styleElementMap.delete(name);
			}
		}
		for (const [name, style] of wanted) {
			if (this.styleElementMap.has(name)) continue;
			const element = document.createElement('style');
			element.dataset.oiModule = name;
			element.textContent = style;
			document.head.append(element);
			this.styleElementMap.set(name, element);
		}
	}
}
