// Diacritic-insensitive matching, for anything the user types at a list, so
// `babasonicos` finds `Babasónicos`. Requiring people to type the accents in
// their own library taxes exactly the tracks they are most likely hunting for,
// and from outside it does not look strict, it looks broken.
//
// Fold when the haystack is *built*, never per keystroke: the cost is paid once
// and a search stays a plain includes(). Both sides come through here, or an
// accented query stops matching the folded index.
const COMBINING_MARKS = /\p{Diacritic}/gu;

export const fold = (text: string) =>
	text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");

// Every token has to appear somewhere, in any order, as a substring: 'wilco
// yankee' finds a track whose title and artist each supply half the query.
export const tokenize = (query: string) =>
	fold(query.trim()).split(/\s+/).filter(Boolean);

export const matchesTokens = (haystack: string, tokens: string[]) =>
	tokens.every((token) => haystack.includes(token));

// '1 album', never '1 albums': somebody trying Jean against a folder of four
// songs is looking hardest at those counts.
export const pluralise = (count: number, one: string, many = `${one}s`) =>
	count === 1 ? one : many;

export const plural = (count: number, one: string, many?: string) =>
	`${count.toLocaleString()} ${pluralise(count, one, many)}`;
