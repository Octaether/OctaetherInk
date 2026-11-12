// A note, or one block, as a picture (PNG), with no library: the drawn blocks are copied into an
// SVG's foreignObject together with the page's own styles and theme, and the browser paints that
// onto a canvas. So the picture is what the screen shows, in the theme in use: math, chemistry,
// plots, tables. What a page may not read back (a video player, a picture from another site that
// doesn't allow it) is left as an empty box. Loaded only when a picture is asked for.

export interface PictureOption {
	/** The page's color behind the blocks. */
	background: string;
	/** Space around the blocks, in px. */
	padding?: number;
	/** Pixels per CSS px (2 is sharp on every screen); lowered by itself for a very long note. */
	scale?: number;
}

/** Browsers refuse canvases beyond this many pixels (Safari's limit, the smallest). */
const areaLimit = 16_000_000;

function dataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
		reader.readAsDataURL(blob);
	});
}

/** Every style rule of the page, as text (the app's and each module's are all the page's own). */
function pageStyle(): string {
	const partList: string[] = [];
	for (const sheet of document.styleSheets) {
		try {
			for (const rule of sheet.cssRules) partList.push(rule.cssText);
		} catch {
			// a sheet from elsewhere can't be read: there is none in this app
		}
	}
	return partList.join('\n');
}

/** A box of the same size where something can't be copied. */
function placeholder(original: Element): HTMLElement {
	const rect = original.getBoundingClientRect();
	const box = document.createElement('div');
	box.setAttribute('style', `width:${rect.width}px;height:${rect.height}px;border:1px solid currentColor;opacity:0.35;box-sizing:border-box`);
	return box;
}

/** Makes the copy self-contained: canvases and pictures become data, players become boxes, fields show what they hold. */
async function settle(original: Element, copy: Element): Promise<void> {
	const originalList = [original, ...original.querySelectorAll('*')];
	const copyList = [copy, ...copy.querySelectorAll('*')];
	const workList: Promise<void>[] = [];
	originalList.forEach((source, index) => {
		const target = copyList[index];
		if (!target) return;
		// marks of the moment (a selected or edited block, a hover) are not part of the note
		for (const name of ['data-oi-selected', 'data-oi-editing', 'data-oi-editing-parent']) target.removeAttribute(name);
		if (source instanceof HTMLCanvasElement) {
			const image = document.createElement('img');
			const rect = source.getBoundingClientRect();
			image.setAttribute('style', `width:${rect.width}px;height:${rect.height}px;display:block`);
			try {
				image.src = source.toDataURL('image/png');
				target.replaceWith(image);
			} catch {
				target.replaceWith(placeholder(source));
			}
		} else if (source instanceof HTMLImageElement && target instanceof HTMLImageElement) {
			const rect = source.getBoundingClientRect();
			target.width = Math.round(rect.width);
			target.height = Math.round(rect.height);
			target.removeAttribute('loading');
			target.removeAttribute('srcset');
			const address = source.currentSrc || source.src;
			if (address && !address.startsWith('data:')) {
				workList.push(
					fetch(address)
						.then((response) => (response.ok ? response.blob() : Promise.reject(new Error('missing'))))
						.then(dataUrl)
						.then(
							(data) => void (target.src = data),
							() => void target.replaceWith(placeholder(source)),
						),
				);
			}
		} else if (source instanceof HTMLIFrameElement || source instanceof HTMLVideoElement || source instanceof HTMLAudioElement) {
			target.replaceWith(placeholder(source));
		} else if (source instanceof HTMLTextAreaElement) {
			target.textContent = source.value;
		} else if (source instanceof HTMLInputElement) {
			if (source.type === 'checkbox' || source.type === 'radio') {
				if (source.checked) target.setAttribute('checked', '');
				else target.removeAttribute('checked');
			} else target.setAttribute('value', source.value);
		} else if (source instanceof HTMLSelectElement) {
			[...target.querySelectorAll('option')].forEach((option, at) => (at === source.selectedIndex ? option.setAttribute('selected', '') : option.removeAttribute('selected')));
		}
	});
	await Promise.all(workList);
}

/** The SVG that draws `element` as the page does: for the canvas below, and for tests. */
export async function elementSvg(element: HTMLElement, option: PictureOption): Promise<{ svg: string; width: number; height: number }> {
	const padding = option.padding ?? 0;
	const rect = element.getBoundingClientRect();
	const width = Math.ceil(rect.width) + padding * 2;
	const height = Math.ceil(rect.height) + padding * 2;
	const copy = element.cloneNode(true) as HTMLElement;
	await settle(element, copy);
	// the page around the blocks, as far as the styles look at it: the theme's values, the note's own box
	const page = document.createElement('div');
	page.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
	page.setAttribute('class', document.documentElement.className);
	page.setAttribute('style', `${document.documentElement.getAttribute('style') ?? ''};width:${width}px;height:${height}px;box-sizing:border-box;padding:${padding}px;margin:0;overflow:hidden;background:${option.background};color:var(--oi-color-text);font-family:var(--oi-font-body, system-ui, sans-serif)`);
	const style = document.createElement('style');
	style.textContent = pageStyle();
	let inner: HTMLElement = page;
	const note = element.closest<HTMLElement>('.oi-note');
	if (note && note !== element) {
		// a block alone still sits in a note: its fonts, sizes, and theme come from there
		const shell = note.cloneNode(false) as HTMLElement;
		shell.removeAttribute('hidden');
		shell.setAttribute('style', `${note.getAttribute('style') ?? ''};margin:0;padding:0;width:auto;max-width:none;min-height:0`);
		page.append(shell);
		inner = shell;
	}
	copy.style.margin = '0';
	if (note === element) copy.style.cssText += ';padding:0;width:auto;max-width:none;min-height:0';
	inner.append(copy);
	page.prepend(style);
	const body = new XMLSerializer().serializeToString(page);
	return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`, width, height };
}

/** `element` as it is drawn now, as a PNG. Rejects when this browser won't paint or hand back the picture. */
export async function elementPicture(element: HTMLElement, option: PictureOption): Promise<Blob> {
	const { svg, width, height } = await elementSvg(element, option);
	if (width <= 0 || height <= 0) throw new Error('nothing to draw');
	const scale = Math.min(option.scale ?? 2, Math.sqrt(areaLimit / (width * height)));
	const image = new Image();
	image.decoding = 'sync';
	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error('the browser could not draw the picture'));
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no canvas');
	context.fillStyle = option.background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	return new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the browser made no picture'))), 'image/png');
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
