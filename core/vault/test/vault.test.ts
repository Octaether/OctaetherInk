import { describe, expect, it } from 'vitest';
import { MemoryFileSystem, Vault, linkList, nameProblem, tagList } from '../src';

async function vault(fileMap: Record<string, string>): Promise<{ vault: Vault; fs: MemoryFileSystem }> {
	const fs = new MemoryFileSystem('Chemistry', fileMap);
	const result = new Vault(fs);
	await result.load();
	return { vault: result, fs };
}

describe('Vault', () => {
	it('lists folders first, sorts names naturally, and hides .oi/', async () => {
		const { vault: v } = await vault({ 'Note 10.oi': '', 'Note 2.oi': '', 'Lab/Titration.oi': '', '.oi/Setting.oi': 'Kind: Setting', 'paper.pdf': '' });
		expect(v.childList('').map((entry) => entry.path)).toEqual(['Lab', 'Note 2.oi', 'Note 10.oi', 'paper.pdf']);
		expect(v.childList('', 'NameDescending').map((entry) => entry.path)).toEqual(['Lab', 'paper.pdf', 'Note 10.oi', 'Note 2.oi']);
		expect(v.noteList()).toEqual(['Lab/Titration.oi', 'Note 2.oi', 'Note 10.oi']);
	});

	it('picks free "Untitled" names, ignoring case like the disk does', async () => {
		const { vault: v } = await vault({ 'untitled.oi': '', 'Untitled 1.oi': '' });
		expect(v.uniquePath('', 'Untitled')).toBe('Untitled 2.oi');
		expect(v.uniquePath('Lab', 'Untitled')).toBe('Lab/Untitled.oi');
		expect(nameProblem('a/b')).toMatch(/can’t contain/);
		expect(nameProblem('CON.oi')).toMatch(/reserved/);
		expect(nameProblem('Lecture 05')).toBeUndefined();
	});

	it('moves deleted notes to the trash with their folder path, and restores them', async () => {
		const { vault: v, fs } = await vault({ 'Lab/Titration.oi': 'pH', 'Keep.oi': '' });
		const trashed = await v.trash('Lab/Titration.oi');
		expect(trashed).toBe('.oi/Trash/Lab/Titration.oi');
		expect(v.noteList()).toEqual(['Keep.oi']);
		expect(await fs.read(trashed)).toBe('pH');
		expect(v.trashList().map((entry) => entry.path)).toEqual([trashed]);
		// a new note took the old name meanwhile: the restored one gets a free name
		await v.write('Lab/Titration.oi', 'new');
		expect(await v.restore(trashed)).toBe('Lab/Titration 1.oi');
		expect(v.search('pH').map((result) => result.path)).toEqual(['Lab/Titration 1.oi']);
		// and the trash keeps no empty folder behind
		expect((await fs.list()).map((entry) => entry.path).filter((path) => path.startsWith('.oi/Trash/'))).toEqual([]);
		await v.trash('Keep.oi');
		await v.emptyTrash();
		expect(v.trashList()).toEqual([]);
		expect((await fs.list()).some((entry) => entry.path.startsWith('.oi/Trash'))).toBe(false);
	});

	it('names folders without an extension, in the tree and in the trash, and restores a whole folder', async () => {
		const { vault: v, fs } = await vault({ 'Lab/Titration.oi': 'pH #Acid', 'Lab/Cell.png': 'png', 'v1.2/Old.oi': '' });
		expect(await v.createFolder('', 'Untitled')).toBe('Untitled');
		expect(await v.createFolder('', 'Untitled')).toBe('Untitled 1');
		expect(await v.addFile('', 'LICENSE', new Blob(['MIT']))).toBe('LICENSE');
		const trashed = await v.trash('Lab');
		expect(trashed).toBe('.oi/Trash/Lab');
		expect((await fs.list()).map((entry) => entry.path)).toContain('.oi/Trash/Lab/Titration.oi');
		expect(await v.trash('v1.2')).toBe('.oi/Trash/v1.2');
		expect(v.search('tag:Acid')).toEqual([]);
		// back with its notes indexed again (links, tags, search)
		expect(await v.restore(trashed)).toBe('Lab');
		expect(v.search('tag:Acid').map((result) => result.path)).toEqual(['Lab/Titration.oi']);
		expect(v.has('Lab/Cell.png')).toBe(true);
	});

	it('deletes permanently when asked (a blank Untitled note never reaches the trash)', async () => {
		const { vault: v } = await vault({ 'Untitled.oi': '' });
		await v.deleteForever('Untitled.oi');
		expect(v.noteList()).toEqual([]);
		expect(v.trashList()).toEqual([]);
	});

	it('keeps a copy in memory of what it deletes for good, so Undo can put it back', async () => {
		const { vault: v, fs } = await vault({ 'Lab/Titration.oi': 'pH #Acid', 'Lab/Cell.png': 'png bytes', 'Index.oi': '[[Titration]]' });
		const snapshot = (await v.snapshot('Lab'))!;
		await v.deleteForever('Lab');
		expect(v.has('Lab')).toBe(false);
		expect(v.resolve('Titration')).toBeUndefined();
		expect(await v.putBack(snapshot)).toBe('Lab');
		expect(await fs.read('Lab/Titration.oi')).toBe('pH #Acid');
		expect(await (await v.readBinary('Lab/Cell.png')).text()).toBe('png bytes');
		expect(v.resolve('Titration')).toBe('Lab/Titration.oi');
		// a name taken meanwhile: it comes back beside it
		const note = (await v.snapshot('Index.oi'))!;
		await v.deleteForever('Index.oi');
		await v.write('Index.oi', 'new');
		expect(await v.putBack(note)).toBe('Index 1.oi');
		// too big to keep twice: no copy, and no Undo
		expect(await v.snapshot('Lab', 4)).toBeUndefined();
	});

	it('renames a note and rewrites the links that named it', async () => {
		const { vault: v, fs } = await vault({
			'SN2.oi': 'See [[SN1|the other one]].',
			'SN1.oi': 'Compare with [[SN2]] and [[SN2#Rate]].',
			'Lab/Report.oi': 'Theory: [[SN1]], ![[SN1]] and [[Lab/Report]].',
		});
		const result = await v.rename('SN1.oi', 'Unimolecular.oi', { updateLink: true });
		expect(result.changedList.sort()).toEqual(['Lab/Report.oi', 'SN2.oi']);
		expect(await fs.read('SN2.oi')).toBe('See [[Unimolecular|the other one]].');
		expect(await fs.read('Lab/Report.oi')).toBe('Theory: [[Unimolecular]], ![[Unimolecular]] and [[Lab/Report]].');
		// moving a folder keeps name links working and rewrites path links
		await v.rename('Lab', 'Practical', { updateLink: true });
		expect(await fs.read('Practical/Report.oi')).toBe('Theory: [[Unimolecular]], ![[Unimolecular]] and [[Practical/Report]].');
		await expect(v.rename('SN2.oi', 'unimolecular.oi')).rejects.toThrow(/already exists/);
	});

	it('resolves links by path or name (closest first) and builds the graph', async () => {
		const { vault: v } = await vault({
			'A.oi': '[[B]] [[Lab/B]] [[Missing]] #Organic',
			'B.oi': '---\nTag: [Organic, "Lab work"]\n---\n\n[[A]]',
			'Lab/B.oi': '',
			'Lone.oi': 'nothing',
		});
		expect(v.resolve('B', 'A.oi')).toBe('B.oi');
		expect(v.resolve('B', 'Lab/X.oi')).toBe('Lab/B.oi');
		expect(v.resolve('lab/b')).toBe('Lab/B.oi');
		expect(v.backlinkList('A.oi')).toEqual(['B.oi']);
		expect(v.tagList('B.oi')).toEqual(['Organic', 'Lab work']);
		const plain = v.graph({ orphan: false });
		expect(plain.nodeList.map((node) => node.id).sort()).toEqual(['A.oi', 'B.oi', 'Lab/B.oi']);
		const full = v.graph({ tag: true, unresolved: true });
		expect(full.nodeList.find((node) => node.id === 'Tag:Organic')!.degree).toBe(2);
		expect(full.nodeList.find((node) => node.id === 'Unresolved:Missing')).toMatchObject({ kind: 'Unresolved', degree: 1 });
		expect(full.nodeList.some((node) => node.id === 'Lone.oi')).toBe(true);
	});

	it('searches names, text, and tags, with case and regex options', async () => {
		const { vault: v } = await vault({ 'Acid.oi': 'pKa of acetic acid\nBuffer: pH = pKa', 'Base.oi': 'pKb #Lab', 'Other.oi': 'nothing here' });
		const result = v.search('pka');
		expect(result.map((item) => item.path)).toEqual(['Acid.oi']);
		expect(result[0]!.matchList.map((match) => match.text.slice(match.start, match.end))).toEqual(['pKa', 'pKa']);
		expect(v.search('pka', { matchCase: true })).toEqual([]);
		expect(v.search('p[Kk]b', { regex: true }).map((item) => item.path)).toEqual(['Base.oi']);
		expect(v.search('acid')[0]!.nameMatch).toBe(true);
		expect(v.search('tag:#lab').map((item) => item.path)).toEqual(['Base.oi']);
		expect(v.search('(', { regex: true })).toEqual([]);
	});
});

describe('link and tag syntax', () => {
	it('reads links with headings, labels, and embeds', () => {
		expect(linkList('a [[ Note #Part|shown]] b ![[Pic]]').map((link) => [link.target, link.heading, link.label, link.embed])).toEqual([
			['Note', 'Part', 'shown', false],
			['Pic', undefined, undefined, true],
		]);
	});

	it('reads tags but not headings, numbers, colors, or code', () => {
		expect(tagList('# Heading\n#Chem and #[Lecture 05], #123, &#39; x#no\n```\n#code\n```')).toEqual(['Chem', 'Lecture 05']);
	});

	it('reads the Tag field of Property blocks, and of an older note header', () => {
		expect(tagList('---\nTag: [Old]\nFormat: Oi 1\n---\n\nProperty:\n\tTag: [Organic, Lab work]\n\tNote: #not-a-tag\n\nText #Inline\n')).toEqual(['Old', 'Organic', 'Lab work', 'Inline']);
		expect(tagList('- item\n\tProperty:\n\t\tTag: Single\n')).toEqual(['Single']);
	});
});
