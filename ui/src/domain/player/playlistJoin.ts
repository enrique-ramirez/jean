import { useMemo } from "react";

import type { PlaylistAnnotation } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";

import { usePlaylistAnnotations } from "./useAutoPlaylists";
import { usePlaylists } from "./usePlayer";

export function beefwebIdOf(
	guid: string | null,
	entries: readonly PlaylistAnnotation[],
	playlists: readonly PlaylistInfo[],
	settled: boolean,
): string | null | undefined {
	if (!guid) return null;
	const entry = entries.find((annotation) => annotation.id === guid);
	if (entry)
		return (
			entry.beefwebId ??
			playlists.find((playlist) => playlist.index === entry.index)?.id ??
			null
		);
	return settled ? null : undefined;
}

export function usePlayingPlaylist(
	guid: string | null,
): string | null | undefined {
	const { data: playlists = [] } = usePlaylists();
	const { entries, hasSettled, isFetching } = usePlaylistAnnotations();
	const settled = hasSettled && !isFetching;

	return useMemo(
		() => beefwebIdOf(guid, entries, playlists, settled),
		[guid, entries, playlists, settled],
	);
}

export function guidOf(
	beefwebId: string,
	entries: readonly PlaylistAnnotation[] | null,
): string {
	const entry = entries?.find(
		(annotation) => annotation.beefwebId === beefwebId,
	);
	if (!entry)
		throw new Error(`no foo_jean playlist for beefweb id ${beefwebId}`);
	return entry.id;
}
