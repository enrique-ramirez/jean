import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { switchRefusalOf } from "@/shared/api/client";
import { isFooJeanReady } from "@/shared/api/discovery";
import { fetchPlaylistAnnotations } from "@/shared/api/playlists";
import {
	moveQueueEntry,
	postQueue,
	type QueueLibraryTracksRequest,
	type QueueMutationResult,
	type QueuePlaylistRowsRequest,
	type QueueRead,
	removeQueueEntry,
	clearQueue as writeClearQueue,
} from "@/shared/api/queue";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { moved } from "@/shared/lib/moved";
import type { CachePatch } from "@/shared/lib/patchCache";
import { pushToast } from "@/shared/ui/toastStore";
import { pollPlayerNow } from "./playerPoll";
import { announcePlaybackRefusal, patchInSession } from "./playerWrite";
import { guidOf, QUEUE_KEY, type QueueSource, readQueue } from "./queue";
import { askToShowQueue } from "./showQueue";
import { useCanControlPlayback } from "./usePlaybackControl";

export function useQueue() {
	const { data } = useCacheOnly<QueueRead>(QUEUE_KEY);

	return useMemo(() => {
		const entries = readQueue(data);
		return { entries, count: entries.length };
	}, [data]);
}

export function useQueueActions() {
	const queryClient = useQueryClient();
	const { discovery, recheck } = useFooJean();
	const canControlPlayback = useCanControlPlayback();
	const canQueue = isFooJeanReady(discovery) && canControlPlayback;
	const { origin } = discovery;

	const patchEntries = useCallback(
		(next: (entries: QueueRead["entries"]) => QueueRead["entries"]) =>
			patchInSession<QueueRead>(
				queryClient,
				QUEUE_KEY,
				(current) => ({ ...current, entries: next(current.entries) }),
				() => queryClient.getQueryData<QueueRead>(QUEUE_KEY)?.revision,
			),
		[queryClient],
	);

	const settle = useCallback(
		async (
			result: QueueMutationResult,
			{
				written,
				drag = false,
			}: { written?: CachePatch<QueueRead>; drag?: boolean } = {},
		) => {
			if (!result.ok) {
				if (result.reason !== "stale") written?.rollBack();
				const refused =
					result.reason !== "stale" &&
					switchRefusalOf(result) === "playbackDisabled";
				if (refused) {
					announcePlaybackRefusal(recheck);
				} else {
					pushToast({
						tone: "error",
						message: translate(
							result.reason === "stale"
								? drag
									? "queue.movedUnderYou"
									: "queue.staleRefused"
								: "queue.refused",
						),
					});
				}
			}
			if (origin) await pollPlayerNow(queryClient, origin);
			return result.ok;
		},
		[queryClient, origin, recheck],
	);

	const queue = useCallback(
		async (source: QueueSource, at?: number, drag = false) => {
			if (!canQueue || !origin) return;
			if (source.kind === "rows" && source.targets.length === 0) return;

			askToShowQueue();

			const atFields =
				at !== undefined
					? {
							at,
							revision:
								queryClient.getQueryData<QueueRead>(QUEUE_KEY)?.revision ?? 0,
						}
					: null;

			let request: QueuePlaylistRowsRequest | QueueLibraryTracksRequest;
			if (source.kind === "rows") {
				const annotations = await fetchPlaylistAnnotations(origin);
				let playlistId: string;
				try {
					playlistId = guidOf(
						source.targets[0].playlistId,
						annotations.ok ? annotations.value : null,
					);
				} catch {
					pushToast({ tone: "error", message: translate("queue.noSource") });
					return;
				}

				request = {
					playlistId,
					positions: source.targets.map((pair) => pair.itemIndex),
					...atFields,
				};
			} else {
				request = { ...source.request, ...atFields };
			}

			await settle(await postQueue(origin, request), { drag });
		},
		[canQueue, origin, queryClient, settle],
	);

	const remove = useCallback(
		(at: number) => {
			if (!canQueue || !origin) return Promise.resolve(false);

			const written = patchEntries((entries) =>
				entries.filter((_, index) => index !== at),
			);
			return removeQueueEntry(origin, at, written.previous?.revision ?? 0).then(
				(result) => settle(result, { written }),
			);
		},
		[canQueue, origin, patchEntries, settle],
	);

	const clear = useCallback(() => {
		if (!canQueue || !origin) return Promise.resolve(false);

		const written = patchEntries(() => []);
		return writeClearQueue(origin).then((result) =>
			settle(result, { written }),
		);
	}, [canQueue, origin, patchEntries, settle]);

	const move = useCallback(
		(from: number, to: number) => {
			if (!canQueue || from === to || !origin) return Promise.resolve(false);

			const written = patchEntries((entries) => moved(entries, from, to));
			return moveQueueEntry(origin, {
				from,
				to,
				revision: written.previous?.revision ?? 0,
			}).then((result) => settle(result, { written, drag: true }));
		},
		[canQueue, origin, patchEntries, settle],
	);

	return { canQueue, canControlPlayback, queue, remove, clear, move };
}
