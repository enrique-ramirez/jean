import { SHELVES, type Shelf } from "../home/shelves";
import { SCRATCH_KIND } from "../library/jeanPlaylists";

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

export const ROUTE = { home: "home", all: "all", search: "search" } as const;

const SHELF_PREFIX = "shelf/";

const shelfRoute = (id: string) => `${SHELF_PREFIX}${id}`;

// What a hash means, as one answer rather than five booleans read in five
// places. Home is where `/` lands, so an unrecognised hash falls there rather
// than onto whichever playlist happened to be first.
export function resolveRoute(route: string): {
	shelf: Shelf | null;
	isSearch: boolean;
	isAll: boolean;
	isHome: boolean;
	isLibrary: boolean;
} {
	const shelfId = route.startsWith(SHELF_PREFIX)
		? route.slice(SHELF_PREFIX.length)
		: null;
	const shelf = shelfId
		? (SHELVES.find((entry) => entry.id === shelfId) ?? null)
		: null;

	return {
		shelf,
		isSearch: route === ROUTE.search,
		isAll: route === ROUTE.all,
		isHome: route === "" || route === ROUTE.home,
		// Everything the library owns, as opposed to a playlist the player owns.
		// Only a playlist route selects a playlist in the sidebar.
		isLibrary:
			route === "" ||
			route === ROUTE.home ||
			route === ROUTE.all ||
			route === ROUTE.search ||
			shelf !== null,
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
	if (playing.kind !== SCRATCH_KIND.shelf) return null;

	const shelf = SHELVES.find((entry) => entry.title === playing.label);
	return shelf
		? { ...playing, route: shelfRoute(shelf.id), temporaryRow: true }
		: null;
}
