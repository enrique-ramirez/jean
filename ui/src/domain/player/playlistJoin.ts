import { useMemo } from "react";

import type { PlaylistAnnotation } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";

import { usePlaylists, usePlaylistsCaughtUp } from "./usePlayer";

// Every address is the component's own GUID now, `PlaylistInfo.id` included, so there is no second
// id left to join against: this confirms the GUID still names a playlist Jean holds, or says the
// list has not settled yet. Kept for the callers still asking the question this way; a caller
// holding the GUID and the current list can compare them directly instead.
export function beefwebIdOf(
	guid: string | null,
	entries: readonly PlaylistAnnotation[],
	playlists: readonly PlaylistInfo[],
	settled: boolean,
): string | null | undefined {
	if (!guid) return null;
	if (
		entries.some((annotation) => annotation.id === guid) ||
		playlists.some((playlist) => playlist.id === guid)
	)
		return guid;
	return settled ? null : undefined;
}

export function usePlayingPlaylist(
	guid: string | null,
): string | null | undefined {
	const { data: playlists = [] } = usePlaylists();
	const caughtUp = usePlaylistsCaughtUp();

	return useMemo(() => {
		if (!guid) return null;
		if (playlists.some((playlist) => playlist.id === guid)) return guid;
		return caughtUp ? null : undefined;
	}, [guid, playlists, caughtUp]);
}

// Validates rather than converts: every id a caller holds is already the GUID `GET /playlists`
// answers, and this confirms it names a playlist that annotation list still carries.
export function guidOf(
	id: string,
	entries: readonly PlaylistAnnotation[] | null,
): string {
	const entry = entries?.find((annotation) => annotation.id === id);
	if (!entry) throw new Error(`no foo_jean playlist for id ${id}`);
	return entry.id;
}
