// A genre is a view of the library, so how one is addressed lives here rather than in the shell:
// `app` resolves the hash and three separate features build links to it, and imports run one way.
// Written out per caller, the encoding drifts -- a tag can hold a slash, a hash or an accent, and
// three hand-rolled template strings are three chances to forget one.
const GENRE_PREFIX = "genre/";

/** The index of every genre, which `app` maps to a route and three features link to. */
export const GENRES_ROUTE = "genres";
export const GENRES_HREF = `#/${GENRES_ROUTE}`;

export const genreRoute = (name: string) =>
	`${GENRE_PREFIX}${encodeURIComponent(name)}`;

/** The same, as an href. The hash is `#/<route>` everywhere in Jean. */
export const genreHref = (name: string) => `#/${genreRoute(name)}`;

// Decoded inside a `try`, because a hand-edited hash with a stray `%` throws.
export const genreOfRoute = (route: string): string | null => {
	if (!route.startsWith(GENRE_PREFIX)) return null;
	try {
		return decodeURIComponent(route.slice(GENRE_PREFIX.length)) || null;
	} catch {
		return null;
	}
};
