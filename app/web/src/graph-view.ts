// Graph view: every note as a dot, every [[link]] as a line (tags and unresolved links on
// request), laid out by a small force simulation. Drag dots, drag the background to pan, wheel or
// pinch to zoom, click a note to open it. Colours come from the theme.

import type { GraphNode, Vault } from '@octaether/core-vault';
import { icon } from './icon';

export interface GraphViewOption {
	vault(): Vault | undefined;
	currentPath(): string | undefined;
	openNote(path: string): void;
	searchTag(tag: string): void;
	close(): void;
}

interface SimNode extends GraphNode {
	x: number;
	y: number;
	vx: number;
	vy: number;
	fixed: boolean;
	match: boolean;
}

const optionKey = 'OctaetherInk.Graph';

function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0) / 4294967296;
}

export class GraphView {
	readonly element: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private nodeList: SimNode[] = [];
	private edgeList: { from: SimNode; to: SimNode }[] = [];
	private neighborMap = new Map<string, Set<string>>();
	private view = { x: 0, y: 0, scale: 1 };
	private alpha = 1;
	private frame = 0;
	private hover: SimNode | undefined;
	private drag: { node?: SimNode; start: { x: number; y: number }; view: { x: number; y: number }; moved: boolean; pointerId: number } | undefined;
	private readonly setting: { tag: boolean; unresolved: boolean; orphan: boolean };
	private filter = '';
	private resizeObserver: ResizeObserver | undefined;

	constructor(
		container: HTMLElement,
		readonly option: GraphViewOption,
	) {
		let saved: Partial<GraphView['setting']> = {};
		try {
			saved = JSON.parse(localStorage.getItem(optionKey) ?? '{}') as Partial<GraphView['setting']>;
		} catch {
			saved = {};
		}
		this.setting = { tag: saved.tag ?? false, unresolved: saved.unresolved ?? false, orphan: saved.orphan ?? true };
		this.element = document.createElement('div');
		this.element.className = 'graph-view';
		this.element.hidden = true;
		this.element.innerHTML =
			'<div class="graph-tool">' +
			'<input class="graph-filter" placeholder="Filter by name" aria-label="Filter by name" spellcheck="false">' +
			'<label><input type="checkbox" data-option="tag"> Tag</label>' +
			'<label><input type="checkbox" data-option="unresolved"> Unresolved link</label>' +
			'<label><input type="checkbox" data-option="orphan"> Unlinked note</label>' +
			`<button type="button" class="icon-button" data-action="Fit" title="Fit everything" aria-label="Fit everything">${icon.Fit}</button>` +
			`<button type="button" class="icon-button" data-action="Close" title="Close the graph (Esc)" aria-label="Close the graph">${icon.Close}</button></div>` +
			'<canvas class="graph-canvas" aria-label="Graph view: every note and link"></canvas>' +
			'<div class="graph-empty" hidden>No notes to show yet. Link notes with [[Note name]] and they appear here.</div>';
		container.append(this.element);
		this.canvas = this.element.querySelector('canvas')!;
		for (const input of this.element.querySelectorAll<HTMLInputElement>('[data-option]')) {
			const name = input.dataset.option as keyof GraphView['setting'];
			input.checked = this.setting[name];
			input.addEventListener('change', () => {
				this.setting[name] = input.checked;
				try {
					localStorage.setItem(optionKey, JSON.stringify(this.setting));
				} catch {
					// not remembered
				}
				this.rebuild();
			});
		}
		this.element.querySelector<HTMLInputElement>('.graph-filter')!.addEventListener('input', (event) => {
			this.filter = (event.target as HTMLInputElement).value.trim().toLowerCase();
			for (const node of this.nodeList) node.match = this.filter !== '' && node.label.toLowerCase().includes(this.filter);
			this.draw();
		});
		this.element.querySelector('[data-action="Fit"]')!.addEventListener('click', () => this.fit());
		this.element.querySelector('[data-action="Close"]')!.addEventListener('click', () => this.option.close());
		this.bindPointer();
	}

	isOpen(): boolean {
		return !this.element.hidden;
	}

	show(): void {
		this.element.hidden = false;
		this.resizeObserver ??= typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.draw()) : undefined;
		this.resizeObserver?.observe(this.canvas);
		this.rebuild();
		this.fit();
	}

	hide(): void {
		this.element.hidden = true;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.resizeObserver?.disconnect();
	}

	/** Reads the vault again (after notes changed), keeping dots where they were. */
	rebuild(): void {
		if (this.element.hidden) return;
		const vault = this.option.vault();
		const graph = vault ? vault.graph(this.setting) : { nodeList: [], edgeList: [] };
		const previous = new Map(this.nodeList.map((node) => [node.id, node]));
		const spread = Math.sqrt(graph.nodeList.length + 1) * 38;
		this.nodeList = graph.nodeList.map((node) => {
			const old = previous.get(node.id);
			if (old) return { ...old, ...node, match: old.match };
			const angle = hash(node.id) * Math.PI * 2;
			const radius = Math.sqrt(hash(`${node.id}r`)) * spread;
			return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, fixed: false, match: false };
		});
		const byId = new Map(this.nodeList.map((node) => [node.id, node]));
		this.edgeList = graph.edgeList.flatMap((edge) => {
			const from = byId.get(edge.from);
			const to = byId.get(edge.to);
			return from && to ? [{ from, to }] : [];
		});
		this.neighborMap = new Map();
		for (const { from, to } of this.edgeList) {
			this.neighborMap.set(from.id, new Set([...(this.neighborMap.get(from.id) ?? []), to.id]));
			this.neighborMap.set(to.id, new Set([...(this.neighborMap.get(to.id) ?? []), from.id]));
		}
		this.element.querySelector<HTMLElement>('.graph-empty')!.hidden = this.nodeList.length > 0;
		this.alpha = 1;
		this.start();
	}

	private start(): void {
		if (this.frame) return;
		const loop = (): void => {
			this.frame = 0;
			this.tick();
			this.draw();
			if (this.alpha > 0.02 || this.drag?.node) this.frame = requestAnimationFrame(loop);
		};
		this.frame = requestAnimationFrame(loop);
	}

	/** One step of the simulation: dots push apart, links pull together, everything drifts to the middle. */
	private tick(): void {
		const list = this.nodeList;
		for (let i = 0; i < list.length; i++) {
			const a = list[i]!;
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j]!;
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let distance = dx * dx + dy * dy;
				if (distance < 1) {
					dx = hash(a.id + b.id) - 0.5;
					dy = hash(b.id + a.id) - 0.5;
					distance = 1;
				}
				if (distance > 250000) continue;
				const force = 1100 / distance;
				a.vx += dx * force * 0.05;
				a.vy += dy * force * 0.05;
				b.vx -= dx * force * 0.05;
				b.vy -= dy * force * 0.05;
			}
		}
		for (const { from, to } of this.edgeList) {
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const distance = Math.hypot(dx, dy) || 1;
			const force = ((distance - 70) / distance) * 0.035;
			from.vx += dx * force;
			from.vy += dy * force;
			to.vx -= dx * force;
			to.vy -= dy * force;
		}
		for (const node of list) {
			node.vx -= node.x * 0.004;
			node.vy -= node.y * 0.004;
			if (node.fixed) {
				node.vx = 0;
				node.vy = 0;
				continue;
			}
			node.vx *= 0.6;
			node.vy *= 0.6;
			node.x += node.vx * Math.max(this.alpha, 0.05);
			node.y += node.vy * Math.max(this.alpha, 0.05);
		}
		this.alpha *= 0.985;
	}

	private radius(node: SimNode): number {
		return 3.2 + Math.sqrt(node.degree) * 1.7;
	}

	private toScreen(node: { x: number; y: number }): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return { x: rect.width / 2 + this.view.x + node.x * this.view.scale, y: rect.height / 2 + this.view.y + node.y * this.view.scale };
	}

	private toWorld(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return { x: (clientX - rect.left - rect.width / 2 - this.view.x) / this.view.scale, y: (clientY - rect.top - rect.height / 2 - this.view.y) / this.view.scale };
	}

	private nodeAt(clientX: number, clientY: number): SimNode | undefined {
		const point = this.toWorld(clientX, clientY);
		let best: SimNode | undefined;
		let bestDistance = Infinity;
		for (const node of this.nodeList) {
			const distance = Math.hypot(node.x - point.x, node.y - point.y);
			if (distance < (this.radius(node) + 5) / Math.min(this.view.scale, 1.4) && distance < bestDistance) {
				best = node;
				bestDistance = distance;
			}
		}
		return best;
	}

	fit(): void {
		const rect = this.canvas.getBoundingClientRect();
		if (this.nodeList.length === 0 || rect.width === 0) {
			this.view = { x: 0, y: 0, scale: 1 };
			this.draw();
			return;
		}
		// let the layout settle a little first, so fitting uses the final shape
		for (let step = 0; step < 120 && this.alpha > 0.1; step++) this.tick();
		const xs = this.nodeList.map((node) => node.x);
		const ys = this.nodeList.map((node) => node.y);
		const width = Math.max(...xs) - Math.min(...xs) + 80;
		const height = Math.max(...ys) - Math.min(...ys) + 80;
		// the toolbar floats over the top: fit below it
		const tool = this.element.querySelector('.graph-tool')?.getBoundingClientRect();
		const top = tool ? Math.max(0, tool.bottom - rect.top) : 0;
		const scale = Math.max(0.25, Math.min(2, Math.min(rect.width / width, (rect.height - top) / height)));
		this.view = { scale, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * scale, y: top / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * scale };
		this.draw();
	}

	private draw(): void {
		const canvas = this.canvas;
		const rect = canvas.getBoundingClientRect();
		const ratio = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
			canvas.width = Math.round(rect.width * ratio);
			canvas.height = Math.round(rect.height * ratio);
		}
		const context = canvas.getContext('2d');
		if (!context) return;
		const style = getComputedStyle(this.element);
		const color = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
		const text = color('--oi-color-text', '#1f2328');
		const muted = color('--oi-color-text-muted', '#656d76');
		const accent = color('--oi-color-accent', '#0969da');
		const border = color('--oi-color-border', '#d0d7de');
		const success = color('--oi-color-success', '#1a7f37');
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, rect.width, rect.height);
		const current = this.option.currentPath();
		const focus = this.hover ?? this.drag?.node;
		const neighbor = focus ? (this.neighborMap.get(focus.id) ?? new Set<string>()) : undefined;
		const dimmed = (node: SimNode): boolean => (focus ? node !== focus && !neighbor!.has(node.id) : this.filter !== '' && !node.match);
		context.lineWidth = 1;
		for (const { from, to } of this.edgeList) {
			const a = this.toScreen(from);
			const b = this.toScreen(to);
			const lit = focus && (from === focus || to === focus);
			context.strokeStyle = lit ? accent : border;
			context.globalAlpha = lit ? 0.9 : focus || this.filter ? 0.25 : 0.7;
			context.beginPath();
			context.moveTo(a.x, a.y);
			context.lineTo(b.x, b.y);
			context.stroke();
		}
		const showAll = this.view.scale > 0.85 || this.nodeList.length < 30;
		context.font = `${Math.round(12 * Math.min(Math.max(this.view.scale, 0.85), 1.3))}px ${color('--oi-font-body', 'system-ui')}`;
		context.textAlign = 'center';
		context.textBaseline = 'top';
		for (const node of this.nodeList) {
			const at = this.toScreen(node);
			const radius = this.radius(node) * Math.min(Math.max(this.view.scale, 0.6), 1.6);
			context.globalAlpha = dimmed(node) ? 0.18 : 1;
			context.fillStyle = node.id === current || node === focus || node.match ? accent : node.kind === 'Tag' ? success : node.kind === 'Unresolved' ? border : muted;
			context.beginPath();
			context.arc(at.x, at.y, radius, 0, Math.PI * 2);
			context.fill();
			if (showAll || node === focus || neighbor?.has(node.id) || node.match || node.id === current) {
				context.fillStyle = node.kind === 'Unresolved' ? muted : text;
				context.fillText(node.label, at.x, at.y + radius + 3);
			}
		}
		context.globalAlpha = 1;
	}

	private bindPointer(): void {
		const canvas = this.canvas;
		canvas.addEventListener('pointerdown', (event) => {
			const node = this.nodeAt(event.clientX, event.clientY);
			this.drag = { node, start: { x: event.clientX, y: event.clientY }, view: { x: this.view.x, y: this.view.y }, moved: false, pointerId: event.pointerId };
			if (node) node.fixed = true;
			canvas.setPointerCapture(event.pointerId);
		});
		canvas.addEventListener('pointermove', (event) => {
			const drag = this.drag;
			if (!drag) {
				const node = this.nodeAt(event.clientX, event.clientY);
				if (node !== this.hover) {
					this.hover = node;
					canvas.style.cursor = node ? 'pointer' : 'grab';
					this.draw();
				}
				return;
			}
			if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 4) drag.moved = true;
			if (drag.node) {
				const point = this.toWorld(event.clientX, event.clientY);
				drag.node.x = point.x;
				drag.node.y = point.y;
				this.alpha = Math.max(this.alpha, 0.3);
				this.start();
			} else {
				this.view.x = drag.view.x + event.clientX - drag.start.x;
				this.view.y = drag.view.y + event.clientY - drag.start.y;
			}
			this.draw();
		});
		const finish = (event: PointerEvent): void => {
			const drag = this.drag;
			this.drag = undefined;
			if (!drag) return;
			if (drag.node) drag.node.fixed = false;
			if (!drag.moved && drag.node && event.type === 'pointerup') {
				if (drag.node.kind === 'Note') this.option.openNote(drag.node.id);
				else if (drag.node.kind === 'Tag') this.option.searchTag(drag.node.label.replace(/^#/, ''));
			}
			this.draw();
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
		canvas.addEventListener(
			'wheel',
			(event) => {
				event.preventDefault();
				const before = this.toWorld(event.clientX, event.clientY);
				this.view.scale = Math.max(0.15, Math.min(4, this.view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
				const after = this.toWorld(event.clientX, event.clientY);
				this.view.x += (after.x - before.x) * this.view.scale;
				this.view.y += (after.y - before.y) * this.view.scale;
				this.draw();
			},
			{ passive: false },
		);
	}
}
