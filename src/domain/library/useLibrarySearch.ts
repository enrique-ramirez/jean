import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	canChangePlaylists,
	usePermissions,
	usePlayer,
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
import { removePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { readStoredState, useStoredState } from "@/shared/hooks/useStoredState";
import type { Phrase } from "@/shared/i18n/en";
import { fold, fuzzyScore, squash, TIER } from "@/shared/lib/text";
import type { Library } from "./useLibrary";
import { SCRATCH_PIN_KEY } from "./useScratchPlaylist";

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
	// Everything the query named, not what the section shows: the heading answers "how much of this
	// did you leave out".
	count: number;
	suggestions: Suggestion[];
}

// What a suggestion is *about*, where that is a thing in the library rather than one of its tracks.
const entityOf = (suggestion: Suggestion) =>
	suggestion.kind === "artist"
		? suggestion.artist
		: suggestion.kind === "album"
			? suggestion.album
			: suggestion.kind === "genre"
				? suggestion.genre
				: null;

/**
 * Two queries, not one. `draft` is what is being typed and reaches no further than the field and its
 * dropdown; `query` is the search the app is actually showing, and only a commitment moves it. What
 * the field says and what the page shows can therefore differ, but only while the caret is in it.
 */
export function useLibrarySearch(library: Library, playlists: PlaylistInfo[]) {
	const permissions = usePermissions();
	const { data: playerSnapshot } = usePlayer();
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [, setPinnedScratch] = useStoredState<string | null>(
		SCRATCH_PIN_KEY,
		null,
	);

	const remembered = useMemo(
		() => queryOfScratchPlaylist(playlists.find(isScratchPlaylist)) || null,
		[playlists],
	);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
		setDraft((current) => current || remembered || "");
	}, [remembered]);

	const canEdit = canChangePlaylists(permissions);

	const clear = useCallback(() => {
		setDraft("");
		setQuery("");
		setIsOpen(false);
		if (!canEdit) return;

		// Read now rather than from the hook above: a save drops the pin as it hands the playlist to the user, and a value captured by this callback predates that.
		const pinned = readStoredState<string | null>(SCRATCH_PIN_KEY, null);
		const scratch = playlists.find((entry) => entry.id === pinned);
		if (!isScratchPlaylist(scratch)) return;

		if (scratch.id === playerSnapshot?.player?.activeItem?.playlistId) return;

		removePlaylist(scratch.id);
		setPinnedScratch(null);
	}, [playlists, canEdit, playerSnapshot, setPinnedScratch]);

	const { request } = library;

	useEffect(() => {
		if (draft.length > 0) request();
	}, [draft, request]);

	const deferredDraft = useDeferredValue(draft);

	const index = useMemo(
		() =>
			library.key && library.rows.length > 0
				? libraryIndex(library.key, library.rows)
				: null,
		[library.key, library.rows],
	);

	// The dropdown never projects: eight rows are read straight off the snapshot, where the page needs
	// the heat and patina arrays a whole view carries.
	const draftMatched = useMemo(
		() => (index ? searchLibrary(index, deferredDraft) : null),
		[index, deferredDraft],
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
		const rows = library.rows;
		if (!index || !wanted || !key) return NOTHING_NAMED;

		return {
			artists: rankEntities(artistIndex(key, rows), wanted, SECTION_BAR),
			albums: rankEntities(albumIndex(key, rows), wanted, SECTION_BAR),
			genres: rankEntities(genreIndex(key, rows), wanted, SECTION_BAR),
		};
	}, [index, wanted, library.key, library.rows]);

	const matched = useMemo(
		() => (index ? searchLibrary(index, query) : null),
		[index, query],
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

	// Exactly one thing in the library was named exactly and nothing else was, so the query has one
	// reading and the cursor starts on it -- which is what keeps the guess visible rather than hidden
	// inside Enter. Anything else answering to the same name makes it ambiguous again, on either side:
	// `love` is a band, a record and a hundred songs.
	const preselect = useMemo(() => {
		if (!wanted || !index || !draftMatched) return -1;

		const query = squash(wanted);
		const exact = [...named.artists, ...named.albums, ...named.genres].filter(
			(entity) => fuzzyScore(entity.match, query) >= TIER.exact,
		);
		if (exact.length !== 1) return -1;

		const folded = fold(wanted);
		if (draftMatched.some((ref) => index[ref].title === folded)) return -1;

		return suggestions.findIndex(
			(suggestion) => entityOf(suggestion) === exact[0],
		);
	}, [named, suggestions, wanted, index, draftMatched]);

	const focus = useCallback(() => {
		request();
		setIsOpen(true);
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [request]);

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
								? searchLibrary(index, next)
								: null,
				};
			},
			[draft, deferredDraft, draftMatched, index],
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
			request();
		}, [request]),
		onBlur: useCallback(() => setIsFocused(false), []),
		query,
		hasQuery: query.trim().length > 0,
		results: results ?? EMPTY_VIEW,
		matchCount: matched?.length ?? 0,
		viewKey: `search:${query.trim().toLowerCase()}`,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
