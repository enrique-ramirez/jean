import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
	fetchPlaylistAnnotations,
	isFooJeanReady,
	moveQueueEntry,
	postQueue,
	type QueueLibraryTracksRequest,
	type QueueMutationResult,
	type QueuePlaylistRowsRequest,
	type QueueRead,
	removeQueueEntry,
	clearQueue as writeClearQueue,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import { pollPlayerNow } from "./playerPoll";
import { guidOf } from "./playlistJoin";
import { QUEUE_KEY, type QueueSource, readQueue } from "./queue";
import { askToShowQueue } from "./showQueue";

export function useQueue() {
	const { data } = useQuery<QueueRead>({
		queryKey: QUEUE_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});

	return useMemo(() => {
		const entries = readQueue(data);
		return { entries, count: entries.length };
	}, [data]);
}

export function useQueueActions() {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const canQueue = isFooJeanReady(discovery);
	const { origin, token } = discovery;

	const patchEntries = useCallback(
		(next: (entries: QueueRead["entries"]) => QueueRead["entries"]) =>
			queryClient.setQueryData<QueueRead>(QUEUE_KEY, (current) =>
				current ? { ...current, entries: next(current.entries) } : current,
			),
		[queryClient],
	);

	const settle = useCallback(
		async (result: QueueMutationResult) => {
			if (!result.ok)
				pushToast({
					tone: "error",
					message: translate(
						result.reason === "stale" ? "queue.movedUnderYou" : "queue.refused",
					),
				});
			if (origin && token) await pollPlayerNow(queryClient, origin, token);
			return result.ok;
		},
		[queryClient, origin, token],
	);

	const queue = useCallback(
		async (source: QueueSource, at?: number) => {
			if (!canQueue || !origin || !token) return;
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
				const annotations = await fetchPlaylistAnnotations(origin, token);
				let playlistId: string;
				try {
					playlistId = guidOf(source.targets[0].playlistId, annotations);
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

			await settle(await postQueue(origin, token, request));
		},
		[canQueue, origin, token, queryClient, settle],
	);

	const remove = useCallback(
		(at: number) => {
			if (!canQueue || !origin || !token) return Promise.resolve(false);

			patchEntries((entries) => entries.filter((_, index) => index !== at));
			const revision =
				queryClient.getQueryData<QueueRead>(QUEUE_KEY)?.revision ?? 0;
			return removeQueueEntry(origin, token, at, revision).then(settle);
		},
		[canQueue, origin, token, patchEntries, queryClient, settle],
	);

	const clear = useCallback(() => {
		if (!canQueue || !origin || !token) return Promise.resolve(false);

		patchEntries(() => []);
		return writeClearQueue(origin, token).then(settle);
	}, [canQueue, origin, token, patchEntries, settle]);

	const move = useCallback(
		(from: number, to: number) => {
			if (!canQueue || from === to || !origin || !token)
				return Promise.resolve(false);

			patchEntries((entries) => {
				const next = [...entries];
				const [item] = next.splice(from, 1);
				next.splice(to, 0, item);
				return next;
			});
			const revision =
				queryClient.getQueryData<QueueRead>(QUEUE_KEY)?.revision ?? 0;
			return moveQueueEntry(origin, token, { from, to, revision }).then(settle);
		},
		[canQueue, origin, token, patchEntries, queryClient, settle],
	);

	return { canQueue, queue, remove, clear, move };
}
