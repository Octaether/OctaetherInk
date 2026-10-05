// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceOffset } from '@octaether/core-edit';
import { NoteModel } from '@octaether/core-model';
import type { ModuleDefinition } from '@octaether/core-sdk';
import { chemModule } from '@octaether/module-chem';
import { codeModule } from '@octaether/module-code';
import { diagramModule } from '@octaether/module-diagram';
import { layoutModule } from '@octaether/module-layout';
import { mathModule } from '@octaether/module-math';
import { textModule } from '@octaether/module-text';
import { themePlugin } from '@octaether/plugin-theme';
import { type HostService, Registry, RenderHost, ThemeRegistry, resolveColor, sanitizeTokenValue, themeContext } from '../src';

// happy-dom replaces the global URL, so resolve the sample through node:path
const welcome = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../sample/Reference.oi'), 'utf8');

interface Setup {
	host: RenderHost;
	model: NoteModel;
	registry: Registry;
	themeRegistry: ThemeRegistry;
	renderCount: Map<string, number>;
	top: string[];
}

function setup(): Setup {
	const registry = new Registry();
	const themeRegistry = new ThemeRegistry();
	const renderCount = new Map<string, number>();
	// wrap every renderer to count how often each block is drawn
	const counted = (module: ModuleDefinition): ModuleDefinition => ({
		...module,
		blockTypeList: module.blockTypeList.map((blockType) => ({
			...blockType,
			render: {
				mount(frame, block, context) {
					renderCount.set(block.key, (renderCount.get(block.key) ?? 0) + 1);
					const handle = blockType.render.mount(frame, block, context);
					if (!handle?.update) return handle;
					return {
						...handle,
						update(next, nextContext) {
							renderCount.set(next.key, (renderCount.get(next.key) ?? 0) + 1);
							return handle.update!(next, nextContext);
						},
					};
				},
			},
		})),
	});
	for (const module of [textModule, layoutModule, mathModule, codeModule, chemModule, diagramModule]) registry.add(counted(module));
	registry.add(themePlugin);
	const service: HostService = {
		registerCommand: () => () => {},
		registerTheme: (theme) => themeRegistry.register(theme),
		setting: () => undefined,
		theme: () => themeContext(themeRegistry.current()),
		applyTheme: (name) => void themeRegistry.apply(name),
		themeList: () => themeRegistry.list(),
	};
	registry.attach(service);
	const root = document.createElement('div');
	document.body.append(root);
	const host = new RenderHost(root, registry, themeRegistry);
	const model = NoteModel.fromText(welcome, registry.formatOption());
	host.mount(model);
	renderCount.clear();
	return { host, model, registry, themeRegistry, renderCount, top: model.document.itemList.map((node) => node.key) };
}

describe('RenderHost', () => {
	it('renders one frame per block, with children inside their parent', () => {
		const { host, model, top } = setup();
		expect(host.root.querySelectorAll('.oi-frame')).toHaveLength(26);
		const list = model.get(top[4]!)!;
		const nestedMath = list.childList[1]!.childList[0]!;
		expect(host.frameOf(nestedMath.key)!.closest('.oi-child')!.parentElement).toBe(host.frameOf(list.childList[1]!.key));
		expect(host.contentOf(top[7]!)!.querySelector('math')).not.toBeNull();
		expect(host.contentOf(top[2]!)!.querySelector('.oi-tag')).not.toBeNull();
		expect(host.contentOf(top[2]!)!.querySelector('.oi-chem-formula')).not.toBeNull();
		expect(host.contentOf(top[11]!)!.querySelector('svg.oi-chem-svg')).not.toBeNull();
		expect(host.contentOf(top[11]!)!.querySelector('.oi-chem-label')?.textContent).toContain('inversion');
	});

	it('re-renders only the block that changed', () => {
		const { host, model, renderCount, top } = setup();
		model.setBody(top[7]!, 'a + b');
		expect([...renderCount.keys()]).toEqual([top[7]]);
		expect(host.contentOf(top[7]!)?.textContent).toContain('a+b');
	});

	it('moves frames without re-rendering them', () => {
		const { host, model, renderCount, top } = setup();
		const frame = host.frameOf(top[9]!);
		model.move(top[9]!, null, null);
		expect(host.root.firstElementChild).toBe(frame);
		expect(renderCount.size).toBe(0);
	});

	it('shows a placeholder with the exact source when a module is off, and restores it', () => {
		const { host, registry, top } = setup();
		registry.setEnabled('Math', false);
		const placeholder = host.contentOf(top[7]!)?.querySelector('.oi-placeholder');
		expect(placeholder?.textContent).toContain('Math: the Math module is off');
		expect(host.frameOf(top[7]!)!.classList.contains('oi-broken')).toBe(true);
		expect(host.frameOf(top[7]!)!.dataset.oiBroken).toBe('Off');
		expect(placeholder?.querySelector('pre')?.textContent).toBe('Math: \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}');
		expect(host.contentOf(top[2]!)?.querySelector('math')).toBeNull();
		registry.setEnabled('Math', true);
		expect(host.contentOf(top[7]!)?.querySelector('math')).not.toBeNull();
	});

	it('keeps core modules on', () => {
		const { registry } = setup();
		registry.setEnabled('Text', false);
		expect(registry.isEnabled('Text')).toBe(true);
	});

	it('switches themes without re-rendering any block', () => {
		const { host, themeRegistry, renderCount, top } = setup();
		expect(host.frameOf(top[5]!)?.getAttribute('style')).toContain('var(--oi-color-surface2)');
		themeRegistry.apply('Dark');
		expect(host.root.style.getPropertyValue('--oi-color-background')).toBe('#161616');
		expect(host.root.style.getPropertyValue('--oi-code-keyword')).toBe('#ec8e6f');
		expect(renderCount.size).toBe(0);
	});

	it('lets a Grid read column widths', () => {
		const { host, model, top } = setup();
		const grid = model.get(top[14]!)!;
		const area = host.frameOf(grid.key)!.querySelector(':scope > .oi-child') as HTMLElement;
		expect(area.getAttribute('style')).toContain('minmax(0, 50fr) minmax(0, 50fr)');
	});

	it('labels code with its language (no picker) and outlines blocks that can’t render as intended', () => {
		const { host, model, top } = setup();
		const code = model.get(top[5]!)!.childList[1]!;
		const content = host.contentOf(code.key)!;
		expect(content.querySelector('select')).toBeNull();
		expect(content.querySelector('.oi-code-label')?.textContent).toBe('Python');
		expect(content.querySelector('.oi-code-copy')).not.toBeNull();
		// an unknown block type keeps its text and gets an outline
		const sheet = model.insert(null, null, model.parseFragment('Sheet {Rows: 3}:\n\ta,b\n')[0]!);
		expect(host.frameOf(sheet)!.classList.contains('oi-broken')).toBe(true);
		expect(host.frameOf(sheet)!.dataset.oiBroken).toBe('Missing');
		expect(host.contentOf(sheet)!.textContent).toContain('a,b');
		// a block that renders but reports mistakes is outlined too
		const chem = model.insert(null, null, model.parseFragment('Chem:\n\t\\chemfig{A}\n\tArrow x -> y\n')[0]!);
		expect(host.frameOf(chem)!.classList.contains('oi-has-problem')).toBe(true);
		model.setBody(chem, '\\chemfig{A}');
		expect(host.frameOf(chem)!.classList.contains('oi-has-problem')).toBe(false);
	});

	it('maps a position in rendered text back to the exact source offset', () => {
		const { host, model, top } = setup();
		const content = host.contentOf(top[1]!)!;
		const span = [...content.querySelectorAll<HTMLElement>('[data-oi-s]')].find((element) => element.textContent?.includes('Click anywhere'))!;
		const textNode = span.firstChild!;
		const inside = span.textContent!.indexOf('anywhere');
		const offset = sourceOffset(content, { node: textNode, offset: inside })!;
		expect(model.bodyOf(top[1]!).slice(offset, offset + 8)).toBe('anywhere');
	});

	it('removes plugin contributions when the plugin is switched off', () => {
		const { registry, themeRegistry } = setup();
		expect(themeRegistry.get('Paper')).toBeDefined();
		registry.setEnabled('Theme', false);
		expect(themeRegistry.get('Paper')).toBeUndefined();
	});
});

describe('theme safety', () => {
	it('accepts colors and tokens, rejects injection', () => {
		const known = (token: string): boolean => token === 'Color.Accent';
		expect(resolveColor('Accent', known)).toBe('var(--oi-color-accent)');
		expect(resolveColor('Unknown', known)).toBeUndefined();
		expect(resolveColor('#12ab34', known)).toBe('#12ab34');
		expect(resolveColor('red;x:y', known)).toBeUndefined();
		expect(sanitizeTokenValue('Color.Text', 'url(https://x)')).toBeUndefined();
		expect(sanitizeTokenValue('Font.Body', "'Inter', sans-serif")).toBe("'Inter', sans-serif");
	});
});
