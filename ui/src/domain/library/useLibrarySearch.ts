import {
	useCallback,
	useDeferredValue,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	reportPlaybackRefusal,
	usePlayer,
	useResolvedPlaylistId,
} from "@/domain/player/usePlayer";
import { type Album, albumIndex } from "@/domain/track/albums";
import { type Artist, artistIndex } from "@/domain/track/artists";
import { type Genre, genreIndex } from "@/domain/track/genres";
import {
	isScratchPlaylist,
	queryOfScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { libraryIndex, searchLibrary } from "@/domain/track/libraryIndex";
import { EMPTY_VIEW, project } from "@/domain/track/project";
import { rankEntities } from "@/domain/track/rankEntities";
import { bestMatches } from "@/domain/track/rankTracks";
import { emptyOwnPlaylist, permitsPlaybackControl } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { fold, fuzzyScore, squash, TIER } from "@/shared/lib/text";
import type { Library } from "./useLibrary";
import { titledAsLanded, useLandedScratch } from "./useScratchPlaylist";

export type SearchSectionLabel = Extract<Phrase, `search.section.${string}`>;

const PREVIEW_TRACKS = 8;
const PREVIEW_ARTISTS = 2;
const PREVIEW_ALBUMS = 3;
const PREVIEW_GENRES = 1;

// The floor passed to rankEntities; its comment in domain/track/rankEntities.ts has why a whole-word
// match is what keeps a section honest.
const SECTION_BAR = TIER.word;

const EMPTY_PREVIEW: number[] = [];

const NOTHING_NAMED: {
	artists: Artist[];
	albums: Album[];
	genres: Genre[];
} = { artists: [], albums: [], genres: [] };

export type Suggestion =
	| { kind: "artist"; artist: Artist }
	| { kind: "album"; album: Album }
	| { kind: "genre"; genre: Genre }
	| { kind: "track"; ref: number };

export interface SearchSection {
	label: SearchSectionLabel;
	count: number;
	suggestions: Suggestion[];
}

const entityOf = (suggestion: Suggestion) =>
	suggestion.kind === "artist"
		? suggestion.artist
		: suggestion.kind === "album"
			? suggestion.album
			: suggestion.kind === "genre"
				? suggestion.genre
				: null;

export function useLibrarySearch(library: Library, playlists: PlaylistInfo[]) {
	const { discovery, recheck } = useFooJean();
	const { data: playerSnapshot } = usePlayer();
	const player = playerSnapshot?.player;
	const playingPlaylistId =
		useResolvedPlaylistId(player?.activeItem?.playlistGuid ?? null) ?? null;
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const scratch = playlists.find(isScratchPlaylist) ?? null;
	const landed = useLandedScratch(scratch);

	const remembered = useMemo(() => {
		if (!scratch || scratch.itemCount === 0) return null;
		return queryOfScratchPlaylist(titledAsLanded(scratch, landed)) || null;
	}, [scratch, landed]);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
		setDraft((current) => current || remembered || "");
	}, [remembered]);

	const canEmptyScratch = permitsPlaybackControl(discovery);

	const clear = useCallback(() => {
		setDraft("");
		setQuery("");
		setIsOpen(false);
		if (!canEmptyScratch) return;

		const scratch = playlists.find(isScratchPlaylist);
		if (!scratch) return;

		const stillPlaying =
			player !== undefined && player.playbackState !== "stopped";
		if (
			stillPlaying &&
			(playingPlaylistId === null || scratch.id === playingPlaylistId)
		)
			return;

		const { origin } = discovery;
		if (origin)
			emptyOwnPlaylist(origin, "scratch").catch((error) =>
				reportPlaybackRefusal(error, recheck),
			);
	}, [
		playlists,
		canEmptyScratch,
		player,
		playingPlaylistId,
		discovery,
		recheck,
	]);

	const deferredDraft = useDeferredValue(draft);

	const columns = library.columns;
	const { trackCount } = columns;

	const index = useMemo(
		() =>
			library.key && columns.trackCount > 0
				? libraryIndex(library.key, columns)
				: null,
		[library.key, columns],
	);

	// The dropdown never projects: eight rows are read straight off the snapshot, where the page needs
	// the heat and patina arrays a whole view carries.
	const draftMatched = useMemo(
		() => (index ? searchLibrary(index, trackCount, deferredDraft) : null),
		[index, trackCount, deferredDraft],
	);

	const preview = useMemo(
		() =>
			index && draftMatched
				? bestMatches(index, draftMatched, deferredDraft, PREVIEW_TRACKS)
				: EMPTY_PREVIEW,
		[index, draftMatched, deferredDraft],
	);

	const wanted = deferredDraft.trim();

	// One memo for the three, since they share a guard, a floor and a dependency array -- and because a
	// downstream memo keyed on three separately built arrays is keyed on nothing.
	const named = useMemo(() => {
		const key = library.key;
		if (!index || !wanted || !key) return NOTHING_NAMED;

		return {
			artists: rankEntities(artistIndex(key, columns), wanted, SECTION_BAR),
			albums: rankEntities(albumIndex(key, columns), wanted, SECTION_BAR),
			genres: rankEntities(genreIndex(key, columns), wanted, SECTION_BAR),
		};
	}, [index, wanted, library.key, columns]);

	const matched = useMemo(
		() => (index ? searchLibrary(index, trackCount, query) : null),
		[index, trackCount, query],
	);

	const results = useMemo(
		() => project(library.snapshot, matched),
		[library.snapshot, matched],
	);

	const sections = useMemo<SearchSection[]>(() => {
		const built: SearchSection[] = [];

		const { artists, albums, genres } = named;

		if (artists.length > 0)
			built.push({
				label: "search.section.artists",
				count: artists.length,
				suggestions: artists
					.slice(0, PREVIEW_ARTISTS)
					.map((artist) => ({ kind: "artist", artist })),
			});

		if (albums.length > 0)
			built.push({
				label: "search.section.albums",
				count: albums.length,
				suggestions: albums
					.slice(0, PREVIEW_ALBUMS)
					.map((album) => ({ kind: "album", album })),
			});

		if (genres.length > 0)
			built.push({
				label: "search.section.genres",
				count: genres.length,
				suggestions: genres
					.slice(0, PREVIEW_GENRES)
					.map((genre) => ({ kind: "genre", genre })),
			});

		if (preview.length > 0)
			built.push({
				label: "search.section.tracks",
				count: draftMatched?.length ?? preview.length,
				suggestions: preview.map((position) => ({
					kind: "track",
					ref: draftMatched ? draftMatched[position] : position,
				})),
			});

		return built;
	}, [named, preview, draftMatched]);

	// One list in the order they are drawn, so the arrow keys need to know nothing about sections and
	// a heading can never take the cursor.
	const suggestions = useMemo(
		() => sections.flatMap((section) => section.suggestions),
		[sections],
	);

	const preselect = useMemo(() => {
		if (!wanted || !index || !draftMatched) return -1;

		const query = squash(wanted);
		const exact = [...named.artists, ...named.albums, ...named.genres].filter(
			(entity) => fuzzyScore(entity.match, query) >= TIER.exact,
		);
		if (exact.length !== 1) return -1;

		const folded = fold(wanted);
		if (draftMatched.some((ref) => index.title.text(ref) === folded)) return -1;

		return suggestions.findIndex(
			(suggestion) => entityOf(suggestion) === exact[0],
		);
	}, [named, suggestions, wanted, index, draftMatched]);

	const focus = useCallback(() => {
		setIsOpen(true);
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const type = useCallback((next: string) => {
		setDraft(next);
		setIsOpen(true);
	}, []);

	return {
		draft,
		type,
		revert: useCallback(() => setDraft(query), [query]),
		// Returns what it promoted, so the caller never has to read state this render hasn't caught up
		// with yet. Takes an explicit value for callers with no draft to promote, such as a shelf search.
		commit: useCallback(
			(next: string = draft) => {
				setDraft(next);
				setQuery(next);
				return {
					query: next,
					// The memo is a render behind while a fast typist is still going, and the refs a set is
					// filled from have to be the ones this query matches.
					refs:
						next === deferredDraft
							? draftMatched
							: index
								? searchLibrary(index, trackCount, next)
								: null,
				};
			},
			[draft, deferredDraft, draftMatched, index, trackCount],
		),
		clear,
		inputRef,
		focus,
		isOpen,
		open: useCallback(() => setIsOpen(true), []),
		close: useCallback(() => setIsOpen(false), []),
		sections,
		suggestions,
		preselect,
		hasDraft: draft.trim().length > 0,
		isEdited: draft !== query,
		draftCount: draftMatched?.length ?? 0,
		isFiltering: draft !== deferredDraft,
		remembered,
		restore,
		isFocused,
		onFocus: useCallback(() => {
			setIsFocused(true);
			setIsOpen(true);
		}, []),
		onBlur: useCallback(() => setIsFocused(false), []),
		query,
		hasQuery: query.trim().length > 0,
		results: results ?? EMPTY_VIEW,
		matchCount: matched?.length ?? 0,
		viewKey: `search:${query.trim().toLowerCase()}`,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
