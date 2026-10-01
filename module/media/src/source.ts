// What a Video block points at, and sizes written in a block's properties.

import type { PropertyValue } from '@octaether/core-format';

export type VideoSource =
	/** Played in YouTube's player (the privacy-enhanced one, which sets no cookies until you play). */
	| { kind: 'YouTube'; id: string; start: number | undefined }
	| { kind: 'Vimeo'; id: string; start: number | undefined }
	/** A video file: in the vault, or at a web address. */
	| { kind: 'File'; source: string; start: number | undefined };

const youTubePattern = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})(?=$|[?&#/])/i;
const vimeoPattern = /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})(?=$|[/?#])/i;
const timePattern = /[?&#](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?(?=$|[&#])/;

/** A start time in an address (`t=90`, `t=1m30s`, `#t=90`), in seconds. */
export function startOf(source: string): number | undefined {
	const match = timePattern.exec(source);
	if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
	return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function videoSourceOf(source: string): VideoSource {
	const text = source.trim();
	const youTube = youTubePattern.exec(text);
	if (youTube) return { kind: 'YouTube', id: youTube[1]!, start: startOf(text) };
	const vimeo = vimeoPattern.exec(text);
	if (vimeo) return { kind: 'Vimeo', id: vimeo[1]!, start: startOf(text) };
	return { kind: 'File', source: text.replace(/#t=[\d.,]*$/, ''), start: startOf(text) };
}

/** The player's address for an embedded video; `start` in seconds. */
export function embedUrl(video: Extract<VideoSource, { kind: 'YouTube' | 'Vimeo' }>, start: number | undefined, option: { loop?: boolean; muted?: boolean } = {}): string {
	if (video.kind === 'YouTube') {
		const query = new URLSearchParams({ rel: '0' });
		if (start) query.set('start', String(Math.floor(start)));
		if (option.loop) {
			query.set('loop', '1');
			query.set('playlist', video.id);
		}
		if (option.muted) query.set('mute', '1');
		return `https://www.youtube-nocookie.com/embed/${video.id}?${query}`;
	}
	const query = new URLSearchParams({ dnt: '1' });
	if (option.loop) query.set('loop', '1');
	if (option.muted) query.set('muted', '1');
	return `https://player.vimeo.com/video/${video.id}?${query}${start ? `#t=${Math.floor(start)}s` : ''}`;
}

const lengthPattern = /^\d+(?:\.\d+)?(?:px|%|em|rem|vw)$/;

/** `320` → `320px`; `50%`, `20em` as they are; anything else undefined. */
export function lengthOf(value: PropertyValue | undefined): string | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${value}px`;
	if (typeof value === 'string' && lengthPattern.test(value.trim())) return value.trim();
	return undefined;
}

/** A property that should be a switch: `True` / `False`, or undefined when it isn't one. */
export function switchOf(value: PropertyValue | undefined): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}
