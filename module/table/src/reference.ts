// Naming a table from another block: by its title (`Gym log`); in another note with the note's name
// before `#` (`Gym#Gym log`, or `[[Gym#Gym log]]`).

import { type BlockNode, walkNode } from '@octaether/core-format';

export interface TableReference {
	/** The note it is in (undefined: this one). */
	note: string | undefined;
	/** Its title. */
	title: string;
}

export function parseReference(reference: string): TableReference | undefined {
	const text = reference.trim().replace(/^\[\[|\]\]$/g, '');
	if (!text) return undefined;
	const hash = text.indexOf('#');
	const note = hash >= 0 ? text.slice(0, hash).trim() || undefined : undefined;
	const title = (hash >= 0 ? text.slice(hash + 1) : text).trim();
	return title ? { note, title } : undefined;
}

/** The Table with this title (case aside). */
export function findTableNode(itemList: readonly BlockNode[], reference: TableReference): BlockNode | undefined {
	const wanted = reference.title.toLowerCase();
	let found: BlockNode | undefined;
	walkNode(itemList, (node) => {
		const title = node.property.get('Title');
		if (!found && node.type === 'Table' && typeof title === 'string' && title.trim().toLowerCase() === wanted) found = node;
	});
	return found;
}
