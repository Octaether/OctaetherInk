// Where people can support Octaether Ink with money (README "Support"). One list for the start
// screen and Setting → About; .github/FUNDING.yml names the same accounts for GitHub's Sponsor button.

import { escapeHtml } from './ui';

export interface SupportLink {
	title: string;
	url: string;
	explain: string;
}

export const supportLinkList: readonly SupportLink[] = [
	{ title: 'GitHub Sponsors', url: 'https://github.com/sponsors/Octaether', explain: 'Monthly or once; GitHub takes no fee' },
	{ title: 'Ko-fi', url: 'https://ko-fi.com/octaether', explain: 'Once or monthly, by card or PayPal' },
];

/** The links as HTML, each opening in a new tab, joined by " or ". */
export function supportLinkHtml(): string {
	return supportLinkList
		.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.explain)}">${escapeHtml(link.title)}</a>`)
		.join(' or ');
}
