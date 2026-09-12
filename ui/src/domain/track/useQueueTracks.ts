import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { useQueueActions } from "@/domain/player/useQueue";
import { fetchPlaylists, fetchPlayQueue } from "@/shared/api/beefweb";
import { bearer } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import { findQueuePlaylist } from "./jeanPlaylists";
import type { HoldingPlaylist, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// The player takes one request per track and has no bulk form.
export const QUEUE_LIMIT = 100;

export function useQueueTracks() {
	const queryClient = useQueryClient();
	const { queue, canQueue } = useQueueActions();
	const { token, discovery } = useFooJean();
	const origin = discovery.origin;

	// The component's fill route makes the playlist for the `queue` role itself, so there is nothing
	// left to create through beefweb here: only the one job of clearing what an already-empty play
	// queue no longer points into, which now goes through the component's own role rather than
	// beefweb's `clear`, so it works whatever beefweb's `changePlaylists` says.
	const holding = useCallback(async (): Promise<HoldingPlaylist | null> => {
		const cached =
			queryClient.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY) ?? [];
		const held = findQueuePlaylist(cached);
		if (!held) return null;

		const queued = await fetchPlayQueue().catch(() => null);

		const playlists = await fetchPlaylists();
		const itemCount =
			playlists.find((entry) => entry.id === held.id)?.itemCount ?? 0;

		if (queued?.length === 0 && itemCount > 0 && origin && token) {
			const response = await fetch(`${origin}/api/playlists/own/queue/items`, {
				method: "DELETE",
				headers: bearer(token),
			});
			if (!response.ok)
				throw new Error(
					`DELETE /playlists/own/queue/items failed: ${response.status}`,
				);
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return { id: held.id, itemCount: 0 };
		}

		queryClient.setQueryData(PLAYLISTS_KEY, playlists);
		return { id: held.id, itemCount };
	}, [queryClient, origin, token]);

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
				targets = await source.queueTargets(itemIndices, holding, { token });
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
		[canQueue, holding, queue, token],
	);

	return { queueTracks, canQueue };
}
