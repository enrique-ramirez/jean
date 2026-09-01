import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { usePermissions, usePlayer } from "@/domain/player/usePlayer";
import {
	isScratchPlaylist,
	queryOfScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { libraryIndex, searchLibrary } from "@/domain/track/libraryIndex";
import { EMPTY_VIEW, project } from "@/domain/track/project";
import { removePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Library } from "./useLibrary";

// Owns the query and nothing else: the rows, the source and the loading belong
// to `useLibrary`. Held by the shell, so it survives navigating away and back.
export function useLibrarySearch(library: Library, playlists: PlaylistInfo[]) {
	const permissions = usePermissions();
	const { data: playerSnapshot } = usePlayer();
	const [query, setQuery] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// The scratch playlist's title is the query that built it, which is how a
	// search survives a reload and reaches another device. Reading it does not
	// touch the library, so a session that never searches never loads it.
	const remembered = useMemo(
		() => queryOfScratchPlaylist(playlists.find(isScratchPlaylist)) || null,
		[playlists],
	);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
	}, [remembered]);

	// Dismissing the search takes the playlist with it -- except while the player
	// is on it, because deleting the playing playlist does not stop playback: the
	// player falls back to another one and carries on, which is the wandering out
	// of the results this whole arrangement exists to stop.
	const clear = useCallback(() => {
		setQuery("");

		// The active item, not `isCurrent`: that keeps pointing at the last
		// playlist played from long after playback stopped.
		const playingFrom = playerSnapshot?.player?.activeItem?.playlistId;
		const scratch = playlists.find(isScratchPlaylist);
		if (
			!scratch ||
			scratch.id === playingFrom ||
			permissions.changePlaylists === false
		)
			return;
		removePlaylist(scratch.id);
	}, [playlists, permissions.changePlaylists, playerSnapshot]);

	const { request } = library;

	// A query is an ask, however it arrived. Focus is the other one, and a reload
	// restoring a query focuses nothing -- without this it renders no rows.
	useEffect(() => {
		if (query.length > 0) request();
	}, [query, request]);

	// Typing stays responsive while the filter runs over 30k rows behind it.
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
		// Mod chords still fire inside a text field, so the list has to stand down
		// while the field has focus or Mod+A selects the library.
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
		// Distinct per query, so each result set is its own view with its own
		// scroll offset, cursor and row measurements.
		viewKey: `search:${deferredQuery.trim().toLowerCase()}`,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
