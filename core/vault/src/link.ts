// Links and tags inside note text, the same syntax the Text module renders:
//   [[Note]]  [[Folder/Note]]  [[Note#Heading]]  [[Note|label]]  ![[Note]] (embed)
//   #Tag  #[Tag With Space]  and the `Tag` field of a Property block

import { getSectionValue, parsePropertySection } from '@octaether/core-format';

export interface LinkReference {
	/** As written, without heading or label: `Note` or `Folder/Note`. */
	target: string;
	heading: string | undefined;
	label: string | undefined;
	embed: boolean;
	/** Offsets of the whole `[[…]]` and of the target part in the text. */
	start: number;
	end: number;
	targetStart: number;
	targetEnd: number;
}

const linkPattern = /(!?)\[\[([^[\]|#\n]*)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;

export function linkList(text: string): LinkReference[] {
	const list: LinkReference[] = [];
	for (const match of text.matchAll(linkPattern)) {
		const raw = match[2]!;
		const target = raw.trim();
		if (target === '') continue;
		const start = match.index;
		const targetStart = start + match[1]!.length + 2 + (raw.length - raw.trimStart().length);
		list.push({
			target,
			heading: match[3] ? match[3].slice(1).trim() : undefined,
			label: match[4] ? match[4].slice(1) : undefined,
			embed: match[1] === '!',
			start,
			end: start + match[0].length,
			targetStart,
			targetEnd: targetStart + target.length,
		});
	}
	return list;
}

const inlineTagPattern = /(^|[^\p{L}\p{N}_&])#(?:\[([^\]\n]+)\]|([\p{L}\p{N}_\-/]+))/gu;
/** The header of a Property block, whose indented lines are `Key: value` fields. */
const propertyHeaderPattern = /^(\t*)Property(?:[ \t]+\^[a-z0-9]+)?(?:[ \t]*\{.*\})?:[ \t]*$/;

/**
 * Tags in the note, without repeats: the `Tag` field of its Property blocks (and of its `---`
 * header, where older notes keep it), then inline #tags.
 */
export function tagList(text: string): string[] {
	const seen = new Set<string>();
	const list: string[] = [];
	const add = (tag: string): void => {
		const clean = tag.trim();
		if (clean === '' || seen.has(clean)) return;
		seen.add(clean);
		list.push(clean);
	};
	const lineList = text.replace(/\r\n/g, '\n').split('\n');
	let bodyStart = 0;
	if (lineList[0] === '---') {
		const close = lineList.indexOf('---', 1);
		if (close > 0) {
			const section = parsePropertySection(lineList.slice(1, close));
			const value = getSectionValue(section, 'Tag');
			if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') add(item);
			if (typeof value === 'string') add(value);
			bodyStart = close + 1;
		}
	}
	// skip code (fenced blocks and `Code:` bodies are close enough to skip by fence)
	let inFence = false;
	const bodyList = lineList.slice(bodyStart);
	for (let index = 0; index < bodyList.length; index++) {
		const line = bodyList[index]!;
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		// a Property block: its Tag field, and nothing inside it counts as text
		const property = propertyHeaderPattern.exec(line);
		if (property) {
			const level = property[1]!.length;
			let end = index + 1;
			while (end < bodyList.length && (bodyList[end]!.trim() === '' || /^\t*/.exec(bodyList[end]!)![0].length > level)) end++;
			const section = parsePropertySection(bodyList.slice(index + 1, end), level + 1);
			const value = getSectionValue(section, 'Tag');
			if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') add(item);
			if (typeof value === 'string') add(value);
			index = end - 1;
			continue;
		}
		for (const match of line.matchAll(inlineTagPattern)) {
			const tag = match[2] ?? match[3]!;
			// a heading's "#" is followed by a space, and #123 is a number, not a tag
			if (match[3] && !/[^\p{N}]/u.test(match[3])) continue;
			add(tag);
		}
	}
	return list;
}

/** The link target a note has when it is written as `[[…]]` from anywhere. */
export function linkTargetOf(path: string): string {
	return path.replace(/\.oi$/, '');
}
