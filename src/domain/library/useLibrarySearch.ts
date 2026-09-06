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
import { removePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { readStoredState, useStoredState } from "@/shared/hooks/useStoredState";
import type { Library } from "./useLibrary";
import { SCRATCH_PIN_KEY } from "./useScratchPlaylist";

// Owns the query and nothing else: the rows, the source and the loading belong to `useLibrary`. Held by the shell, so it survives navigating away and back.
export function useLibrarySearch(library: Library, playlists: PlaylistInfo[]) {
	const permissions = usePermissions();
	const { data: playerSnapshot } = usePlayer();
	const [query, setQuery] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [, setPinnedScratch] = useStoredState<string | null>(
		SCRATCH_PIN_KEY,
		null,
	);

	// The scratch playlist's title is the query that built it, which is how a search survives a reload and reaches another device.
	// Reading it does not touch the library, so a session that never searches never loads it.
	const remembered = useMemo(
		() => queryOfScratchPlaylist(playlists.find(isScratchPlaylist)) || null,
		[playlists],
	);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
	}, [remembered]);

	// Read out here rather than inside: `usePermissions` answers with a fresh object on a player that reports none, so a callback depending on it would have a new identity every render.
	const canEdit = canChangePlaylists(permissions);

	// Dismissing the search takes the playlist with it, except while the player is on it: deleting the playing playlist does not stop playback, it falls back to another one and wanders out of the results.
	const clear = useCallback(() => {
		setQuery("");
		if (!canEdit) return;

		// Read now rather than closed over: this also runs from a save, which drops the pin as it hands the playlist to the user, and a captured value predates that.
		const pinned = readStoredState<string | null>(SCRATCH_PIN_KEY, null);
		// The title is the second guard the pin needs: a beefweb id is not promised to outlive the player process, so a stale pin can name somebody's own playlist by now.
		const scratch = playlists.find((entry) => entry.id === pinned);
		if (!isScratchPlaylist(scratch)) return;

		// The active item, not `isCurrent`: that keeps pointing at the last playlist played from long after playback stopped.
		if (scratch.id === playerSnapshot?.player?.activeItem?.playlistId) return;

		removePlaylist(scratch.id);
		setPinnedScratch(null);
	}, [playlists, canEdit, playerSnapshot, setPinnedScratch]);

	const { request } = library;

	// A restored query never touches the field, so focus alone would leave the library unrequested and the results empty.
	useEffect(() => {
		if (query.length > 0) request();
	}, [query, request]);

	// Typing stays responsive while the filter runs over the whole library behind it.
	const deferredQuery = useDeferredValue(query);

	const matched = useMemo(
		() =>
			library.key && library.rows.length > 0
				? searchLibrary(libraryIndex(library.key, library.rows), deferredQuery)
				: null,
		[library.key, library.rows, deferredQuery],
	);

	const results = useMemo(
		() => project(library.snapshot, matched),
		[library.snapshot, matched],
	);

	const focus = useCallback(() => {
		request();
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [request]);

	return {
		query,
		setQuery,
		clear,
		inputRef,
		focus,
		remembered,
		restore,
		// Mod chords still fire inside a text field, so the list stands down while the field has focus or Mod+A selects the library.
		isFocused,
		onFocus: useCallback(() => {
			setIsFocused(true);
			request();
		}, [request]),
		onBlur: useCallback(() => setIsFocused(false), []),
		hasQuery: query.trim().length > 0,
		isFiltering: query !== deferredQuery,
		results: results ?? EMPTY_VIEW,
		matchCount: matched?.length ?? 0,
		// Distinct per query, so each result set is its own view with its own scroll offset, cursor and row measurements.
		viewKey: `search:${deferredQuery.trim().toLowerCase()}`,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
