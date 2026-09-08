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
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import { findQueuePlaylist, QUEUE_TITLE } from "./jeanPlaylists";
import type { HoldingPlaylist, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// The player takes one request per track and has no bulk form.
export const QUEUE_LIMIT = 100;

export function useQueueTracks() {
	const queryClient = useQueryClient();
	const { queue, canQueue } = useQueueActions();

	const holding = useCallback(async (): Promise<HoldingPlaylist | null> => {
		const cached =
			queryClient.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY) ?? [];
		const held = findQueuePlaylist(cached);

		const target = held ?? (await createPlaylist(QUEUE_TITLE));
		if (!target) return null;

		const queued = held ? await fetchPlayQueue().catch(() => null) : null;

		// From the player: item changes are never pushed, so a cached count is stale from the first
		// append on.
		const playlists = await fetchPlaylists();
		const itemCount =
			playlists.find((entry) => entry.id === target.id)?.itemCount ?? 0;

		if (queued?.length === 0 && itemCount > 0) {
			await clearPlaylist(target.id);
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return { id: target.id, itemCount: 0 };
		}

		queryClient.setQueryData(PLAYLISTS_KEY, playlists);
		return { id: target.id, itemCount };
	}, [queryClient]);

	const queueTracks = useCallback(
		async ({
			source,
			itemIndices,
			at,
		}: {
			source: LibrarySource;
			itemIndices: Refs;
			at?: number;
		}) => {
			if (!canQueue || itemIndices.length === 0) return;

			if (itemIndices.length > QUEUE_LIMIT) {
				pushToast({
					tone: "error",
					message: translate("queue.tooMany", { limit: QUEUE_LIMIT }),
				});
				return;
			}

			let targets: Awaited<ReturnType<LibrarySource["queueTargets"]>>;
			try {
				targets = await source.queueTargets(itemIndices, holding);
			} catch {
				pushToast({
					tone: "error",
					message: translate("queue.noSource"),
				});
				return;
			}

			if (targets.length < itemIndices.length) {
				pushToast({
					tone: "error",
					message: translate("queue.partial"),
				});
			}

			await queue(targets, at);
		},
		[canQueue, holding, queue],
	);

	return { queueTracks, canQueue };
}
