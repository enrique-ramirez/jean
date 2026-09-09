import { marked } from "marked";

export interface Part {
	heading: string;
	body: string;
}

const region = (markdown: string, name: string): string => {
	const found = new RegExp(
		`<!-- site:${name} -->\\n([\\s\\S]*?)\\n<!-- /site:${name} -->`,
	).exec(markdown);
	const body = found?.[1]?.trim();
	if (!body) throw new Error(`README.md carries no site:${name} section`);
	return body;
};

export const html = (markdown: string): string =>
	marked.parse(markdown, { async: false });

export const inline = (markdown: string): string =>
	marked.parseInline(markdown, { async: false });

export const section = (markdown: string, name: string): string =>
	html(region(markdown, name));

export function part(markdown: string, name: string): Part {
	const found = /^###\s+(.+?)\n([\s\S]*)$/.exec(region(markdown, name));
	if (!found)
		throw new Error(`site:${name} has to open with a level three heading`);
	return { heading: found[1].trim(), body: html(found[2].trim()) };
}
