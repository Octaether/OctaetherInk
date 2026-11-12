// Where the AI keeps things in the vault, hidden in the app's own folder: its memory (a note, read
// before every conversation) and its conversations (one JSON file each, exactly as the API sent and
// got them, so a chat goes on where it stopped). Without a vault, a chat lives only while it is open.

import type { VaultFile } from '@octaether/core-sdk';
import type { Turn } from './agent';
import { memoryPath } from './tool';

export { memoryPath };
export const chatFolder = '.oi/AI/Chat';
/** Chats put away: out of the list, kept until deleted. */
export const archiveFolder = `${chatFolder}/Archive`;
/** Copies of the files attached to a chat (pictures, PDFs), one folder per chat: they go when the chat is deleted. */
export const attachmentFolder = '.oi/AI/Attachment';

/** Manual: asks before each change. Plan: looks, then proposes; changes nothing. Auto: changes without asking (each can be undone). */
export type Mode = 'Manual' | 'Plan' | 'Auto';
export const modeList: readonly Mode[] = ['Manual', 'Plan', 'Auto'];

export interface Chat {
	id: string;
	title: string;
	/** ISO times. */
	created: string;
	updated: string;
	provider: string;
	model: string;
	mode: Mode;
	turnList: Turn[];
	/** Ask: begun in the Ask AI box (Ctrl+J), and carried on here. */
	kind?: 'Ask';
}

export interface ChatSummary {
	id: string;
	title: string;
	updated: string;
	kind?: 'Ask';
}

/** `20261110-143205-k3x9`: sorts by time, and two chats never share one. */
export function newChatId(now = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export const chatPath = (id: string): string => `${chatFolder}/${id}.json`;
export const archivePath = (id: string): string => `${archiveFolder}/${id}.json`;

/** A chat's title: its first request, shortened. */
export function titleOf(turnList: readonly Turn[]): string {
	for (const turn of turnList) {
		if (turn.role !== 'user') continue;
		const text = turn.content.find((block) => block.type === 'text' && typeof block.text === 'string');
		if (!text) continue;
		const line = String(text.text).replace(/<context>[\s\S]*?<\/context>/g, '').replace(/<mode>[\s\S]*?<\/mode>/g, '').replace(/\s+/g, ' ').trim();
		if (line) return line.length > 60 ? `${line.slice(0, 57).replace(/\s+\S*$/, '')}…` : line;
	}
	return '';
}

export async function readChat(vault: VaultFile, id: string): Promise<Chat | undefined> {
	if (!/^[a-z0-9-]+$/.test(id)) return undefined;
	const text = (await vault.read(chatPath(id))) ?? (await vault.read(archivePath(id)));
	if (!text) return undefined;
	try {
		const chat = JSON.parse(text) as Partial<Chat>;
		if (!Array.isArray(chat.turnList)) return undefined;
		return {
			id,
			title: String(chat.title ?? ''),
			created: String(chat.created ?? ''),
			updated: String(chat.updated ?? ''),
			provider: String(chat.provider ?? ''),
			model: String(chat.model ?? ''),
			mode: modeList.includes(chat.mode as Mode) ? (chat.mode as Mode) : 'Manual',
			turnList: chat.turnList,
			...(chat.kind === 'Ask' ? { kind: 'Ask' as const } : {}),
		};
	} catch {
		return undefined;
	}
}

/** Whether a chat is put away. */
export const isArchived = (vault: VaultFile, id: string): boolean => vault.has(archivePath(id));

export async function writeChat(vault: VaultFile, chat: Chat): Promise<void> {
	await vault.write(isArchived(vault, chat.id) ? archivePath(chat.id) : chatPath(chat.id), `${JSON.stringify(chat)}\n`);
}

/** Puts a chat away (out of the list), or brings it back. */
export async function archiveChat(vault: VaultFile, id: string, archive = true): Promise<void> {
	const [from, to] = archive ? [chatPath(id), archivePath(id)] : [archivePath(id), chatPath(id)];
	if (vault.has(from)) await vault.move(from, to);
}

/** Deletes a chat and the copies of its files, for good (to the trash where the vault can't delete). */
export async function deleteChat(vault: VaultFile, id: string): Promise<void> {
	for (const path of [chatPath(id), archivePath(id), `${attachmentFolder}/${id}`]) {
		if (!vault.has(path)) continue;
		if (vault.remove) await vault.remove(path);
		else await vault.trash(path);
	}
}

export async function renameChat(vault: VaultFile, id: string, title: string): Promise<void> {
	const chat = await readChat(vault, id);
	if (!chat) return;
	chat.title = title.trim() || chat.title;
	await writeChat(vault, chat);
}

/** The vault's chats, newest first: those in the list, or (`archived`) those put away. */
export async function chatList(vault: VaultFile, option: { archived?: boolean } = {}): Promise<ChatSummary[]> {
	const folder = option.archived ? archiveFolder : chatFolder;
	const pathList = vault
		.list(folder)
		.filter((entry) => entry.kind === 'File' && entry.path.endsWith('.json') && !entry.path.slice(folder.length + 1).includes('/'))
		.map((entry) => entry.path);
	const list = await Promise.all(
		pathList.map(async (path): Promise<ChatSummary | undefined> => {
			const id = path.slice(folder.length + 1, -5);
			const text = await vault.read(path);
			if (!text) return undefined;
			try {
				const chat = JSON.parse(text) as Partial<Chat>;
				return { id, title: String(chat.title || id), updated: String(chat.updated ?? ''), ...(chat.kind === 'Ask' ? { kind: 'Ask' as const } : {}) };
			} catch {
				return undefined;
			}
		}),
	);
	return list.filter((item): item is ChatSummary => item !== undefined).sort((left, right) => right.updated.localeCompare(left.updated) || right.id.localeCompare(left.id));
}

/** The memory note's text, without the app's --- header; '' when there is none yet. */
export async function readMemory(vault: VaultFile | undefined): Promise<string> {
	if (!vault?.name()) return '';
	const text = (await vault.read(memoryPath)) ?? '';
	return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}
