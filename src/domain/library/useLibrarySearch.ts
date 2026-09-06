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
import {
	isScratchPlaylist,
	queryOfScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { libraryIndex, searchLibrary } from "@/domain/track/libraryIndex";
import { EMPTY_VIEW, project } from "@/domain/track/project";
import { bestMatches } from "@/domain/track/rankTracks";
import { removePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { readStoredState, useStoredState } from "@/shared/hooks/useStoredState";
import type { Library } from "./useLibrary";
import { SCRATCH_PIN_KEY } from "./useScratchPlaylist";

const PREVIEW_TRACKS = 8;

const EMPTY_PREVIEW: number[] = [];

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

	const matched = useMemo(
		() => (index ? searchLibrary(index, query) : null),
		[index, query],
	);

	const results = useMemo(
		() => project(library.snapshot, matched),
		[library.snapshot, matched],
	);

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
		preview,
		draftMatched,
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
