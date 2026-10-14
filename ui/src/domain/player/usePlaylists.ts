import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	fetchPlaylistAnnotations,
	type PlaylistAnnotation,
} from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { translate } from "@/shared/i18n/locale";
import { type FollowRevision, followRevision } from "./followRevision";

export const PLAYLISTS_KEY = ["playlists"];

export const playlistInfoOf = (
	annotation: PlaylistAnnotation,
): PlaylistInfo => ({
	id: annotation.id,
	index: annotation.index,
	title: annotation.title,
	itemCount: annotation.itemCount,
	structure: annotation.structure,
	revision: annotation.revision,
	role: annotation.role,
	isAutoPlaylist: annotation.isAutoPlaylist,
	managed: annotation.managed,
});

export const usePlaylists = () => useCacheOnly<PlaylistInfo[]>(PLAYLISTS_KEY);

export const PLAYLISTS_REVISION_KEY = ["playlistsRevision"];
const PLAYLISTS_SEEN_REVISION_KEY = ["playlistsSeenRevision"];

const playlistsFollowers = new WeakMap<QueryClient, FollowRevision>();

function playlistsFollower(client: QueryClient): FollowRevision {
	let follower = playlistsFollowers.get(client);
	if (!follower) {
		client.setQueryDefaults(PLAYLISTS_KEY, { gcTime: Infinity });
		follower = followRevision<PlaylistAnnotation[]>({
			resource: "playlist list",
			read: fetchPlaylistAnnotations,
			apply: (annotations, revision) => {
				client.setQueryData(PLAYLISTS_KEY, annotations.map(playlistInfoOf));
				client.setQueryData(PLAYLISTS_REVISION_KEY, revision);
			},
		});
		playlistsFollowers.set(client, follower);
	}
	return follower;
}

// `GET /playlists` carries no revision of its own, so the one from `GET /state`'s `player` is kept
// beside the list to compare against: re-read only when it has moved, exactly as the queue does.
export function followPlaylists(
	client: QueryClient,
	origin: string,
	revision: number,
): void {
	client.setQueryData(PLAYLISTS_SEEN_REVISION_KEY, revision);
	playlistsFollower(client).announce(origin, revision);
}

export const playlistsSettled = (client: QueryClient) =>
	playlistsFollower(client).settled();

function usePlaylistsCaughtUp(): boolean {
	const { data: seen } = useCacheOnly<number>(PLAYLISTS_SEEN_REVISION_KEY);
	const { data: fetchedAt } = useCacheOnly<number>(PLAYLISTS_REVISION_KEY);
	return seen !== undefined && seen === fetchedAt;
}

export function resolvedPlaylistId(
	guid: string | null,
	playlists: readonly PlaylistInfo[],
	caughtUp: boolean,
): string | null | undefined {
	if (!guid) return null;
	if (playlists.some((playlist) => playlist.id === guid)) return guid;
	return caughtUp ? null : undefined;
}

export function useResolvedPlaylistId(
	guid: string | null,
): string | null | undefined {
	const { data: playlists = [] } = usePlaylists();
	const caughtUp = usePlaylistsCaughtUp();

	return useMemo(
		() => resolvedPlaylistId(guid, playlists, caughtUp),
		[guid, playlists, caughtUp],
	);
}

// foobar2000 allows two playlists with the same name, and the sidebar shows nothing else to tell
// them apart by.
export function untitledPlaylistName(
	playlists: PlaylistInfo[],
	base = translate("playlist.newName"),
) {
	const taken = new Set(playlists.map((entry) => entry.title));

	return (
		[
			base,
			...Array.from(
				{ length: playlists.length + 1 },
				(_, at) => `${base} ${at + 2}`,
			),
		].find((name) => !taken.has(name)) ?? base
	);
}
