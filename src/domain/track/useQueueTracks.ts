import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { useQueueActions } from "@/domain/player/useQueue";
import {
	clearPlaylist,
	createPlaylist,
	fetchPlaylists,
	fetchPlayQueue,
} from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { pushToast } from "@/shared/ui/toastStore";
import { findQueuePlaylist, QUEUE_TITLE } from "./jeanPlaylists";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// One request per track and no bulk form, so the cost is linear and visible.
export const QUEUE_LIMIT = 100;

export function useQueueTracks() {
	const queryClient = useQueryClient();
	const { queue, canQueue } = useQueueActions();

	// Emptied on the way in, never deleted, and only while the queue is provably
	// empty -- deleting a playlist the queue points into crashes the player.
	const holding = useCallback(async () => {
		const playlists =
			queryClient.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY) ?? [];
		const held = findQueuePlaylist(playlists);

		const target = held ?? (await createPlaylist(QUEUE_TITLE));

		if (held) {
			const queued = await fetchPlayQueue().catch(() => null);
			// Off the player: item changes are never pushed, so a cached count is
			// stale from the first append onwards.
			const live = (await fetchPlaylists()).find(
				(entry) => entry.id === held.id,
			);
			if (queued?.length === 0 && (live?.itemCount ?? 0) > 0)
				await clearPlaylist(held.id);
		}

		await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
		return target?.id ?? null;
	}, [queryClient]);

	const queueTracks = useCallback(
		async ({
			source,
			itemIndices,
		}: {
			source: LibrarySource;
			itemIndices: Refs;
		}) => {
			if (!canQueue || itemIndices.length === 0) return;

			if (itemIndices.length > QUEUE_LIMIT) {
				pushToast({
					tone: "error",
					message: `The queue takes ${QUEUE_LIMIT} tracks at a time — the player has no way to add them in bulk. Make a playlist for a set this size.`,
				});
				return;
			}

			let targets: Awaited<ReturnType<LibrarySource["queueTargets"]>>;
			try {
				targets = await source.queueTargets(itemIndices, holding);
			} catch {
				pushToast({
					tone: "error",
					message: "Could not find somewhere to queue those tracks from.",
				});
				return;
			}

			if (targets.length < itemIndices.length) {
				pushToast({
					tone: "error",
					message: "Some of those tracks could not be queued.",
				});
			}

			await queue(targets);
		},
		[canQueue, holding, queue],
	);

	return { queueTracks, canQueue };
}
