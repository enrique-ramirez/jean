// Fold both sides: an accented query stops matching an index that was folded when it was built.
const COMBINING_MARKS = /\p{Diacritic}/gu;

export const fold = (text: string) =>
	text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");

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

export const tokenize = (query: string) =>
	fold(query.trim()).split(/\s+/).filter(Boolean);

export const matchesTokens = (haystack: string, tokens: string[]) =>
	tokens.every((token) => haystack.includes(token));

export const pluralise = (count: number, one: string, many = `${one}s`) =>
	count === 1 ? one : many;

export const plural = (count: number, one: string, many?: string) =>
	`${count.toLocaleString()} ${pluralise(count, one, many)}`;

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

export const squash = (text: string) =>
	fold(text).replace(NOT_ALPHANUMERIC, "");

export interface FuzzyKey {
	squashed: string;
	words: string[];
}

export const fuzzyKey = (text: string): FuzzyKey => ({
	squashed: squash(text),
	words: fold(text).split(NOT_ALPHANUMERIC).filter(Boolean),
});

const budgetFor = (length: number) => (length < 5 ? 0 : length < 9 ? 1 : 2);

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

const EXACT = 6000;
const PREFIX = 5000;
const WORD = 4000;
const SUBSTRING = 3000;
const SUBSEQUENCE = 2000;
const TYPO = 1000;

function isSubsequence(query: string, text: string): boolean {
	let at = 0;
	for (const character of text) {
		if (character === query[at]) at += 1;
		if (at === query.length) return true;
	}
	return query.length === 0;
}

// `query` must already be `squash`ed, once by the caller rather than once per candidate.
export function fuzzyScore(key: FuzzyKey, query: string): number {
	if (query.length === 0) return EXACT;

	const { squashed, words } = key;
	const closeness = Math.max(0, 999 - Math.abs(squashed.length - query.length));

	if (squashed === query) return EXACT + closeness;
	if (squashed.startsWith(query)) return PREFIX + closeness;
	if (words.some((word) => word.startsWith(query))) return WORD + closeness;
	if (squashed.includes(query)) return SUBSTRING + closeness;
	if (query.length >= 3 && isSubsequence(query, squashed))
		return SUBSEQUENCE + closeness;

	const budget = budgetFor(query.length);
	if (budget === 0) return 0;

	const misspelt =
		within(query, squashed, budget) ||
		within(query, squashed.slice(0, query.length), budget) ||
		words.some((word) => within(query, word, budget));

	return misspelt ? TYPO + closeness : 0;
}
