import { tagKey } from "./fields";

export const ROUTE = {
	home: "home",
	all: "all",
	genres: "genres",
	search: "search",
	playing: "playing",
} as const;

export const PANEL_TABS = ["lyrics", "details", "artist"] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

export type ArtistTab = "overview" | "tracks";

/**
 * Every segment is percent-encoded, so a `/` inside a tag cannot be mistaken for the separator.
 * `decodeURIComponent` throws on a stray `%`, which a hand-edited hash can carry.
 */
function routeCodec(name: string) {
	const prefix = `${name}/`;
	return {
		encode: (...segments: string[]) =>
			`${prefix}${segments.map(encodeURIComponent).join("/")}`,
		decode: (route: string): string[] | null => {
			if (!route.startsWith(prefix)) return null;
			try {
				return route.slice(prefix.length).split("/").map(decodeURIComponent);
			} catch {
				return null;
			}
		},
		matches: (route: string) => route === name || route.startsWith(prefix),
	};
}

const only = (segments: string[] | null) =>
	segments?.length === 1 && segments[0] ? segments[0] : null;

const album = routeCodec("album");
const artist = routeCodec("artist");
const genre = routeCodec("genre");
const shelf = routeCodec("shelf");
const search = routeCodec(ROUTE.search);
const playing = routeCodec(ROUTE.playing);

export const href = (route: string) => `#/${route}`;

/**
 * Two segments, since a title on its own does not name a record: `Blood, Sweat & Tears` is an album
 * by two different bands. Both halves are normalised the way albums are grouped, so one record has
 * one address however its files are spelt, and what the page draws comes off the rows it matched
 * rather than out of the route.
 */
export const albumRoute = (
	artistTag: string | null | undefined,
	title: string,
) => album.encode(tagKey(artistTag), tagKey(title));

/** An empty artist is a record whose files carry neither tag, and still a record. */
export function albumOfRoute(
	route: string,
): { artist: string; album: string } | null {
	const segments = album.decode(route);
	if (segments?.length !== 2 || !segments[1]) return null;
	return { artist: segments[0], album: segments[1] };
}

export const artistRoute = (name: string, tab: ArtistTab = "overview") =>
	tab === "tracks" ? artist.encode(name, tab) : artist.encode(name);

export function artistOfRoute(
	route: string,
): { name: string; tab: ArtistTab } | null {
	const segments = artist.decode(route);
	if (!segments?.[0]) return null;
	if (segments.length === 1) return { name: segments[0], tab: "overview" };
	return segments.length === 2 && segments[1] === "tracks"
		? { name: segments[0], tab: "tracks" }
		: null;
}

export const genreRoute = (name: string) => genre.encode(name);

export const genreOfRoute = (route: string) => only(genre.decode(route));

export const shelfRoute = (id: string) => shelf.encode(id);

export const shelfOfRoute = (route: string) => only(shelf.decode(route));

export const searchRoute = (query: string) =>
	query.trim() ? search.encode(query) : ROUTE.search;

export const queryOfRoute = (route: string) => only(search.decode(route));

export const isSearchRoute = search.matches;

export const playingRoute = (tab?: PanelTab | null) =>
	tab ? playing.encode(tab) : ROUTE.playing;

export const isPlayingRoute = playing.matches;

export function panelOfRoute(route: string): PanelTab | null {
	const tab = only(playing.decode(route));
	return PANEL_TABS.find((entry) => entry === tab) ?? null;
}
