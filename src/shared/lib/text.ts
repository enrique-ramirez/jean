// Diacritic-insensitive matching, so an unaccented query finds an accented title.
// Fold when the haystack is built, never per keystroke, and fold both sides or an accented query stops matching the folded index.
const COMBINING_MARKS = /\p{Diacritic}/gu;

export const fold = (text: string) =>
	text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");

// Every token has to appear somewhere, in any order, as a substring, so a query can be half title and half artist.
export const tokenize = (query: string) =>
	fold(query.trim()).split(/\s+/).filter(Boolean);

export const matchesTokens = (haystack: string, tokens: string[]) =>
	tokens.every((token) => haystack.includes(token));

export const pluralise = (count: number, one: string, many = `${one}s`) =>
	count === 1 ? one : many;

export const plural = (count: number, one: string, many?: string) =>
	`${count.toLocaleString()} ${pluralise(count, one, many)}`;

// ---- matching a name somebody half-remembers --------------------------------

// The other matcher, for a short name typed from memory where `fold()` alone is not enough: a genre
// is a tag typed by hand across a decade, so `Heavy Metal`, `heavy-metal` and `heavymetal` are one
// thing and `heavy metl` was meant to be. Track search does not want this -- there `tokenize` is
// right, because a query is half a title and half an artist and the words are the whole signal.
// Separators carry no meaning in a name, so they are dropped rather than split on: `hip-hop` and
// `hip hop` squash to one key, and neither spelling has to be guessed at.
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

export const squash = (text: string) =>
	fold(text).replace(NOT_ALPHANUMERIC, "");

/** Built once per candidate, never per keystroke: folding is roughly ten times the cost of the comparison it feeds. */
export interface FuzzyKey {
	squashed: string;
	words: string[];
}

export const fuzzyKey = (text: string): FuzzyKey => ({
	squashed: squash(text),
	words: fold(text).split(NOT_ALPHANUMERIC).filter(Boolean),
});

// A typo is only worth forgiving in a word long enough to make one. Below that, the budget is what
// turns every three-letter genre into a match for every other.
const budgetFor = (length: number) => (length < 5 ? 0 : length < 9 ? 1 : 2);

// Bounded, and it abandons a row the moment every cell in it is over budget. Full Levenshtein over a
// few hundred candidates per keystroke would be affordable; this is the same answer for less.
function within(a: string, b: string, budget: number): boolean {
	if (Math.abs(a.length - b.length) > budget) return false;
	if (budget === 0) return a === b;

	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

	for (let i = 1; i <= a.length; i += 1) {
		const row = [i];
		let best = i;

		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
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

	return previous[b.length] <= budget;
}

// Ordered tiers rather than weights: a prefix match beats a substring match however long either is,
// and length only settles ties inside a tier.
const EXACT = 6000;
const PREFIX = 5000;
const WORD = 4000;
const SUBSTRING = 3000;
const SUBSEQUENCE = 2000;
const TYPO = 1000;

// Every character of the query, in order, somewhere in the candidate. What finds `pwrmtl`.
function isSubsequence(query: string, text: string): boolean {
	let at = 0;
	for (const character of text) {
		if (character === query[at]) at += 1;
		if (at === query.length) return true;
	}
	return query.length === 0;
}

/**
 * How well a candidate answers a query, higher being better and 0 being no match at all.
 * `query` must already be `squash`ed -- once by the caller, rather than once per candidate.
 */
export function fuzzyScore(key: FuzzyKey, query: string): number {
	if (query.length === 0) return EXACT;

	const { squashed, words } = key;
	// Inside a tier, the closer a candidate is to being *only* the query the better, so `Rock` beats
	// `Rock En Español` for `rock` and neither is beaten by `Progressive Rock`.
	const closeness = Math.max(0, 999 - Math.abs(squashed.length - query.length));

	if (squashed === query) return EXACT + closeness;
	if (squashed.startsWith(query)) return PREFIX + closeness;
	if (words.some((word) => word.startsWith(query))) return WORD + closeness;
	if (squashed.includes(query)) return SUBSTRING + closeness;
	// Gated on length for the same reason the typo budget is: two characters in order match most of
	// a library's genres, and a tier that matches everything ranks nothing.
	if (query.length >= 3 && isSubsequence(query, squashed))
		return SUBSEQUENCE + closeness;

	const budget = budgetFor(query.length);
	if (budget === 0) return 0;

	// Against the head as well as the whole, or a typed prefix of a long name is judged against
	// everything it has not typed yet: `heavymetl` is two edits from `heavymetal` and nine from
	// `heavymetalclassic`.
	const misspelt =
		within(query, squashed, budget) ||
		within(query, squashed.slice(0, query.length), budget) ||
		words.some((word) => within(query, word, budget));

	return misspelt ? TYPO + closeness : 0;
}
