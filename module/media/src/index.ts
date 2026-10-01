// Pictures and videos. The file (or web address) is the header argument, the caption is the body,
// and settings go in braces, as for every block:
//
//   Image {Width: 320}: Attachment/Cell.png   Video {Start: 90}: https://youtu.be/…
//   	A plant cell under the microscope       	The lecture on mitosis
//
// A name alone finds the file anywhere in the vault, as in Obsidian; a web address loads from
// the web. YouTube and Vimeo play in their own players; any other video in the browser's.

import {
	type AssetResolver,
	type BlockTypeDefinition,
	type ModuleDefinition,
	type RenderContext,
	type RenderHandle,
	type ResolvedBlock,
	assetExtension,
	escapeHtml,
	isWebSource,
} from '@octaether/core-sdk';
import { markdownPlainText, renderInline } from '@octaether/module-text';
import { embedUrl, lengthOf, switchOf, videoSourceOf } from './source';

export * from './source';

// Width and Align are every block's own (the frame takes that width and place); inside it the
// picture lines up the same way, so Align = Center centres a picture with no Width too.
const mediaStyle = `
.oi-media { margin: 0; }
.oi-media-box { position: relative; max-width: 100%; }
.oi-media-start .oi-media-box { margin-inline-end: auto; }
.oi-media-center .oi-media-box { margin-inline: auto; }
.oi-media-end .oi-media-box { margin-inline-start: auto; }
.oi-media-center .oi-media-caption { text-align: center; }
.oi-media-end .oi-media-caption { text-align: end; }
.oi-image { display: block; max-width: 100%; height: auto; border-radius: 6px; }
.oi-media-box:has(> .oi-image) { width: fit-content; }
.oi-media-sized .oi-media-box, .oi-media-sized .oi-image { width: 100%; }
.oi-read-only .oi-image.oi-zoomable { cursor: zoom-in; }
.oi-media-caption { margin-top: 0.4em; color: var(--oi-color-text-muted); font-size: 0.9em; line-height: 1.5; }
.oi-media-source { font-family: var(--oi-font-code); font-size: 0.8em; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oi-read-only .oi-media-source { display: none; }
.oi-video .oi-media-box { width: var(--oi-media-width, 100%); }
.oi-video.oi-media-sized .oi-media-box { width: 100%; }
.oi-video-frame { aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #000; }
.oi-video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.oi-video-file { display: block; width: 100%; max-height: 80vh; border-radius: 8px; background: #000; }
.oi-media-empty, .oi-media-missing { padding: 18px 16px; border: 1px dashed var(--oi-color-border); border-radius: 8px; color: var(--oi-color-text-muted); font-size: 0.9em; text-align: center; }
.oi-media-missing { border-color: var(--oi-color-warning); }
.oi-media-zoom { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, 0.82); cursor: zoom-out; }
.oi-media-zoom img { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); }
`;

function sourceOf(block: ResolvedBlock): string {
	const value = block.property.get('Source');
	return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function textOf(block: ResolvedBlock, name: string): string | undefined {
	const value = block.property.get(name);
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The body is the caption: Markdown in a line or two. */
function captionHtml(block: ResolvedBlock, context: RenderContext): string {
	if (block.body.trim() === '') return '';
	const option = { resolveColor: context.resolveColor, renderInline: context.renderInline };
	let offset = 0;
	const lineList = block.body.split('\n').map((line) => {
		const html = renderInline(line, option, offset);
		offset += line.length + 1;
		return html;
	});
	return `<figcaption class="oi-media-caption">${lineList.join('<br>')}</figcaption>`;
}

/** With no caption, the Edit view shows where the file comes from: something to click to edit it. */
function sourceLine(block: ResolvedBlock, context: RenderContext, source: string): string {
	return block.body.trim() === '' && !context.readOnly() ? `<figcaption class="oi-media-caption oi-media-source"><span data-oi-s="0">${escapeHtml(source)}</span></figcaption>` : '';
}

async function urlOf(source: string, context: RenderContext): Promise<string | undefined> {
	if (isWebSource(source)) return source;
	return context.extension<AssetResolver>(assetExtension)?.url(source);
}

/** Where the picture sits in its frame: the block's Align (Left, Center, Right, or Start, End), else the setting. */
function alignOf(block: ResolvedBlock, context: RenderContext): 'start' | 'center' | 'end' {
	const align = textOf(block, 'Align') ?? context.setting('Image.Align');
	if (align === 'Left' || align === 'Start') return 'start';
	if (align === 'Right' || align === 'End') return 'end';
	return 'center';
}

/** The figure's classes: its alignment, and whether its frame has a width the picture fills. */
function figureClass(block: ResolvedBlock, context: RenderContext, extra = ''): string {
	return `oi-media${extra} oi-media-${alignOf(block, context)}${lengthOf(block.property.get('Width')) ? ' oi-media-sized' : ''}`;
}

/** The picture can't be shown: say why where it would be, and outline the block. */
function showMissing(root: HTMLElement, source: string, reason: string): void {
	const box = root.querySelector<HTMLElement>('.oi-media-box');
	if (!box) return;
	box.outerHTML = `<div class="oi-media-missing" data-oi-problem>${escapeHtml(`“${source}” ${reason}.`)}</div>`;
	root.closest('.oi-frame')?.classList.add('oi-has-problem');
}

/** Shows a picture full size over everything (the Read view); a click or Esc closes it. */
function zoom(image: HTMLImageElement): void {
	const layer = document.createElement('div');
	layer.className = 'oi-media-zoom';
	layer.setAttribute('role', 'dialog');
	layer.setAttribute('aria-label', image.alt || 'Picture');
	layer.innerHTML = `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}">`;
	const close = (): void => {
		layer.remove();
		document.removeEventListener('keydown', onKey, true);
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		close();
	};
	layer.addEventListener('click', close);
	document.addEventListener('keydown', onKey, true);
	document.body.append(layer);
}

/** A renderer that draws again on every change; `token` drops answers meant for an earlier drawing. */
function renderer(draw: (frame: HTMLElement, block: ResolvedBlock, context: RenderContext, current: () => boolean) => void): BlockTypeDefinition['render'] {
	return {
		mount(frame, block, context): RenderHandle {
			let token = 0;
			const run = (next: ResolvedBlock, nextContext: RenderContext): void => {
				const mine = ++token;
				draw(frame, next, nextContext, () => mine === token);
			};
			run(block, context);
			return {
				update(next, nextContext) {
					run(next, nextContext);
					return 'Done';
				},
				destroy() {
					token++;
				},
			};
		},
	};
}

function drawImage(frame: HTMLElement, block: ResolvedBlock, context: RenderContext, current: () => boolean): void {
	const source = sourceOf(block);
	if (source === '') {
		frame.innerHTML = '<figure class="oi-media"><div class="oi-media-empty" data-oi-s="0">Paste or drop a picture here, or write its name (or a web address) after “Image:”.</div></figure>';
		return;
	}
	const alt = textOf(block, 'Alt') ?? (markdownPlainText(block.body).trim() || source.split('/').pop() || '');
	frame.innerHTML =
		`<figure class="${figureClass(block, context)}">` +
		`<div class="oi-media-box"><img class="oi-image" alt="${escapeHtml(alt)}" decoding="async"></div>` +
		`${captionHtml(block, context) || sourceLine(block, context, source)}</figure>`;
	const image = frame.querySelector<HTMLImageElement>('.oi-image')!;
	if (context.setting('Image.Zoom') !== false) image.classList.add('oi-zoomable');
	image.addEventListener('click', () => {
		if (context.readOnly() && context.setting('Image.Zoom') !== false && image.currentSrc) zoom(image);
	});
	void urlOf(source, context).then((url) => {
		if (!current()) return;
		if (!url) {
			showMissing(frame, source, 'is not in the vault');
			return;
		}
		image.addEventListener('error', () => current() && showMissing(frame, source, 'didn’t load'), { once: true });
		image.src = url;
	});
}

function drawVideo(frame: HTMLElement, block: ResolvedBlock, context: RenderContext, current: () => boolean): void {
	const source = sourceOf(block);
	if (source === '') {
		frame.innerHTML = '<figure class="oi-media oi-video"><div class="oi-media-empty" data-oi-s="0">Write a YouTube or Vimeo address, or a video file’s name, after “Video:”.</div></figure>';
		return;
	}
	const video = videoSourceOf(source);
	const startValue = block.property.get('Start');
	const start = typeof startValue === 'number' && startValue >= 0 ? startValue : video.start;
	const loop = switchOf(block.property.get('Loop')) === true;
	const muted = switchOf(block.property.get('Muted')) === true;
	// the block's own Width sizes its frame; without one, the setting sizes the player
	const setting = context.setting('Video.Width');
	const width = lengthOf(block.property.get('Width')) ? undefined : lengthOf(typeof setting === 'string' && setting !== '100%' ? setting : undefined);
	const caption = captionHtml(block, context) || sourceLine(block, context, source);
	const open = `<figure class="${figureClass(block, context, ' oi-video')}"${width ? ` style="--oi-media-width: ${width}"` : ''}>`;
	if (video.kind !== 'File') {
		const title = textOf(block, 'Title') ?? (markdownPlainText(block.body).trim() || `${video.kind} video`);
		// the player runs in its own sandbox; a click in it plays the video, so the caption is what opens the editor
		frame.innerHTML =
			`${open}<div class="oi-media-box oi-video-frame"><iframe src="${escapeHtml(embedUrl(video, start, { loop, muted }))}" title="${escapeHtml(title)}" loading="lazy"` +
			' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"' +
			` sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>${caption}</figure>`;
		return;
	}
	frame.innerHTML = `${open}<div class="oi-media-box"><video class="oi-video-file" controls preload="metadata" playsinline data-oi-interactive${loop ? ' loop' : ''}${muted ? ' muted' : ''}></video></div>${caption}</figure>`;
	const player = frame.querySelector<HTMLVideoElement>('video')!;
	void urlOf(video.source, context).then((url) => {
		if (!current()) return;
		if (!url) {
			showMissing(frame, video.source, 'is not in the vault');
			return;
		}
		player.addEventListener('error', () => current() && showMissing(frame, video.source, 'didn’t load'), { once: true });
		player.src = start ? `${url}#t=${start}` : url;
	});
}

const imageBlockType: BlockTypeDefinition = {
	name: 'Image',
	content: 'Raw',
	argument: 'Source',
	// the frame sits where the Image.Align setting says unless the block says Align itself
	defaultProperty: (setting) => new Map([['Align', setting('Image.Align') === 'Left' ? 'Start' : setting('Image.Align') === 'Right' ? 'End' : 'Center']]),
	render: renderer(drawImage),
	edit: { kind: 'SourcePreview' },
	templateList: [
		{ title: 'Image', icon: '▣', source: 'Image:', keywordList: ['picture', 'photo', 'figure', 'png', 'jpg'], explain: 'A picture from the vault or the web; paste or drop one to add it' },
	],
	style: mediaStyle,
	plainText: (block) => markdownPlainText(block.body),
};

const videoBlockType: BlockTypeDefinition = {
	name: 'Video',
	content: 'Raw',
	argument: 'Source',
	defaultProperty: () => new Map([['Align', 'Center']]),
	render: renderer(drawVideo),
	edit: { kind: 'SourcePreview' },
	templateList: [{ title: 'Video', icon: '▶', source: 'Video:', keywordList: ['youtube', 'vimeo', 'movie', 'mp4', 'film'], explain: 'YouTube, Vimeo, or a video file' }],
	// the Image module installs the shared styles; this one works on its own too
	style: mediaStyle,
	plainText: (block) => markdownPlainText(block.body),
};

export const imageModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Image',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Image',
	explain:
		'Pictures: "Image: photo.png" (from the vault) or a web address, with a caption on the lines below and settings in braces, as for every block: Image {Width: 320, Align: Left}: photo.png. Paste or drop a picture on a note to add it. Text can show pictures too, written ![](photo.png) or ![[photo.png]].',
	settingList: [
		{ id: 'Image.Align', title: 'Where a picture sits', type: 'Choice', choiceList: ['Left', 'Center', 'Right'], default: 'Center', explain: 'For a picture whose block doesn’t say ({Align: Left}).' },
		{ id: 'Image.Zoom', title: 'Click to see it full size', type: 'Toggle', default: true, explain: 'In the Read view, a click on a picture shows it over everything; a click or Esc closes it.' },
	],
	blockTypeList: [imageBlockType],
};

export const videoModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Video',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Video',
	explain:
		'Videos: a YouTube or Vimeo address, or a video file in the vault or on the web, with a caption on the lines below. {Start: 90} starts it 90 seconds in; {Loop: True} and {Muted: True} do what they say. YouTube plays without cookies until you press play.',
	settingList: [
		{ id: 'Video.Width', title: 'Video width', type: 'Choice', choiceList: ['100%', '75%', '50%'], default: '100%', explain: 'For a video whose block doesn’t say (Width = 480).' },
	],
	blockTypeList: [videoBlockType],
};
