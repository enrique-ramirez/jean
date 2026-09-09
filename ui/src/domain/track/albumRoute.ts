import { tagKey } from "./fields";

const ALBUM_PREFIX = "album/";

/**
 * Two segments, since a title on its own does not name a record: `Blood, Sweat & Tears` is an album
 * by two different bands. Both halves are normalised the way albums are grouped, so one record has
 * one address however its files are spelt -- and what the page *draws* comes off the rows it matched
 * rather than out of the route.
 */
export const albumRoute = (artist: string | null | undefined, album: string) =>
	`${ALBUM_PREFIX}${encodeURIComponent(tagKey(artist))}/${encodeURIComponent(tagKey(album))}`;

export const albumHref = (artist: string | null | undefined, album: string) =>
	`#/${albumRoute(artist, album)}`;

/**
 * Percent-encoded, so a `/` inside either tag cannot be mistaken for the separator, and decoded
 * inside a `try`: a hand-edited hash with a stray `%` in it throws rather than returning anything.
 * An empty artist is a record whose files carry neither tag, and still a record.
 */
export function albumOfRoute(
	route: string,
): { artist: string; album: string } | null {
	if (!route.startsWith(ALBUM_PREFIX)) return null;

	const parts = route.slice(ALBUM_PREFIX.length).split("/");
	if (parts.length !== 2) return null;

	try {
		const artist = decodeURIComponent(parts[0]);
		const album = decodeURIComponent(parts[1]);
		return album ? { artist, album } : null;
	} catch {
		return null;
	}
}
