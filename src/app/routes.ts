import {
	GENRES_ROUTE,
	genreOfRoute,
	genreRoute,
} from "@/domain/library/genreRoute";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import { SHELVES, type Shelf } from "@/features/home/shelves";

// What the scratch playlist is holding, as the sidebar and status bar read it.
export interface PlayingSet {
	kind: string;
	label: string | null;
	// What to call the set on screen, which is not the label: All music carries no label at all.
	name: string;
	isPlaying: boolean;
}

// The same, once Jean has worked out which of its routes the set belongs to. `temporaryRow` marks a set with no permanent sidebar entry, which borrows a row for as long as it is playing.
export interface PlayingRoute extends PlayingSet {
	route: string;
	temporaryRow?: boolean;
}

export const ROUTE = {
	home: "home",
	all: "all",
	// The index of every genre. Not a set of tracks, so nothing ever plays from here and no sidebar row lights up for it.
	genres: GENRES_ROUTE,
	search: "search",
	playing: "playing",
} as const;

const SHELF_PREFIX = "shelf/";

const shelfRoute = (id: string) => `${SHELF_PREFIX}${id}`;

// What a hash means, as one answer rather than five booleans read in five places. An unrecognised hash falls to home rather than onto whichever playlist happened to be first.
export function resolveRoute(route: string): {
	shelf: Shelf | null;
	// The genre tag this route names, decoded. A filter over the library rather than anything the player holds.
	genre: string | null;
	isGenres: boolean;
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
		// `genres` is not `genre/`, so the prefix test above never claims it and the two routes cannot be confused.
		isGenres: route === ROUTE.genres,
		isSearch: route === ROUTE.search,
		isAll: route === ROUTE.all,
		isHome: route === "" || route === ROUTE.home,
		// About whichever track is playing rather than a set of tracks, so no playlist row lights up behind it.
		isNowPlaying: route === ROUTE.playing,
		// Everything the library owns, as opposed to a playlist the player owns. Only a playlist route selects a playlist in the sidebar.
		isLibrary:
			route === "" ||
			route === ROUTE.home ||
			route === ROUTE.all ||
			route === ROUTE.genres ||
			route === ROUTE.search ||
			route === ROUTE.playing ||
			shelf !== null ||
			genre !== null,
	};
}

// All music and the search have permanent sidebar entries and are marked in place; a shelf or a genre needs a row conjured for as long as it plays.
export function routeOfPlayingSet(
	playing: PlayingSet | null | undefined,
): PlayingRoute | null {
	if (!playing) return null;
	if (playing.kind === SCRATCH_KIND.all)
		return { ...playing, route: ROUTE.all };
	if (playing.kind === SCRATCH_KIND.search)
		return { ...playing, route: ROUTE.search };
	// Unlike a shelf, a genre's route is recoverable from the label alone: the label is the tag.
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
