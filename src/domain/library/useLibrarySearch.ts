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

	const remembered = useMemo(
		() => queryOfScratchPlaylist(playlists.find(isScratchPlaylist)) || null,
		[playlists],
	);

	const restore = useCallback(() => {
		setQuery((current) => current || remembered || "");
	}, [remembered]);

	const canEdit = canChangePlaylists(permissions);

	const clear = useCallback(() => {
		setQuery("");
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
		if (query.length > 0) request();
	}, [query, request]);

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
		viewKey: `search:${deferredQuery.trim().toLowerCase()}`,
	};
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
