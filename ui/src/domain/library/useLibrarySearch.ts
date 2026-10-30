import {
	useCallback,
	useDeferredValue,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import { announcePlaybackRefusal } from "@/domain/player/playerWrite";
import { useInSession } from "@/domain/player/session";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { usePlayer } from "@/domain/player/usePlayer";
import { useResolvedPlaylistId } from "@/domain/player/usePlaylists";
import {
	isScratchPlaylist,
	queryOfScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { NO_FIGURES } from "@/domain/track/stats";
import { useLibraryQuestion } from "@/domain/track/useLibraryQuestion";
import { switchRefusalOf } from "@/shared/api/client";
import {
	isQueryTooLong,
	type LibrarySearchAnswer,
	type NamedAlbum,
	type NamedArtist,
	type NamedGenre,
	PREVIEW_ALBUMS,
	PREVIEW_ARTISTS,
	PREVIEW_GENRES,
} from "@/shared/api/libraryQuestions";
import { emptyOwnPlaylist } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { fuzzyKey, fuzzyScore, nameKey, TIER } from "@/shared/lib/text";
import { questionFailed } from "./questionFailed";
import { type Library, useSetRows } from "./useLibrary";
import { useWait } from "./useOverdue";
import { titledAsLanded, useLandedScratch } from "./useScratchPlaylist";

export type SearchSectionLabel = Extract<Phrase, `search.section.${string}`>;

const PREVIEW_TRACKS = 8;

const NO_PREVIEW = 0;

const NOTHING_NAMED = { total: 0, top: [] };

const NO_MATCH: LibrarySearchAnswer = {
	matched: null,
	matchCount: 0,
	figures: NO_FIGURES,
	best: new Int32Array(0),
	artists: NOTHING_NAMED,
	albums: NOTHING_NAMED,
	genres: NOTHING_NAMED,
	namesATrack: false,
};

interface Answered {
	query: string;
	answer: LibrarySearchAnswer;
}

export type Suggestion =
	| { kind: "artist"; artist: NamedArtist }
	| { kind: "album"; album: NamedAlbum }
	| { kind: "genre"; genre: NamedGenre }
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

const nameOf = (entity: NamedArtist | NamedAlbum | NamedGenre) =>
	"album" in entity ? entity.album : entity.name;

const isTooLong = (query: string) =>
	query.trim() !== "" && isQueryTooLong(query);

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

	const { trackCount } = library;

	const isDraftTooLong = isTooLong(deferredDraft);
	const draftQuestion = useMemo(
		() =>
			deferredDraft.trim() && !isDraftTooLong
				? ({
						kind: "search",
						query: deferredDraft,
						limit: PREVIEW_TRACKS,
						splitsCredits,
					} as const)
				: null,
		[deferredDraft, isDraftTooLong, splitsCredits],
	);
	const draftSearch = useLibraryQuestion(draftQuestion, library, true);

	const isQueryLong = isTooLong(query);
	const committedQuestion = useMemo(
		() =>
			query.trim() && query !== deferredDraft && !isQueryLong
				? ({
						kind: "search",
						query,
						limit: NO_PREVIEW,
						splitsCredits,
					} as const)
				: null,
		[query, deferredDraft, isQueryLong, splitsCredits],
	);
	const committedSearch = useLibraryQuestion(committedQuestion, library, true);

	const { answer: draftAnswer, answered: draftAsked } = draftSearch;
	const { answer: committedAnswer, answered: committedAsked } = committedSearch;

	const answeredFor = useCallback(
		(asked: string): Answered | null => {
			if (isTooLong(asked)) return { query: asked, answer: NO_MATCH };
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
		isShownBehind && shown === null && trackCount > 0,
		query,
	);

	const results = useSetRows(library, "search", matched);

	const suggested = isDraftTooLong ? NO_MATCH : draftAnswer;
	const suggestedQuery = isDraftTooLong
		? deferredDraft
		: (draftAsked?.query ?? "");

	const sections = useMemo<SearchSection[]>(() => {
		const built: SearchSection[] = [];

		const { artists, albums, genres } = suggested ?? NO_MATCH;

		if (artists.total > 0)
			built.push({
				label: "search.section.artists",
				count: artists.total,
				suggestions: artists.top
					.slice(0, PREVIEW_ARTISTS)
					.map((artist) => ({ kind: "artist", artist })),
			});

		if (albums.total > 0)
			built.push({
				label: "search.section.albums",
				count: albums.total,
				suggestions: albums.top
					.slice(0, PREVIEW_ALBUMS)
					.map((album) => ({ kind: "album", album })),
			});

		if (genres.total > 0)
			built.push({
				label: "search.section.genres",
				count: genres.total,
				suggestions: genres.top
					.slice(0, PREVIEW_GENRES)
					.map((genre) => ({ kind: "genre", genre })),
			});

		if (suggested && suggested.best.length > 0)
			built.push({
				label: "search.section.tracks",
				count: suggested.matchCount || suggested.best.length,
				suggestions: Array.from(suggested.best, (ref) => ({
					kind: "track",
					ref,
				})),
			});

		return built;
	}, [suggested]);

	// One list in the order they are drawn, so the arrow keys need to know nothing about sections and
	// a heading can never take the cursor.
	const suggestions = useMemo(
		() => sections.flatMap((section) => section.suggestions),
		[sections],
	);

	const hasFailed = draftSearch.failure !== null;
	const isFiltering = draft !== deferredDraft || draftSearch.isWaiting;
	const preselect = useMemo(() => {
		const wanted = suggestedQuery.trim();
		if (!wanted || !suggested?.matched || hasFailed) return -1;

		const squashed = nameKey(wanted);
		const exact = [
			...suggested.artists.top,
			...suggested.albums.top,
			...suggested.genres.top,
		].filter(
			(entity) =>
				fuzzyScore(fuzzyKey(nameOf(entity)), squashed, TIER.exact) >=
				TIER.exact,
		);
		if (exact.length !== 1 || suggested.namesATrack) return -1;

		return suggestions.findIndex(
			(suggestion) => entityOf(suggestion) === exact[0],
		);
	}, [suggestions, suggested, suggestedQuery, hasFailed]);

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
		failure: questionFailed(draftSearch.failure, draftSearch.retry),
		committedFailure:
			query.trim() && query === deferredDraft
				? questionFailed(draftSearch.failure, draftSearch.retry)
				: questionFailed(committedSearch.failure, committedSearch.retry),
		isEdited: draft !== query,
		draftCount: suggested?.matchCount ?? 0,
		isFiltering,
		isPending: suggestions.length === 0 && isFiltering,
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
		results,
		matchCount: shown?.answer.matchCount ?? 0,
		figures: shown?.answer.figures ?? null,
		viewKey: `search:${(shown?.query ?? query).trim().toLowerCase()}`,
		wait,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
