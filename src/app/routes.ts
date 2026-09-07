import {
	GENRES_ROUTE,
	genreOfRoute,
	genreRoute,
} from "@/domain/library/genreRoute";
import {
	type ArtistTab,
	artistOfRoute,
	artistRoute,
} from "@/domain/track/artistRoute";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import { SHELVES, type Shelf } from "@/features/home/shelves";

export interface PlayingSet {
	kind: string;
	label: string | null;
	name: string;
	isPlaying: boolean;
}

export interface PlayingRoute extends PlayingSet {
	route: string;
	temporaryRow?: boolean;
}

// What a temporary sidebar row *is*. Shelves, genres and artists all arrive through one row, so
// without this they are three different kinds of place drawn identically.
export const KIND_LABEL: Record<string, string> = {
	[SCRATCH_KIND.artist]: "Artist",
	[SCRATCH_KIND.genre]: "Genre",
	[SCRATCH_KIND.shelf]: "Shelf",
};

export const ROUTE = {
	home: "home",
	all: "all",
	genres: GENRES_ROUTE,
	search: "search",
	playing: "playing",
} as const;

const SHELF_PREFIX = "shelf/";

const shelfRoute = (id: string) => `${SHELF_PREFIX}${id}`;

export function resolveRoute(route: string): {
	shelf: Shelf | null;
	genre: string | null;
	artist: string | null;
	artistTab: ArtistTab;
	isGenres: boolean;
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

	const genre = genreOfRoute(route);
	const artist = artistOfRoute(route);

	return {
		shelf,
		genre,
		artist: artist?.name ?? null,
		artistTab: artist?.tab ?? "overview",
		isGenres: route === ROUTE.genres,
		isSearch: route === ROUTE.search,
		isAll: route === ROUTE.all,
		isHome: route === "" || route === ROUTE.home,
		isLibrary:
			route === "" ||
			route === ROUTE.home ||
			route === ROUTE.all ||
			route === ROUTE.genres ||
			route === ROUTE.search ||
			route === ROUTE.playing ||
			shelf !== null ||
			genre !== null ||
			artist !== null,
	};
}

export function routeOfPlayingSet(
	playing: PlayingSet | null | undefined,
): PlayingRoute | null {
	if (!playing) return null;
	if (playing.kind === SCRATCH_KIND.all)
		return { ...playing, route: ROUTE.all };
	if (playing.kind === SCRATCH_KIND.search)
		return { ...playing, route: ROUTE.search };
	if (playing.kind === SCRATCH_KIND.artist)
		return playing.label
			? { ...playing, route: artistRoute(playing.label), temporaryRow: true }
			: null;
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
