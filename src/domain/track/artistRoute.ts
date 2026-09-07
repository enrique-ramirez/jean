const ARTIST_PREFIX = "artist/";
const TRACKS = "/tracks";

export type ArtistTab = "overview" | "tracks";

export const artistRoute = (name: string, tab: ArtistTab = "overview") =>
	`${ARTIST_PREFIX}${encodeURIComponent(name)}${tab === "tracks" ? TRACKS : ""}`;

export const artistHref = (name: string, tab: ArtistTab = "overview") =>
	`#/${artistRoute(name, tab)}`;

/**
 * The name is percent-encoded, so a `/` inside one cannot be mistaken for the tab. Decoded inside a
 * `try`: a hand-edited hash with a stray `%` in it throws rather than returning anything.
 */
export function artistOfRoute(
	route: string,
): { name: string; tab: ArtistTab } | null {
	if (!route.startsWith(ARTIST_PREFIX)) return null;

	const rest = route.slice(ARTIST_PREFIX.length);
	const tab = rest.endsWith(TRACKS) ? "tracks" : "overview";
	const encoded = tab === "tracks" ? rest.slice(0, -TRACKS.length) : rest;

	try {
		const name = decodeURIComponent(encoded);
		return name ? { name, tab } : null;
	} catch {
		return null;
	}
}
