import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	createPlaylist,
	movePlaylist,
	removePlaylist,
	renamePlaylist,
} from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { moved } from "@/shared/lib/moved";
import { pollPlayerNow } from "./playerPoll";
import { useOptimisticWrite } from "./playerWrite";
import {
	PLAYLISTS_KEY,
	PLAYLISTS_REVISION_KEY,
	playlistInfoOf,
	playlistsSettled,
} from "./usePlaylists";

// A generation is always a non-empty run of digits, so an empty string is a value the component
// can never answer and is safe to hold until the create response replaces it.
const UNKNOWN_GENERATION = "";

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

export function useCatchUpPlaylists() {
	const queryClient = useQueryClient();
	const { origin } = useFooJean().discovery;

	return useCallback(async () => {
		if (!origin) return;
		await pollPlayerNow(queryClient, origin);
		await playlistsSettled(queryClient);
	}, [queryClient, origin]);
}

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
