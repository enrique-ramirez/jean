import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import { SHELVES, type Shelf } from "@/features/home/shelves";

// What the scratch playlist is holding, as the sidebar and status bar read it.
export interface PlayingSet {
	kind: string;
	label: string | null;
	// What to call the set on screen, which is not the label: All music carries
	// no label at all.
	name: string;
	isPlaying: boolean;
}

// The same, once Jean has worked out which of its routes the set belongs to.
// `temporaryRow` marks the one case with no permanent sidebar entry to mark in
// place -- a shelf, which borrows a row for as long as it is playing.
export interface PlayingRoute extends PlayingSet {
	route: string;
	temporaryRow?: boolean;
}

export const ROUTE = {
	home: "home",
	all: "all",
	search: "search",
	playing: "playing",
} as const;

const SHELF_PREFIX = "shelf/";
const GENRE_PREFIX = "genre/";

const shelfRoute = (id: string) => `${SHELF_PREFIX}${id}`;

// A genre is a tag somebody typed, so it can hold a slash, a hash or an accent.
// Encoded on the way in and decoded on the way out -- and decoded in a `try`,
// because a hand-edited hash with a stray `%` throws rather than returning
// something odd.
export const genreRoute = (name: string) =>
	`${GENRE_PREFIX}${encodeURIComponent(name)}`;

const genreOfRoute = (route: string): string | null => {
	if (!route.startsWith(GENRE_PREFIX)) return null;
	try {
		return decodeURIComponent(route.slice(GENRE_PREFIX.length)) || null;
	} catch {
		return null;
	}
};

// What a hash means, as one answer rather than five booleans read in five
// places. Home is where `/` lands, so an unrecognised hash falls there rather
// than onto whichever playlist happened to be first.
export function resolveRoute(route: string): {
	shelf: Shelf | null;
	// The genre tag this route names, decoded. A filter over the library rather
	// than anything the player holds -- see `refsOfGenre`.
	genre: string | null;
	isSearch: boolean;
	isAll: boolean;
	isHome: boolean;
	isNowPlaying: boolean;
	isLibrary: boolean;
} {
	const shelfId = route.startsWith(SHELF_PREFIX)
		? route.slice(SHELF_PREFIX.length)
		: null;
	const shelf = shelfId
		? (SHELVES.find((entry) => entry.id === shelfId) ?? null)
		: null;

	const genre = genreOfRoute(route);

	return {
		shelf,
		genre,
		isSearch: route === ROUTE.search,
		isAll: route === ROUTE.all,
		isHome: route === "" || route === ROUTE.home,
		// Not about a set of tracks at all -- it is about the one that is playing,
		// wherever that came from. So no playlist row lights up behind it, which is
		// what puts it on the library side of the line below.
		isNowPlaying: route === ROUTE.playing,
		// Everything the library owns, as opposed to a playlist the player owns.
		// Only a playlist route selects a playlist in the sidebar.
		isLibrary:
			route === "" ||
			route === ROUTE.home ||
			route === ROUTE.all ||
			route === ROUTE.search ||
			route === ROUTE.playing ||
			shelf !== null ||
			genre !== null,
	};
}

// The scratch playlist carries a name; the route it belongs to is Jean's to
// work out, and so is whether the sidebar already draws a row for it. All music
// and the search have permanent entries and are marked in place. A shelf has
// none -- it is the one set that needs a row conjured for as long as it plays.
export function routeOfPlayingSet(
	playing: PlayingSet | null | undefined,
): PlayingRoute | null {
	if (!playing) return null;
	if (playing.kind === SCRATCH_KIND.all)
		return { ...playing, route: ROUTE.all };
	if (playing.kind === SCRATCH_KIND.search)
		return { ...playing, route: ROUTE.search };
	// A genre has no permanent sidebar row either, and unlike a shelf its route
	// is recoverable from the label alone -- the label *is* the tag.
	if (playing.kind === SCRATCH_KIND.genre)
		return playing.label
			? { ...playing, route: genreRoute(playing.label), temporaryRow: true }
			: null;
	if (playing.kind !== SCRATCH_KIND.shelf) return null;

	const shelf = SHELVES.find((entry) => entry.title === playing.label);
	return shelf
		? { ...playing, route: shelfRoute(shelf.id), temporaryRow: true }
		: null;
}
