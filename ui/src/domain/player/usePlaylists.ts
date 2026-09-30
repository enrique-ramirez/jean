import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	createPlaylist,
	fetchPlaylistAnnotations,
	movePlaylist,
	type PlaylistAnnotation,
	removePlaylist,
	renamePlaylist,
} from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { moved } from "@/shared/lib/moved";
import { type FollowRevision, followRevision } from "./followRevision";
import { useOptimisticWrite } from "./playerWrite";

export const PLAYLISTS_KEY = ["playlists"];

// A generation is always a non-empty run of digits, so an empty string is a value the component
// can never answer and is safe to hold until the create response replaces it.
const UNKNOWN_GENERATION = "";

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

const PLAYLISTS_REVISION_KEY = ["playlistsRevision"];
const PLAYLISTS_SEEN_REVISION_KEY = ["playlistsSeenRevision"];

const playlistsFollowers = new WeakMap<QueryClient, FollowRevision>();

function playlistsFollower(client: QueryClient): FollowRevision {
	let follower = playlistsFollowers.get(client);
	if (!follower) {
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

export function usePlaylistsCaughtUp(): boolean {
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

// `index` is positional, and the player renumbers the whole list when any playlist moves or goes away.
const renumber = (playlists: PlaylistInfo[]) =>
	playlists.map((entry, index) => ({ ...entry, index }));

const usePlaylistPatch = <TInput, TResult = unknown>(
	mutationFn: (input: TInput) => Promise<TResult>,
	patch: (playlists: PlaylistInfo[], input: TInput) => PlaylistInfo[],
	reconcile?: (
		playlists: PlaylistInfo[],
		input: TInput,
		result: TResult,
	) => PlaylistInfo[],
) =>
	useOptimisticWrite<PlaylistInfo[], TInput, TResult>(
		PLAYLISTS_KEY,
		mutationFn,
		(previous, input) => renumber(patch(previous, input)),
		reconcile &&
			((previous, input, result) =>
				renumber(reconcile(previous, input, result))),
		PLAYLISTS_REVISION_KEY,
	);

export function usePlaylistActions() {
	const { discovery } = useFooJean();

	const create = usePlaylistPatch<{ id: string; title: string }, PlaylistInfo>(
		async ({ title }) => {
			const origin = requireFooJean(discovery.origin);
			return playlistInfoOf(orThrow(await createPlaylist(origin, { title })));
		},
		(playlists, { id, title }) => [
			...playlists,
			{
				id,
				title,
				itemCount: 0,
				structure: UNKNOWN_GENERATION,
				revision: UNKNOWN_GENERATION,
				index: playlists.length,
				role: null,
				isAutoPlaylist: false,
			},
		],
		(playlists, { id }, created) =>
			playlists.map((entry) => (entry.id === id ? created : entry)),
	);

	return {
		create,

		rename: usePlaylistPatch(
			async ({ id, title }: { id: string; title: string }) => {
				const origin = requireFooJean(discovery.origin);
				orThrow(await renamePlaylist(origin, id, title));
			},
			(playlists, { id, title }) =>
				playlists.map((entry) =>
					entry.id === id ? { ...entry, title } : entry,
				),
		),

		remove: usePlaylistPatch(
			async (id: string) => {
				const origin = requireFooJean(discovery.origin);
				orThrow(await removePlaylist(origin, id));
			},
			(playlists, id) => playlists.filter((entry) => entry.id !== id),
		),

		move: usePlaylistPatch(
			async ({ id, index }: { id: string; index: number }) => {
				const origin = requireFooJean(discovery.origin);
				orThrow(await movePlaylist(origin, id, index));
			},
			(playlists, { id, index }) => {
				const from = playlists.findIndex((entry) => entry.id === id);
				return from < 0 ? playlists : moved(playlists, from, index);
			},
		),
	};
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
