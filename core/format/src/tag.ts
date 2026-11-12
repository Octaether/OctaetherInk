// Tags as one line of text, the same rule everywhere (a table's Tag cell, the tag editors): a comma
// separates tags, spaces stay inside one (`Ada Lovelace`), and a tag that holds a comma is quoted
// (`"Smith, J"`). A # in front is taken off, so `#Organic` typed out of habit is the tag `Organic`.

/** `Organic, Ada Lovelace, "Smith, J"` → its tags, each once (case aside), in order. */
export function tagListOf(text: string): string[] {
	const list: string[] = [];
	const push = (raw: string, quoted: boolean): void => {
		let tag = raw.trim();
		if (!quoted) {
			tag = tag.replace(/^#+/, '');
			const bracket = /^\[(.*)\]$/.exec(tag);
			if (bracket && raw.trim().startsWith('#')) tag = bracket[1]!;
			tag = tag.trim();
		}
		if (tag && !list.some((item) => item.toLowerCase() === tag.toLowerCase())) list.push(tag);
	};
	let index = 0;
	while (index < text.length) {
		while (index < text.length && /\s/.test(text[index]!)) index++;
		if (text[index] === '"') {
			// a quoted tag: "" inside is a quote
			let tag = '';
			index++;
			while (index < text.length) {
				if (text[index] === '"') {
					if (text[index + 1] === '"') {
						tag += '"';
						index += 2;
						continue;
					}
					index++;
					break;
				}
				tag += text[index++];
			}
			// anything after the closing quote, up to the comma, belongs to it
			const comma = text.indexOf(',', index);
			const rest = text.slice(index, comma < 0 ? text.length : comma).trim();
			push(rest ? `${tag} ${rest}` : tag, true);
			index = comma < 0 ? text.length : comma + 1;
			continue;
		}
		const comma = text.indexOf(',', index);
		push(text.slice(index, comma < 0 ? text.length : comma), false);
		index = comma < 0 ? text.length : comma + 1;
	}
	return list;
}

/** A tag as it is written in such a line: quoted only when it must be. */
export function tagWord(tag: string): string {
	return /[,"]/.test(tag) || tag !== tag.trim() ? `"${tag.replace(/"/g, '""')}"` : tag;
}

/** Tags → one line: `Organic, "Smith, J"`. */
export function tagText(list: readonly string[]): string {
	return list.map(tagWord).join(', ');
}
