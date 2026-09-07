const ARTIST_PREFIX = "artist/";

export const artistRoute = (name: string) =>
	`${ARTIST_PREFIX}${encodeURIComponent(name)}`;

export const artistHref = (name: string) => `#/${artistRoute(name)}`;

// A name somebody typed or tagged, so it is decoded inside a `try`: a hand-edited hash with a stray
// `%` in it throws rather than returning anything.
export const artistOfRoute = (route: string): string | null => {
	if (!route.startsWith(ARTIST_PREFIX)) return null;
	try {
		return decodeURIComponent(route.slice(ARTIST_PREFIX.length)) || null;
	} catch {
		return null;
	}
};
