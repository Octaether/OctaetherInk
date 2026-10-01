// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import { assetExtension } from '@octaether/core-sdk';
import { textModule } from '@octaether/module-text';
import { describe, expect, it } from 'vitest';
import { embedUrl, imageModule, lengthOf, startOf, videoModule, videoSourceOf } from '../src';

describe('video sources', () => {
	it('knows YouTube and Vimeo in every form, with their start time', () => {
		for (const address of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ']) {
			expect(videoSourceOf(address), address).toMatchObject({ kind: 'YouTube', id: 'dQw4w9WgXcQ' });
		}
		expect(videoSourceOf('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({ kind: 'YouTube', id: 'dQw4w9WgXcQ', start: 90 });
		expect(videoSourceOf('https://vimeo.com/76979871#t=15')).toEqual({ kind: 'Vimeo', id: '76979871', start: 15 });
		expect(videoSourceOf('Lecture/Mitosis.mp4')).toEqual({ kind: 'File', source: 'Lecture/Mitosis.mp4', start: undefined });
		expect(startOf('clip.mp4?t=1h2m3s')).toBe(3723);
	});

	it('plays YouTube without cookies, from the start time, and loops when asked', () => {
		const video = videoSourceOf('https://youtu.be/dQw4w9WgXcQ');
		if (video.kind !== 'YouTube') throw new Error('not YouTube');
		expect(embedUrl(video, 90, { loop: true })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90&loop=1&playlist=dQw4w9WgXcQ');
	});

	it('reads sizes as CSS lengths and refuses anything else', () => {
		expect(lengthOf(320)).toBe('320px');
		expect(lengthOf('50%')).toBe('50%');
		expect(lengthOf('calc(1px)')).toBeUndefined();
		expect(lengthOf(-4)).toBeUndefined();
	});
});

describe('Image and Video blocks', () => {
	function mount(text: string, fileMap: Record<string, string> = {}) {
		// the test browser must not load the players it is shown
		(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true;
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(imageModule, true);
		registry.add(videoModule, true);
		const askedList: string[] = [];
		registry.registerExtension(assetExtension, {
			url: async (source: string) => {
				askedList.push(source);
				return fileMap[source];
			},
		});
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		return { model, host, askedList };
	}

	it('reads the file after the colon and the caption below it', async () => {
		const { model, askedList } = mount('Image {Width: 320, Align: Left}: Cell.png\n\tA plant **cell**\n', { 'Cell.png': 'blob:cell' });
		expect(model.document.itemList[0]!.property).toEqual(
			new Map<string, unknown>([
				['Source', 'Cell.png'],
				['Width', 320],
				['Align', 'Left'],
			]),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Width is every block's own: the frame takes it, and the picture fills the frame
		const figure = document.querySelector<HTMLElement>('.oi-media')!;
		expect(figure.className).toBe('oi-media oi-media-start oi-media-sized');
		expect(document.querySelector<HTMLElement>('.oi-frame')!.style.width).toBe('320px');
		expect(document.querySelector<HTMLElement>('.oi-frame')!.style.marginInlineEnd).toBe('auto');
		expect(document.querySelector('img')!.getAttribute('src')).toBe('blob:cell');
		expect(document.querySelector('img')!.getAttribute('alt')).toBe('A plant cell');
		expect(document.querySelector('figcaption strong')!.textContent).toBe('cell');
		expect(askedList).toEqual(['Cell.png']);
	});

	it('centres a sized picture and a video by default through the host’s Align, and a block can say otherwise', async () => {
		mount('Image {Width: 200}: Cell.png\n\nVideo {Width: 300}: Clip.mp4\n\nImage {Width: 200, Align: Right}: Cell.png\n', { 'Cell.png': 'blob:cell', 'Clip.mp4': 'blob:clip' });
		const [image, video, right] = [...document.querySelectorAll<HTMLElement>('.oi-frame')];
		expect([image!.style.marginInlineStart, image!.style.marginInlineEnd]).toEqual(['auto', 'auto']);
		expect([video!.style.marginInlineStart, video!.style.marginInlineEnd]).toEqual(['auto', 'auto']);
		expect([right!.style.marginInlineStart, right!.style.marginInlineEnd]).toEqual(['auto', '']);
	});

	it('says so when the file isn’t in the vault', async () => {
		mount('Image: Missing.png\n');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.querySelector('.oi-media-missing')!.textContent).toBe('“Missing.png” is not in the vault.');
		expect(document.querySelector('.oi-frame')!.classList.contains('oi-has-problem')).toBe(true);
	});

	it('embeds YouTube in a sandboxed player, and plays a file in the browser’s', async () => {
		mount('Video {Start: 30}: https://youtu.be/dQw4w9WgXcQ\n\nVideo {Loop: True}: Clip.mp4\n', { 'Clip.mp4': 'blob:clip' });
		const frame = document.querySelector('iframe')!;
		expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=30');
		expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
		await new Promise((resolve) => setTimeout(resolve, 0));
		const video = document.querySelector('video')!;
		expect(video.getAttribute('src')).toBe('blob:clip');
		expect(video.hasAttribute('loop')).toBe(true);
		// with no caption, the Edit view shows the address: something to click to edit the block
		expect(document.querySelector('.oi-media-source')!.textContent).toBe('https://youtu.be/dQw4w9WgXcQ');
	});
});
