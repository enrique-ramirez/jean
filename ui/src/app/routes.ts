import {
	GENRES_ROUTE,
	genreOfRoute,
	genreRoute,
} from "@/domain/library/genreRoute";
import { queryOfRoute, searchRoute } from "@/domain/library/searchRoute";
import type { Suggestion } from "@/domain/library/useLibrarySearch";
import { albumOfRoute, albumRoute } from "@/domain/track/albumRoute";
import {
	type ArtistTab,
	artistOfRoute,
	artistRoute,
} from "@/domain/track/artistRoute";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import { SHELVES, type Shelf } from "@/features/home/shelves";
import { PLAYING_ROUTE } from "@/features/now-playing/panelRoute";
import { en, type Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";

export interface PlayingSet {
	kind: string;
	label: string | null;
	name: string;
	itemCount: number;
	isPlaying: boolean;
}

export interface PlayingRoute extends PlayingSet {
	route: string;
	temporaryRow?: boolean;
}

type KindPhrase = Extract<Phrase, `route.${string}`>;

export const KIND_LABEL: Record<string, KindPhrase> = {
	[SCRATCH_KIND.artist]: "route.artist",
	[SCRATCH_KIND.genre]: "route.genre",
	[SCRATCH_KIND.shelf]: "route.shelf",
};

export const ROUTE = {
	home: "home",
	all: "all",
	genres: GENRES_ROUTE,
	search: "search",
	playing: PLAYING_ROUTE,
} as const;

const SHELF_PREFIX = "shelf/";

const shelfRoute = (id: string) => `${SHELF_PREFIX}${id}`;

export const routeOfSuggestion = (
	suggestion: Exclude<Suggestion, { kind: "track" }>,
): string =>
	suggestion.kind === "artist"
		? artistRoute(suggestion.artist.name)
		: suggestion.kind === "album"
			? albumRoute(suggestion.album.artistTag, suggestion.album.album)
			: genreRoute(suggestion.genre.name);

export function resolveRoute(route: string): {
	shelf: Shelf | null;
	searchQuery: string | null;
	genre: string | null;
	album: string | null;
	albumArtist: string | null;
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
	const searchQuery = queryOfRoute(route);
	const album = albumOfRoute(route);
	const artist = artistOfRoute(route);

	return {
		shelf,
		searchQuery,
		genre,
		album: album?.album ?? null,
		albumArtist: album?.artist ?? null,
		artist: artist?.name ?? null,
		artistTab: artist?.tab ?? "overview",
		isGenres: route === ROUTE.genres,
		isSearch: route === ROUTE.search || searchQuery !== null,
		isAll: route === ROUTE.all,
		isHome: route === "" || route === ROUTE.home,
		isLibrary:
			route === "" ||
			route === ROUTE.home ||
			route === ROUTE.all ||
			route === ROUTE.genres ||
			route === ROUTE.search ||
			searchQuery !== null ||
			route === ROUTE.playing ||
			shelf !== null ||
			genre !== null ||
			album !== null ||
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
		return { ...playing, route: searchRoute(playing.label ?? "") };
	if (playing.kind === SCRATCH_KIND.artist)
		return playing.label
			? { ...playing, route: artistRoute(playing.label), temporaryRow: true }
			: null;
	if (playing.kind === SCRATCH_KIND.genre)
		return playing.label
			? { ...playing, route: genreRoute(playing.label), temporaryRow: true }
			: null;
	if (playing.kind !== SCRATCH_KIND.shelf) return null;

	// The label on the player is the shelf's title as it read when the set was played, so a language
	// changed since then would leave the row unrecognised. English is always in the bundle, which
	// makes it the one other spelling worth trying.
	const shelf = SHELVES.find(
		(entry) =>
			playing.label === translate(entry.title) ||
			playing.label === en[entry.title],
	);
	return shelf
		? { ...playing, route: shelfRoute(shelf.id), temporaryRow: true }
		: null;
}
