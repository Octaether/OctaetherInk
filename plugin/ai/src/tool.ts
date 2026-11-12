// What the AI can do in the vault, as Claude Code or Copilot can in a project: look (list, read,
// search, see a note drawn, read a module's guide), and change (write, edit, move, delete, make
// folders, remember, run a command). A change is first prepared, so it can be shown (with its diff)
// and asked about before it is made, as the mode says; every change made can be undone.

import { type BlockGuide, type CommandAccess, type VaultChange, type VaultFile, t, tr } from '@octaether/core-sdk';

/** Read: looks or shows, never changes a file. Change: changes the vault or the app, asked about in Manual mode, refused in Plan mode. */
export type ToolKind = 'Read' | 'Change';

export interface ToolDefinition {
	name: string;
	description: string;
	kind: ToolKind;
	schema: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[]; additionalProperties: false };
	/** Its answer is a picture, which only Claude reads in a tool result. */
	picture?: boolean;
}

const string = (description: string): { type: string; description: string } => ({ type: 'string', description });
const schema = (properties: ToolDefinition['schema']['properties'], required: string[] = Object.keys(properties)): ToolDefinition['schema'] => ({ type: 'object', properties, required, additionalProperties: false });

export const memoryPath = '.oi/AI/Memory.oi';

export const toolList: readonly ToolDefinition[] = [
	{ name: 'list_files', kind: 'Read', description: 'Lists the files and folders of the vault (or of one folder in it), one path per line; folders end with /.', schema: schema({ folder: string('A folder of the vault; empty for the whole vault.') }, []) },
	{ name: 'read_file', kind: 'Read', description: 'Reads a text file of the vault: a note (.oi, as OI text), or .md, .txt, .csv and similar. A note that is open includes its unsaved edits.', schema: schema({ path: string('The path from the top of the vault, e.g. Chemistry/SN2.oi') }) },
	{ name: 'search_notes', kind: 'Read', description: 'Finds the notes whose text matches the words (or, with tag:Name, that have a tag), with a line from each.', schema: schema({ query: string('Words to find, or tag:Name') }) },
	{ name: 'read_skill', kind: 'Read', description: 'Reads how to write a block type of a module (its syntax and examples). Read the skill of a type before writing blocks of it.', schema: schema({ type: string('The block type, e.g. Table, Plot, Chem, Calendar') }) },
	{ name: 'view_note', kind: 'Read', picture: true, description: 'Shows a note as the app draws it, as a picture: to check how blocks look (a plot, a table, a structure).', schema: schema({ path: string('The note’s path') }) },
	{ name: 'list_commands', kind: 'Read', description: 'Lists the app’s commands (the buttons and menu items of the command palette), one “id: title” per line.', schema: schema({}, []) },
	{ name: 'open_note', kind: 'Read', description: 'Opens a note or file for the user, in a tab behind this one.', schema: schema({ path: string('The path of the note or file') }) },
	{ name: 'write_file', kind: 'Change', description: 'Creates a file, or replaces the whole text of one. For a small change to a long note, edit_file is better.', schema: schema({ path: string('The path, e.g. Chemistry/SN2.oi; missing folders are made'), content: string('The whole text of the file (a note: OI text; no --- header needed)') }) },
	{ name: 'edit_file', kind: 'Change', description: 'Replaces one piece of text in a file with another. old_text must be found exactly once (include enough of the lines around it).', schema: schema({ path: string('The file’s path'), old_text: string('The exact text to replace, as it is in the file'), new_text: string('What goes in its place') }) },
	{ name: 'move_file', kind: 'Change', description: 'Moves or renames a file or folder; [[links]] to it follow.', schema: schema({ path: string('Where it is'), to: string('Its new full path') }) },
	{ name: 'delete_file', kind: 'Change', description: 'Moves a file or folder to the vault’s trash.', schema: schema({ path: string('The path') }) },
	{ name: 'create_folder', kind: 'Change', description: 'Makes a folder.', schema: schema({ path: string('The folder’s path') }) },
	{ name: 'remember', kind: 'Change', description: 'Adds a line to your memory for this vault (read before every conversation): a preference of the user, a fact about the vault, a way of working. Keep it short.', schema: schema({ text: string('What to remember, in one or two sentences') }) },
	{ name: 'run_command', kind: 'Change', description: 'Runs one of the app’s commands (see list_commands), as a click on its button would.', schema: schema({ id: string('The command’s id, e.g. View.Read'), argument: string('Its argument, if it takes one') }, ['id']) },
];

export const toolByName = new Map(toolList.map((tool) => [tool.name, tool]));

export interface ToolOutput {
	text: string;
	/** A PNG, base64. */
	picture?: string;
	isError?: boolean;
}

/** What a change will do, for the card that shows (and asks about) it. */
export interface ChangePreview {
	title: string;
	path?: string;
	/** The file's text before and after, for a diff. */
	before?: string;
	after?: string;
}

export type PreparedTool =
	| { kind: 'Read'; title: string; run(): Promise<ToolOutput> }
	| { kind: 'Change'; title: string; preview: ChangePreview; apply(): Promise<{ output: ToolOutput; change?: VaultChange }> }
	| { kind: 'Error'; title: string; output: ToolOutput };

export interface ToolHost {
	vault: VaultFile | undefined;
	command: CommandAccess | undefined;
	guide: BlockGuide | undefined;
}

const textLimit = 120_000;

function stringOf(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** A path the AI may change: inside the vault, not the app's own folder (memory has its own tool). */
export function pathProblem(path: string): string | undefined {
	const clean = path.trim();
	if (clean === '' || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((part) => part === '..' || part === '.' || part === '')) return tr`“${path}” is not a path inside the vault.`;
	if (clean === '.oi' || clean.startsWith('.oi/')) return t('The app’s own folder (.oi) is not changed with files; memory has its own tool.');
	if (/[\\:*?"<>|]/.test(clean)) return tr`“${path}” has a character a file name can’t hold.`;
	return undefined;
}

const error = (title: string, text: string): PreparedTool => ({ kind: 'Error', title, output: { text, isError: true } });

/** A short line of what a call does, for its card. */
export function describe(name: string, input: Record<string, unknown>): string {
	const path = stringOf(input.path) ?? '';
	switch (name) {
		case 'list_files':
			return stringOf(input.folder) ? tr`Listed ${stringOf(input.folder)!}` : t('Listed the vault');
		case 'read_file':
			return tr`Read ${path}`;
		case 'search_notes':
			return tr`Searched the notes for “${stringOf(input.query) ?? ''}”`;
		case 'read_skill':
			return tr`Read how to write ${stringOf(input.type) ?? ''}`;
		case 'view_note':
			return tr`Looked at ${path}`;
		case 'list_commands':
			return t('Listed the app’s commands');
		case 'open_note':
			return tr`Opened ${path}`;
		case 'write_file':
			return tr`Write ${path}`;
		case 'edit_file':
			return tr`Edit ${path}`;
		case 'move_file':
			return tr`Move ${path} to ${stringOf(input.to) ?? ''}`;
		case 'delete_file':
			return tr`Delete ${path}`;
		case 'create_folder':
			return tr`Make the folder ${path}`;
		case 'remember':
			return tr`Remember: ${stringOf(input.text) ?? ''}`;
		case 'run_command':
			return tr`Run ${stringOf(input.id) ?? ''}`;
		default:
			return name;
	}
}

/** Gets a call ready: what it reads, or what it would change (with the text before and after), or why it can't. */
export async function prepareTool(name: string, input: Record<string, unknown>, host: ToolHost): Promise<PreparedTool> {
	const title = describe(name, input);
	const tool = toolByName.get(name);
	if (!tool) return error(title, tr`There is no tool “${name}”.`);
	for (const key of tool.schema.required) if (typeof input[key] !== 'string') return error(title, tr`“${key}” is missing: the tool needs it as text.`);
	const vault = host.vault;
	const needVault = name !== 'list_commands' && name !== 'run_command' && name !== 'read_skill';
	if (needVault && !vault?.name()) return error(title, t('No vault is open: open one to work with its files.'));
	const path = stringOf(input.path)?.trim() ?? '';
	switch (name) {
		case 'list_files': {
			const folder = (stringOf(input.folder) ?? '').replace(/^\/+|\/+$/g, '');
			const list = vault!.list(folder);
			return { kind: 'Read', title, run: async () => ({ text: list.length === 0 ? t('(nothing there)') : list.slice(0, 2000).map((entry) => (entry.kind === 'Folder' ? `${entry.path}/` : entry.path)).join('\n') }) };
		}
		case 'read_file':
			return {
				kind: 'Read',
				title,
				run: async () => {
					const text = await vault!.read(path);
					if (text === undefined) return { text: vault!.has(path) ? tr`“${path}” is not a text file.` : tr`There is no file “${path}”.`, isError: true };
					return { text: text.length > textLimit ? `${text.slice(0, textLimit)}\n…(${tr`cut here: the file has ${text.length} characters`})` : text };
				},
			};
		case 'search_notes': {
			const list = vault!.search(stringOf(input.query) ?? '');
			return { kind: 'Read', title, run: async () => ({ text: list.length === 0 ? t('No note matches.') : list.map((item) => `${item.path}: ${item.line}`).join('\n') }) };
		}
		case 'read_skill':
			return {
				kind: 'Read',
				title,
				run: async () => {
					const list = (await host.guide?.list()) ?? [];
					const wanted = (stringOf(input.type) ?? '').trim().toLowerCase();
					const entry = list.find((item) => item.type.toLowerCase() === wanted);
					if (!entry) return { text: tr`No block type “${stringOf(input.type) ?? ''}”. The types are: ${list.map((item) => item.type).join(', ')}.`, isError: true };
					const exampleList = entry.guide ? [] : entry.exampleList.filter((source) => source.trim() !== '').slice(0, 3);
					return { text: [`## ${entry.type}`, entry.guide ?? '', ...exampleList.map((source) => `<example>\n${source}\n</example>`)].filter(Boolean).join('\n\n') };
				},
			};
		case 'view_note':
			return {
				kind: 'Read',
				title,
				run: async () => {
					const blob = await vault!.picture(path);
					if (!blob) return { text: tr`Couldn’t draw “${path}”.`, isError: true };
					const bytes = new Uint8Array(await blob.arrayBuffer());
					let binary = '';
					for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
					return { text: tr`${path} as drawn:`, picture: btoa(binary) };
				},
			};
		case 'list_commands': {
			const list = host.command?.list() ?? [];
			return { kind: 'Read', title, run: async () => ({ text: list.filter((item) => !item.id.startsWith('AI.')).map((item) => `${item.id}: ${item.title}${item.explain ? ` (${item.explain})` : ''}`).join('\n') }) };
		}
		case 'open_note':
			if (!vault!.has(path)) return error(title, tr`There is no file “${path}”.`);
			return {
				kind: 'Read',
				title,
				run: async () => {
					vault!.open(path, { background: true });
					return { text: tr`${path} is open in a tab.` };
				},
			};
		case 'write_file':
		case 'edit_file': {
			const problem = pathProblem(path);
			if (problem) return error(title, problem);
			if (vault!.list().some((entry) => entry.kind === 'Folder' && entry.path === path)) return error(title, tr`“${path}” is a folder.`);
			const before = vault!.has(path) ? await vault!.read(path) : undefined;
			if (vault!.has(path) && before === undefined) return error(title, tr`“${path}” is not a text file.`);
			let after: string;
			if (name === 'write_file') after = stringOf(input.content) ?? '';
			else {
				if (before === undefined) return error(title, tr`There is no file “${path}”.`);
				const oldText = stringOf(input.old_text) ?? '';
				const count = oldText === '' ? 0 : before.split(oldText).length - 1;
				if (count === 0) return error(title, tr`The text to replace isn’t in “${path}”. Read the file again and copy it exactly.`);
				if (count > 1) return error(title, tr`The text to replace is in “${path}” ${count} times. Include more of the lines around it.`);
				after = before.replace(oldText, () => stringOf(input.new_text) ?? '');
			}
			if (path.endsWith('.oi') && !after.endsWith('\n')) after += '\n';
			const own = after;
			return {
				kind: 'Change',
				title: before === undefined ? tr`Create ${path}` : title,
				preview: { title: before === undefined ? tr`Create ${path}` : title, path, before: before ?? '', after: own },
				apply: async () => {
					const change = await vault!.write(path, own);
					return { output: { text: before === undefined ? tr`Created ${path}.` : tr`Changed ${path}.` }, change };
				},
			};
		}
		case 'move_file': {
			const target = (stringOf(input.to) ?? '').trim();
			const problem = pathProblem(path) ?? pathProblem(target);
			if (problem) return error(title, problem);
			if (!vault!.has(path)) return error(title, tr`There is no file “${path}”.`);
			if (vault!.has(target)) return error(title, tr`“${target}” exists already.`);
			return {
				kind: 'Change',
				title,
				preview: { title, path },
				apply: async () => {
					const change = await vault!.move(path, target);
					return { output: { text: tr`Moved ${path} to ${change.path}.` }, change };
				},
			};
		}
		case 'delete_file': {
			const problem = pathProblem(path);
			if (problem) return error(title, problem);
			if (!vault!.has(path)) return error(title, tr`There is no file “${path}”.`);
			const before = await vault!.read(path);
			return {
				kind: 'Change',
				title,
				preview: { title, path, ...(before !== undefined ? { before, after: '' } : {}) },
				apply: async () => {
					const change = await vault!.trash(path);
					return { output: { text: tr`${path} is in the trash.` }, change };
				},
			};
		}
		case 'create_folder': {
			const problem = pathProblem(path);
			if (problem) return error(title, problem);
			if (vault!.has(path)) return error(title, tr`“${path}” exists already.`);
			return {
				kind: 'Change',
				title,
				preview: { title, path },
				apply: async () => {
					const change = await vault!.makeFolder(path);
					return { output: { text: tr`Made the folder ${change.path}.` }, change };
				},
			};
		}
		case 'remember': {
			const text = (stringOf(input.text) ?? '').trim().replace(/\s*\n\s*/g, ' ');
			if (text === '') return error(title, t('There is nothing to remember.'));
			const before = (await vault!.read(memoryPath)) ?? `${t('# Memory')}\n\n${t('What the AI knows about this vault and how you like to work. It reads this before every conversation; edit it freely.')}\n`;
			const after = `${before.replace(/\s*$/, '')}\n\n- ${text}\n`;
			return {
				kind: 'Change',
				title,
				preview: { title, path: memoryPath, before, after },
				apply: async () => ({ output: { text: t('Remembered.') }, change: await vault!.write(memoryPath, after) }),
			};
		}
		case 'run_command': {
			const id = (stringOf(input.id) ?? '').trim();
			const known = host.command?.list().find((item) => item.id === id);
			if (!known || id.startsWith('AI.')) return error(title, tr`There is no command “${id}”. list_commands lists them.`);
			const argument = stringOf(input.argument);
			return {
				kind: 'Change',
				title: tr`Run “${t(known.title)}”`,
				preview: { title: tr`Run “${t(known.title)}”${argument ? ` (${argument})` : ''}` },
				apply: async () => {
					const ran = host.command!.run(id, argument);
					return { output: { text: ran ? tr`Ran ${id}.` : tr`${id} didn’t run.`, isError: !ran } };
				},
			};
		}
		default:
			return error(title, tr`There is no tool “${name}”.`);
	}
}

// ---------------------------------------------------------------- a diff of lines, for the cards

export interface DiffLine {
	kind: 'Same' | 'Add' | 'Remove' | 'Gap';
	text: string;
}

/** The lines that changed, with a little around them (longest common lines; a gap for what is left out). */
export function lineDiff(before: string, after: string, context = 2, limit = 80): DiffLine[] {
	const left = before === '' ? [] : before.replace(/\n$/, '').split('\n');
	const right = after === '' ? [] : after.replace(/\n$/, '').split('\n');
	let start = 0;
	while (start < left.length && start < right.length && left[start] === right[start]) start++;
	let endLeft = left.length;
	let endRight = right.length;
	while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
		endLeft--;
		endRight--;
	}
	const middleLeft = left.slice(start, endLeft);
	const middleRight = right.slice(start, endRight);
	let middle: DiffLine[];
	if (middleLeft.length * middleRight.length > 250_000) {
		// too big to align: what went, then what came
		middle = [...middleLeft.map((text): DiffLine => ({ kind: 'Remove', text })), ...middleRight.map((text): DiffLine => ({ kind: 'Add', text }))];
	} else {
		const table = Array.from({ length: middleLeft.length + 1 }, () => new Uint32Array(middleRight.length + 1));
		for (let i = middleLeft.length - 1; i >= 0; i--) for (let j = middleRight.length - 1; j >= 0; j--) table[i]![j] = middleLeft[i] === middleRight[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		middle = [];
		let i = 0;
		let j = 0;
		while (i < middleLeft.length || j < middleRight.length) {
			if (i < middleLeft.length && j < middleRight.length && middleLeft[i] === middleRight[j]) {
				middle.push({ kind: 'Same', text: middleLeft[i]! });
				i++;
				j++;
				// what went comes before what came, as diffs read
			} else if (i < middleLeft.length && (j >= middleRight.length || table[i + 1]![j]! >= table[i]![j + 1]!)) middle.push({ kind: 'Remove', text: middleLeft[i++]! });
			else middle.push({ kind: 'Add', text: middleRight[j++]! });
		}
	}
	const full: DiffLine[] = [...left.slice(Math.max(0, start - context), start).map((text): DiffLine => ({ kind: 'Same', text })), ...middle, ...left.slice(endLeft, endLeft + context).map((text): DiffLine => ({ kind: 'Same', text }))];
	if (start - context > 0) full.unshift({ kind: 'Gap', text: '' });
	if (endLeft + context < left.length) full.push({ kind: 'Gap', text: '' });
	// long unchanged runs inside fold up too
	const out: DiffLine[] = [];
	for (let at = 0; at < full.length; at++) {
		const line = full[at]!;
		if (line.kind === 'Same') {
			let end = at;
			while (end < full.length && full[end]!.kind === 'Same') end++;
			if (end - at > context * 2 + 1) {
				out.push(...full.slice(at, at + context), { kind: 'Gap', text: '' }, ...full.slice(end - context, end));
				at = end - 1;
				continue;
			}
		}
		out.push(line);
	}
	return out.length > limit ? [...out.slice(0, limit), { kind: 'Gap', text: '' }] : out;
}
