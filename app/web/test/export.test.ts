import { parseNote } from '@octaether/core-format';
import { describe, expect, it } from 'vitest';
import { inlineMarkdown, noteMarkdown } from '../src/export-markdown';
import { ImportError, importBytes, importLimit, isExported, planImport, vaultZip } from '../src/vault-zip';
import { makeZip } from '../src/zip';

const rawTypeSet = new Set(['Math', 'Code', 'Chem', 'TikZ', 'Table', 'Plot', 'Image', 'Video', 'Markdown', 'HTML', 'Property']);
const argumentMap = new Map([['Code', 'Language'], ['Image', 'Source'], ['Video', 'Source'], ['Table', 'File']]);
const format = {
	isKnownType: (type: string) => rawTypeSet.has(type) || ['Callout', 'Grid', 'Column', 'Board', 'Calendar', 'Event', 'Arrow'].includes(type),
	contentKind: (type: string) => (rawTypeSet.has(type) ? ('Raw' as const) : ('Item' as const)),
	inlineBody: (type: string) => type !== 'Property',
	argumentKey: (type: string) => argumentMap.get(type),
};

function markdown(source: string, canPicture = true): { text: string; fileList: string[] } {
	const document = parseNote(source, format);
	const result = noteMarkdown(document.itemList, { name: 'Lecture 05', format, canPicture: () => canPicture });
	return { text: result.text, fileList: result.pictureList.map((picture) => picture.file) };
}

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const zipBytes = async (entryList: { path: string; data: Uint8Array<ArrayBuffer> }[]): Promise<Uint8Array> => new Uint8Array(await makeZip(entryList).arrayBuffer());

describe('Markdown export', () => {
	it('writes OI’s inline forms as Markdown’s', () => {
		expect(inlineMarkdown('The rate {Math: v = k[A]^{2}} and {Chem: H_2O}, [red]{Color: Danger} #[Lecture 05] #Exam')).toBe('The rate $v = k[A]^{2}$ and H_2O, red #Lecture-05 #Exam');
		expect(inlineMarkdown('`{Math: x}` stays, {Code {Language: Python}: print(1)} too')).toBe('`{Math: x}` stays, `print(1)` too');
		expect(inlineMarkdown('**bold** ==mark== [[Note]] [site](https://a.b) \\{Key: v}')).toBe('**bold** ==mark== [[Note]] [site](https://a.b) {Key: v}');
	});

	it('keeps text, lists, math, code, and callouts as Markdown other apps read', () => {
		const { text, fileList } = markdown(
			'---\nCreated: 2026-11-10 09:00\nFormat: Oi 1\n---\n\nProperty:\n\tTag: [Organic, Exam]\n\tCourse: CHEM 2310\n\n# Rate law\n\nThe rate is {Math: v}.\n\n- One\n\t- Deeper\n- Two\n\nMath {Numbered: True}: E = mc^2\n\nCode {LineNumber: True}: Python\n\tdef rate(k):\n\t    return k\n\nCallout {Kind: Tip}: Remember\n\tBoth appear.\n\n\tMath: a + b\n',
		);
		expect(text).toBe(
			'---\ntags: [Organic, Exam]\nCourse: CHEM 2310\n---\n\n# Rate law\n\nThe rate is $v$.\n\n- One\n    - Deeper\n- Two\n\n$$\nE = mc^2\n$$\n\n```Python\ndef rate(k):\n    return k\n```\n\n> [!tip] Remember\n> Both appear.\n>\n> $$\n> a + b\n> $$\n',
		);
		expect(fileList).toEqual([]);
	});

	it('turns a table into a pipe table, pictures into links, and columns into one flow', () => {
		const { text } = markdown('Table {Title: Gym log}:\n\tDate,Workout,Note\n\t2026-11-02,Legs,"squat, press"\n\t2026-11-04,Push,a|b\n\nImage {Width: 320}: Attachment/My cell.png\n\tThe *cell*.\n\nGrid:\n\tColumn {Width: 60%}:\n\t\tLeft\n\tColumn:\n\t\tRight\n');
		expect(text).toBe('**Gym log**\n\n| Date | Workout | Note |\n| --- | --- | --- |\n| 2026-11-02 | Legs | squat, press |\n| 2026-11-04 | Push | a\\|b |\n\n![The *cell*.](<Attachment/My cell.png>)\n\nLeft\n\nRight\n');
	});

	it('makes pictures of what Markdown can’t say, or keeps the OI text when no picture can be made', () => {
		const source = 'Before.\n\nChem: C@c -0 Br\n\nPlot {Title: Decay}:\n\ty = e^(-x)\n\nAfter.\n';
		const drawn = markdown(source);
		expect(drawn.text).toBe('Before.\n\n![Chem](<Lecture 05 1.png>)\n\n![Decay](<Lecture 05 2.png>)\n\nAfter.\n');
		expect(drawn.fileList).toEqual(['Lecture 05 1.png', 'Lecture 05 2.png']);
		const plain = markdown(source, false);
		expect(plain.text).toBe('Before.\n\n```oi\nChem: C@c -0 Br\n```\n\n```oi\nPlot {Title: Decay}:\n\ty = e^(-x)\n```\n\nAfter.\n');
		expect(plain.fileList).toEqual([]);
	});
});

describe('vault .zip', () => {
	it('exports every file at its path, with the settings and without the trash', async () => {
		expect(isExported('.oi/Setting.oi')).toBe(true);
		expect(isExported('.oi/Trash/Old.oi')).toBe(false);
		expect(isExported('.oi/Cache/Index')).toBe(false);
		const zip = vaultZip([
			{ path: 'Lecture 05.oi', data: bytes('Hello.\n') },
			{ path: 'Chem/SN2.oi', data: bytes('Chem: H_2O\n') },
			{ path: '.oi/Setting.oi', data: bytes('Kind: Setting\n') },
			{ path: '.oi/Trash/Old.oi', data: bytes('gone') },
		]);
		const plan = planImport(new Uint8Array(await zip.arrayBuffer()));
		expect(plan.fileList.map((file) => file.path)).toEqual(['Lecture 05.oi', 'Chem/SN2.oi', '.oi/Setting.oi']);
		expect(plan.name).toBeUndefined();
		expect(plan.skippedList).toEqual([]);
		expect(new TextDecoder().decode(await importBytes(plan.fileList[1]!))).toBe('Chem: H_2O\n');
	});

	it('takes a zipped folder as the vault itself, and skips what other systems add', async () => {
		const plan = planImport(
			await zipBytes([
				{ path: 'My vault/Note.oi', data: bytes('a') },
				{ path: 'My vault/Attachment/Cell.png', data: bytes('png') },
				{ path: 'My vault/.oi/Hotkey.oi', data: bytes('Kind: Hotkey\n') },
				{ path: '__MACOSX/My vault/._Note.oi', data: bytes('x') },
				{ path: 'My vault/.DS_Store', data: bytes('x') },
			]),
		);
		expect(plan.name).toBe('My vault');
		expect(plan.fileList.map((file) => file.path)).toEqual(['Note.oi', 'Attachment/Cell.png', '.oi/Hotkey.oi']);
	});

	it('refuses paths that lead out of the vault, and files that aren’t what the .zip says', async () => {
		const plan = planImport(
			await zipBytes([
				{ path: 'Good.oi', data: bytes('ok') },
				{ path: '../Evil.oi', data: bytes('x') },
				{ path: 'A/../../Evil.oi', data: bytes('x') },
				{ path: '/etc/passwd', data: bytes('x') },
				{ path: 'C:\\Windows\\evil.oi', data: bytes('x') },
				{ path: 'Folder\\Fine.oi', data: bytes('ok') },
				{ path: 'CON.oi', data: bytes('x') },
				{ path: 'good.oi', data: bytes('twice') },
			]),
		);
		expect(plan.fileList.map((file) => file.path)).toEqual(['Good.oi', 'Folder/Fine.oi']);
		expect(plan.skippedList.map((item) => item.name)).toEqual(['../Evil.oi', 'A/../../Evil.oi', '/etc/passwd', 'C:\\Windows\\evil.oi', 'CON.oi', 'good.oi']);
		// a size that lies
		const lying = plan.fileList[0]!;
		await expect(importBytes({ ...lying, entry: { ...lying.entry, size: 99 } })).rejects.toBeInstanceOf(ImportError);
		expect(() => planImport(bytes('not a zip at all'))).toThrow(ImportError);
		expect(() => planImport(new Uint8Array(0))).toThrow(ImportError);
		expect(importLimit.byteCount).toBe(2 * 1024 ** 3);
	});
});
