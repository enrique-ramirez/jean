import { closenessTo, type Query } from "@/shared/lib/text";
import type { Refs } from "./project";
import { type SearchIndex, textOf } from "./searchText";

// The same tiers as `fuzzyScore`'s ladder in `shared/lib/text.ts`, minus SUBSEQUENCE and TYPO.
const EXACT = 4000;
const PREFIX = 3000;
const WORD = 2000;
const SUBSTRING = 1000;

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

const scoreOf = (index: SearchIndex, ref: number, query: Query) =>
	query.tokens.reduce(
		(total, token) =>
			total +
			index.fields.reduce(
				(best, field) =>
					Math.max(
						best,
						fieldScore(textOf(field, query)(ref), token) * field.weight,
					),
				0,
			),
		0,
	);

/**
 * The best few of a match set, as positions into it rather than refs, so one number both draws a row
 * and plays it. Ties keep the order they arrived in, which is the order the results page is in.
 */
export function bestMatches(
	index: SearchIndex,
	indices: Refs,
	query: Query,
	limit: number,
): number[] {
	if (query.tokens.length === 0 || limit < 1) return [];

	// Held sorted at `limit` rather than sorting the whole match set, which on a one-letter query is
	// the library.
	const best: number[] = [];
	const scores: number[] = [];

	for (let position = 0; position < indices.length; position += 1) {
		const score = scoreOf(index, indices[position], query);
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
