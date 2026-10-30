import { ASCII_FOLDINGS } from "./asciiFolding.ts";

const COMBINING_MARKS = /\p{Diacritic}/gu;
const FOLDABLE = new RegExp(`[${[...ASCII_FOLDINGS.keys()].join("")}]`, "gu");

const asciiFolded = (character: string) => ASCII_FOLDINGS.get(character)!;

// The foldings run before the marks go: the middle dot is a Diacritic to Unicode and a dot to a
// Morse-code name.
export const fold = (text: string) =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(FOLDABLE, asciiFolded)
		.replace(COMBINING_MARKS, "");

// The prefix is walked rather than sliced at `query.length`: `fold` normalises to NFD, so one
// character folds to two or to none and a decomposed tag would be cut in the wrong place.
export function completionFor(
	query: string,
	best: string | null,
): string | null {
	if (!query || !best) return null;

	const typed = fold(query);
	if (!fold(best).startsWith(typed)) return null;

	let folded = 0;
	let at = 0;
	for (const character of best) {
		const width = fold(character).length;
		if (folded >= typed.length && width > 0) break;
		folded += width;
		at += character.length;
	}

	const rest = best.slice(at);
	return rest.length > 0 ? rest : null;
}

const WHITESPACE = /\s+/u;

export const tokenize = (query: string) =>
	fold(query.trim()).split(WHITESPACE).filter(Boolean);

export const matchesTokens = (haystack: string, tokens: string[]) =>
	tokens.every((token) => haystack.includes(token));

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

export const squash = (text: string) =>
	fold(text).replace(NOT_ALPHANUMERIC, "");

export const glyphs = (text: string) => tokenize(text).join("");

export const nameKey = (text: string) => squash(text) || glyphs(text);

export const nameWords = (text: string) => {
	const folded = fold(text);
	return LETTER_OR_NUMBER.test(folded)
		? folded.split(NOT_ALPHANUMERIC).filter(Boolean)
		: tokenize(folded);
};

export interface FuzzyKey {
	squashed: string;
	words: string[];
}

export const fuzzyKey = (text: string): FuzzyKey => ({
	squashed: nameKey(text),
	words: nameWords(text),
});

const budgetFor = (length: number) => (length < 5 ? 0 : length < 9 ? 1 : 2);

const MAX_CLOSENESS = 999;

const closenessTo = (text: string, query: string) =>
	Math.max(0, MAX_CLOSENESS - Math.abs(text.length - query.length));

function within(query: string, candidate: string, budget: number): boolean {
	if (Math.abs(query.length - candidate.length) > budget) return false;
	if (budget === 0) return query === candidate;

	let previous = Array.from(
		{ length: candidate.length + 1 },
		(_, index) => index,
	);

	for (let i = 1; i <= query.length; i += 1) {
		const row = [i];
		let best = i;

		for (let j = 1; j <= candidate.length; j += 1) {
			const cost = query[i - 1] === candidate[j - 1] ? 0 : 1;
			const distance = Math.min(
				previous[j] + 1,
				row[j - 1] + 1,
				previous[j - 1] + cost,
			);
			row.push(distance);
			if (distance < best) best = distance;
		}

		if (best > budget) return false;
		previous = row;
	}

	return previous[candidate.length] <= budget;
}

// The rungs `fuzzyScore` returns, exported so a caller can set a floor rather than take whatever
// matched: a list of two or three shows two or three things however badly the third scored.
export const TIER = {
	exact: 6000,
	prefix: 5000,
	word: 4000,
	substring: 3000,
	subsequence: 2000,
	typo: 1000,
} as const;

const { exact: EXACT, prefix: PREFIX, word: WORD } = TIER;
const { substring: SUBSTRING, subsequence: SUBSEQUENCE, typo: TYPO } = TIER;

function isSubsequence(query: string, text: string): boolean {
	let at = 0;
	for (const character of text) {
		if (character === query[at]) at += 1;
		if (at === query.length) return true;
	}
	return query.length === 0;
}

// `query` must already be `squash`ed, once by the caller rather than once per candidate.
export function fuzzyScore(key: FuzzyKey, query: string, floor = 0): number {
	if (query.length === 0) return EXACT;

	const { squashed, words } = key;
	const closeness = closenessTo(squashed, query);

	if (squashed === query) return EXACT + closeness;
	if (squashed.startsWith(query)) return PREFIX + closeness;
	if (words.some((word) => word.startsWith(query))) return WORD + closeness;
	if (squashed.includes(query)) return SUBSTRING + closeness;
	if (SUBSEQUENCE + MAX_CLOSENESS < floor) return 0;
	if (query.length >= 3 && isSubsequence(query, squashed))
		return SUBSEQUENCE + closeness;

	const budget = budgetFor(query.length);
	if (budget === 0 || TYPO + MAX_CLOSENESS < floor) return 0;

	const misspelt =
		within(query, squashed, budget) ||
		within(query, squashed.slice(0, query.length), budget) ||
		words.some((word) => within(query, word, budget));

	return misspelt ? TYPO + closeness : 0;
}
