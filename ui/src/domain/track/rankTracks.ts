import { closenessTo, tokenize } from "@/shared/lib/text";
import type { Refs } from "./project";
import type { RowText } from "./searchText";

// The same tiers as `fuzzyScore`'s ladder in `shared/lib/text.ts`, minus SUBSEQUENCE and TYPO.
const EXACT = 4000;
const PREFIX = 3000;
const WORD = 2000;
const SUBSTRING = 1000;

// Which field matched has to outweigh how well it matched: the spread must be wide enough that a
// hit on the album lands below a hit on the title a rung further down the ladder, and narrow enough
// that an exact album title still beats a passing mention in a song.
const TITLE = 1;
const ARTIST = 0.85;
const ALBUM = 0.6;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function fieldScore(text: string, token: string): number {
	const first = text.indexOf(token);
	if (first < 0) return 0;

	const closeness = closenessTo(text, token);
	if (first === 0)
		return (text.length === token.length ? EXACT : PREFIX) + closeness;

	// Every occurrence, not just the first: `rebloodblood blood` starts a word on its third.
	for (let at = first; at >= 0; at = text.indexOf(token, at + 1))
		if (!WORD_CHARACTER.test(text[at - 1])) return WORD + closeness;

	return SUBSTRING + closeness;
}

const scoreOf = (text: RowText, tokens: string[]) =>
	tokens.reduce(
		(total, token) =>
			total +
			Math.max(
				fieldScore(text.title, token) * TITLE,
				fieldScore(text.artist, token) * ARTIST,
				fieldScore(text.album, token) * ALBUM,
			),
		0,
	);

/**
 * The best few of a match set, as positions into it rather than refs, so one number both draws a row
 * and plays it. Ties keep the order they arrived in, which is the order the results page is in.
 */
export function bestMatches(
	index: RowText[],
	indices: Refs,
	query: string,
	limit: number,
): number[] {
	const tokens = tokenize(query);
	if (tokens.length === 0 || limit < 1) return [];

	// Held sorted at `limit` rather than sorting the whole match set, which on a one-letter query is
	// the library.
	const best: number[] = [];
	const scores: number[] = [];

	for (let position = 0; position < indices.length; position += 1) {
		const score = scoreOf(index[indices[position]], tokens);
		if (best.length === limit && score <= scores[limit - 1]) continue;

		let at = scores.length;
		while (at > 0 && scores[at - 1] < score) at -= 1;

		best.splice(at, 0, position);
		scores.splice(at, 0, score);

		if (best.length > limit) {
			best.pop();
			scores.pop();
		}
	}

	return best;
}
