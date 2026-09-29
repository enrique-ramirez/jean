import type { Suggestion } from "@/domain/library/useLibrarySearch";
import { SCRATCH_KIND, type ScratchKind } from "@/domain/track/jeanPlaylists";
import {
	type ArtistTab,
	albumOfRoute,
	albumRoute,
	artistOfRoute,
	artistRoute,
	genreOfRoute,
	genreRoute,
	queryOfRoute,
	ROUTE,
	searchRoute,
	shelfOfRoute,
	shelfRoute,
} from "@/domain/track/routes";
import { SHELVES, type Shelf } from "@/features/home/shelves";
import { en, type Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";

export interface PlayingSet {
	kind: ScratchKind;
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

export const KIND_LABEL: Partial<Record<ScratchKind, KindPhrase>> = {
	[SCRATCH_KIND.artist]: "route.artist",
	[SCRATCH_KIND.genre]: "route.genre",
	[SCRATCH_KIND.shelf]: "route.shelf",
};

export const routeOfSuggestion = (
	suggestion: Exclude<Suggestion, { kind: "track" }>,
): string =>
	suggestion.kind === "artist"
		? artistRoute(suggestion.artist.name)
		: suggestion.kind === "album"
			? albumRoute(suggestion.album.artistTag, suggestion.album.album)
			: genreRoute(suggestion.genre.name);

export type RouteView =
	| { kind: "home" }
	| { kind: "all" }
	| { kind: "genres" }
	| { kind: "playing" }
	| { kind: "search"; query: string | null }
	| { kind: "shelf"; shelf: Shelf }
	| { kind: "genre"; genre: string }
	| { kind: "album"; artist: string; album: string }
	| { kind: "artist"; artist: string; tab: ArtistTab }
	| { kind: "playlist"; id: string };

const FIXED: Partial<Record<string, RouteView>> = {
	"": { kind: "home" },
	[ROUTE.home]: { kind: "home" },
	[ROUTE.all]: { kind: "all" },
	[ROUTE.genres]: { kind: "genres" },
	[ROUTE.playing]: { kind: "playing" },
	[ROUTE.search]: { kind: "search", query: null },
};

export function resolveRoute(route: string): RouteView {
	const fixed = FIXED[route];
	if (fixed) return fixed;

	const query = queryOfRoute(route);
	if (query !== null) return { kind: "search", query };

	const shelfId = shelfOfRoute(route);
	const shelf = SHELVES.find((entry) => entry.id === shelfId);
	if (shelf) return { kind: "shelf", shelf };

	const genre = genreOfRoute(route);
	if (genre !== null) return { kind: "genre", genre };

	const album = albumOfRoute(route);
	if (album) return { kind: "album", ...album };

	const artist = artistOfRoute(route);
	if (artist) return { kind: "artist", artist: artist.name, tab: artist.tab };

	return { kind: "playlist", id: route };
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
