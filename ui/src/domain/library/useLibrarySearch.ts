import {
	useCallback,
	useDeferredValue,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Artist } from "@/domain/artist/artists";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import { announcePlaybackRefusal } from "@/domain/player/playerWrite";
import { useInSession } from "@/domain/player/session";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { usePlayer } from "@/domain/player/usePlayer";
import { useResolvedPlaylistId } from "@/domain/player/usePlaylists";
import type { Album } from "@/domain/track/albums";
import { CREDIT_TAGS } from "@/domain/track/fields";
import type { Genre } from "@/domain/track/genres";
import {
	isScratchPlaylist,
	queryOfScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { isLoaded } from "@/domain/track/libraryColumns";
import { EMPTY_VIEW, project } from "@/domain/track/project";
import type { SearchAnswer } from "@/domain/track/searchCore";
import { useLibraryAnswer } from "@/domain/track/useLibraryAnswer";
import { switchRefusalOf } from "@/shared/api/client";
import { emptyOwnPlaylist } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { fuzzyScore, squash, TIER } from "@/shared/lib/text";
import type { Library } from "./useLibrary";
import { useWait } from "./useOverdue";
import { titledAsLanded, useLandedScratch } from "./useScratchPlaylist";

export type SearchSectionLabel = Extract<Phrase, `search.section.${string}`>;

const PREVIEW_TRACKS = 8;
const PREVIEW_ARTISTS = 2;
const PREVIEW_ALBUMS = 3;
const PREVIEW_GENRES = 1;

const NOTHING_NAMED: {
	artists: Artist[];
	albums: Album[];
	genres: Genre[];
} = { artists: [], albums: [], genres: [] };

const NO_PREVIEW = 0;

interface Answered {
	query: string;
	answer: SearchAnswer;
}

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

function entityOf(suggestion: Suggestion) {
	switch (suggestion.kind) {
		case "artist":
			return suggestion.artist;
		case "album":
			return suggestion.album;
		case "genre":
			return suggestion.genre;
		case "track":
			return null;
	}
}

export function useLibrarySearch(library: Library, playlists: PlaylistInfo[]) {
	const { discovery, recheck } = useFooJean();
	const [splitsCredits] = useSplitCredits();
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
	const isInSession = useInSession();

	const remembered = useMemo(() => {
		if (isInSession || !scratch || scratch.itemCount === 0) return null;
		return queryOfScratchPlaylist(titledAsLanded(scratch, landed)) || null;
	}, [isInSession, scratch, landed]);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
		setDraft((current) => current || remembered || "");
	}, [remembered]);

	const canControlPlayback = useCanControlPlayback();
	const canEmptyScratch = canControlPlayback && !isInSession;

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
			void emptyOwnPlaylist(origin, "scratch").then((emptied) => {
				if (!emptied.ok && switchRefusalOf(emptied) === "playbackDisabled")
					announcePlaybackRefusal(recheck);
			});
	}, [
		playlists,
		canEmptyScratch,
		player,
		playingPlaylistId,
		discovery,
		recheck,
	]);

	const deferredDraft = useDeferredValue(draft);

	const { columns } = library;

	const draftQuestion = useMemo(
		() =>
			deferredDraft.trim()
				? ({
						kind: "search",
						query: deferredDraft,
						limit: PREVIEW_TRACKS,
						splitsCredits,
					} as const)
				: null,
		[deferredDraft, splitsCredits],
	);
	const draftSearch = useLibraryAnswer(draftQuestion, library, true);

	const committedQuestion = useMemo(
		() =>
			query.trim() && query !== deferredDraft
				? ({
						kind: "search",
						query,
						limit: NO_PREVIEW,
						splitsCredits,
					} as const)
				: null,
		[query, deferredDraft, splitsCredits],
	);
	const committedSearch = useLibraryAnswer(committedQuestion, library, true);

	const { answer: draftAnswer, answered: draftAsked } = draftSearch;
	const { answer: committedAnswer, answered: committedAsked } = committedSearch;

	const answeredFor = useCallback(
		(asked: string): Answered | null => {
			if (draftAnswer && draftAsked?.query === asked)
				return { query: asked, answer: draftAnswer };
			if (committedAnswer && committedAsked?.query === asked)
				return { query: asked, answer: committedAnswer };
			return null;
		},
		[draftAnswer, draftAsked, committedAnswer, committedAsked],
	);

	const [lastAnswered, setLastAnswered] = useState<
		(Answered & { key: string | null }) | null
	>(null);
	const answeredNow = query.trim() ? answeredFor(query) : null;
	if (answeredNow && answeredNow.answer !== lastAnswered?.answer)
		setLastAnswered({ ...answeredNow, key: library.key });
	const shown =
		answeredNow ?? (lastAnswered?.key === library.key ? lastAnswered : null);
	const matched = shown?.answer.matched ?? null;
	const isShownBehind = query.trim() !== "" && shown?.query !== query;
	const wait = useWait(
		isShownBehind && shown === null && columns.trackCount > 0,
		query,
	);

	const results = useMemo(
		() => project(library.snapshot, matched),
		[library.snapshot, matched],
	);

	const suggested = draftAnswer;
	const suggestedQuery = draftAsked?.query ?? "";
	const named = suggested ?? NOTHING_NAMED;

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

		if (suggested && suggested.best.length > 0)
			built.push({
				label: "search.section.tracks",
				count: suggested.matched?.length ?? suggested.best.length,
				suggestions: Array.from(suggested.best, (ref) => ({
					kind: "track",
					ref,
				})),
			});

		return built;
	}, [named, suggested]);

	// One list in the order they are drawn, so the arrow keys need to know nothing about sections and
	// a heading can never take the cursor.
	const suggestions = useMemo(
		() => sections.flatMap((section) => section.suggestions),
		[sections],
	);

	const preselect = useMemo(() => {
		const wanted = suggestedQuery.trim();
		if (!wanted || !suggested?.matched) return -1;

		const squashed = squash(wanted);
		const exact = [...named.artists, ...named.albums, ...named.genres].filter(
			(entity) => fuzzyScore(entity.match, squashed, TIER.exact) >= TIER.exact,
		);
		if (exact.length !== 1 || suggested.namesATrack) return -1;

		return suggestions.findIndex(
			(suggestion) => entityOf(suggestion) === exact[0],
		);
	}, [named, suggestions, suggested, suggestedQuery]);

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
		commit: useCallback(
			(next: string = draft) => {
				setDraft(next);
				setQuery(next);
				return { query: next, refs: answeredFor(next)?.answer.matched ?? null };
			},
			[draft, answeredFor],
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
		areArtistsPending:
			draft.trim().length > 0 &&
			columns.trackCount > 0 &&
			!isLoaded(columns, CREDIT_TAGS),
		isEdited: draft !== query,
		draftCount: draftAnswer?.matched?.length ?? 0,
		isFiltering: draft !== deferredDraft || draftSearch.isWaiting,
		suggestedQuery,
		remembered,
		restore,
		isFocused,
		onFocus: useCallback(() => {
			setIsFocused(true);
			setIsOpen(true);
		}, []),
		onBlur: useCallback(() => setIsFocused(false), []),
		query: shown?.query ?? query,
		committedQuery: query,
		hasQuery: query.trim().length > 0,
		results: results ?? EMPTY_VIEW,
		matchCount: matched?.length ?? 0,
		viewKey: `search:${(shown?.query ?? query).trim().toLowerCase()}`,
		wait,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
