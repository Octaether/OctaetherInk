// What you add to a message beyond its words: a note of the vault, or a file from this computer (a
// text or code file, a picture, a PDF). A note is read when the message is sent, as it is then. A
// file is copied into the chat, never among your notes: text inside the message, a picture or a PDF
// in .oi/AI/Attachment/<chat>/ (in the chat itself without a vault), so the chat can go on later and
// deleting the chat deletes the copy.
//
// In a turn it is an `oi_attachment` block, turned into what the API reads just before each request.

import { type VaultFile, t, tr } from '@octaether/core-sdk';
import type { Block, Turn } from './agent';
import { attachmentFolder } from './store';

export type AttachmentKind = 'Note' | 'Text' | 'Image' | 'PDF';

export interface Attachment {
	kind: AttachmentKind;
	name: string;
	/** Image and PDF: the media type (`image/png`). */
	mediaType?: string;
	/** Note: its path in the vault. Image and PDF kept in the vault: the copy's path. */
	path?: string;
	/** Text: the text. Image and PDF without a vault: base64. */
	data?: string;
	size?: number;
}

export const textLimit = 200_000;
export const pictureLimit = 5_000_000;
export const pdfLimit = 10_000_000;
const pictureTypeSet = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const textExtension = /\.(?:txt|md|markdown|oi|csv|tsv|json|ya?ml|toml|xml|html?|css|js|mjs|ts|tsx|jsx|py|r|jl|m|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|swift|sh|ps1|sql|tex|bib|ini|cfg|log)$/i;

export function attachmentBlock(attachment: Attachment): Block {
	return { type: 'oi_attachment', ...attachment };
}

export function attachmentOf(block: Block): Attachment | undefined {
	if (block.type !== 'oi_attachment' || typeof block.name !== 'string') return undefined;
	return block as unknown as Attachment;
}

function base64Of(buffer: ArrayBuffer): string {
	const byteList = new Uint8Array(buffer);
	let text = '';
	for (let index = 0; index < byteList.length; index += 0x8000) text += String.fromCharCode(...byteList.subarray(index, index + 0x8000));
	return btoa(text);
}

/** A file from this computer as an attachment, or why it can't be one. */
export async function readFile(file: File): Promise<Attachment | { problem: string }> {
	const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
	if (pictureTypeSet.has(type)) {
		if (file.size > pictureLimit) return { problem: tr`${file.name} is larger than 5 MB.` };
		return { kind: 'Image', name: file.name, mediaType: type, data: base64Of(await file.arrayBuffer()), size: file.size };
	}
	if (type === 'application/pdf') {
		if (file.size > pdfLimit) return { problem: tr`${file.name} is larger than 10 MB.` };
		return { kind: 'PDF', name: file.name, mediaType: type, data: base64Of(await file.arrayBuffer()), size: file.size };
	}
	if (type.startsWith('text/') || textExtension.test(file.name) || type === 'application/json') {
		if (file.size > textLimit) return { problem: tr`${file.name} is larger than 200 KB of text.` };
		return { kind: 'Text', name: file.name, data: await file.text(), size: file.size };
	}
	return { problem: tr`${file.name} can’t be read by the AI: attach text, code, a picture, or a PDF.` };
}

/** Keeps a picture's or PDF's bytes in the vault, beside the chat; the attachment then names the copy. */
export async function keepInVault(vault: VaultFile | undefined, chatId: string, attachment: Attachment, index: number): Promise<Attachment> {
	if (!vault?.name() || !chatId || (attachment.kind !== 'Image' && attachment.kind !== 'PDF') || attachment.data === undefined) return attachment;
	const safe = attachment.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(-60);
	const path = `${attachmentFolder}/${chatId}/${index}-${safe}.txt`;
	await vault.write(path, attachment.data);
	const { data: _data, ...rest } = attachment;
	return { ...rest, path };
}

/** One attachment as the blocks the API reads (Anthropic's shape; the OpenAI shape is made from it). */
async function expand(attachment: Attachment, vault: VaultFile | undefined): Promise<Block[]> {
	if (attachment.kind === 'Note') {
		const text = attachment.path ? await vault?.read(attachment.path) : undefined;
		if (text === undefined) return [{ type: 'text', text: `<attached_note path="${attachment.path ?? attachment.name}">(This note is no longer in the vault.)</attached_note>` }];
		return [{ type: 'text', text: `<attached_note path="${attachment.path}">\n${text.slice(0, textLimit)}\n</attached_note>` }];
	}
	if (attachment.kind === 'Text') return [{ type: 'text', text: `<attached_file name="${attachment.name}">\n${attachment.data ?? ''}\n</attached_file>` }];
	const data = attachment.data ?? (attachment.path ? await vault?.read(attachment.path) : undefined);
	if (!data) return [{ type: 'text', text: `(The attached file ${attachment.name} is no longer kept.)` }];
	if (attachment.kind === 'Image') return [{ type: 'image', source: { type: 'base64', media_type: attachment.mediaType ?? 'image/png', data } }];
	return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: attachment.name }];
}

/** The conversation as the API reads it: each attachment turned into its blocks (read once, then kept in `cache`). */
export async function expandTurnList(turnList: readonly Turn[], vault: VaultFile | undefined, cache: WeakMap<Block, Block[]>): Promise<Turn[]> {
	if (!turnList.some((turn) => turn.role === 'user' && turn.content.some((block) => block.type === 'oi_attachment'))) return turnList as Turn[];
	const list: Turn[] = [];
	for (const turn of turnList) {
		if (turn.role !== 'user' || !turn.content.some((block) => block.type === 'oi_attachment')) {
			list.push(turn);
			continue;
		}
		const content: Block[] = [];
		for (const block of turn.content) {
			const attachment = attachmentOf(block);
			if (!attachment) {
				content.push(block);
				continue;
			}
			let expanded = cache.get(block);
			if (!expanded) {
				expanded = await expand(attachment, vault);
				cache.set(block, expanded);
			}
			content.push(...expanded);
		}
		list.push({ role: turn.role, content });
	}
	return list;
}

/** A short line for an attachment's chip: `Lecture 05`, `photo.png · 1.2 MB`. */
export function attachmentLabel(attachment: Attachment): string {
	const size = attachment.size === undefined ? '' : attachment.size >= 1_000_000 ? ` · ${(attachment.size / 1_000_000).toFixed(1)} MB` : ` · ${Math.max(1, Math.round(attachment.size / 1000))} KB`;
	return `${attachment.kind === 'Note' ? attachment.name.replace(/\.oi$/, '') : attachment.name}${attachment.kind === 'Note' ? '' : size}`;
}

export const attachmentKindTitle = (kind: AttachmentKind): string => t(kind === 'Note' ? 'Note' : kind === 'Text' ? 'Text file' : kind === 'Image' ? 'Picture' : 'PDF');
