import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
	addToPlayQueue,
	clearPlayQueue,
	fetchPlayQueue,
	removeFromPlayQueue,
} from "@/shared/api/beefweb";
import type { PlayQueueItem } from "@/shared/api/types";
import { descending, inSequence } from "@/shared/lib/sequence";
import { plural } from "@/shared/lib/text";
import { pushToast } from "@/shared/ui/toastStore";
import {
	holdQueue,
	moved,
	QUEUE_KEY,
	readQueue,
	rebuildFrom,
	sameQueue,
} from "./queue";
import { usePermissions } from "./usePlayer";

export function useQueue() {
	const { data } = useQuery({
		queryKey: QUEUE_KEY,
		queryFn: fetchPlayQueue,
		// The stream owns this key; the fetch only covers first paint and reconnect.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});

	const items = data;

	return useMemo(() => {
		const entries = readQueue(items);
		return { entries, count: entries.length };
	}, [items]);
}

export function useQueueActions() {
	const queryClient = useQueryClient();
	const permissions = usePermissions();

	// beefweb publishes no permission for the queue itself. This is the nearest
	// true thing: an instance refusing playlist writes cannot hold a queue either.
	const canQueue = permissions.changePlaylists !== false;

	const write = useCallback(
		async (run: () => Promise<unknown>) => {
			const release = holdQueue();
			let ok = true;
			try {
				await run();
			} catch {
				ok = false;
				pushToast({
					tone: "error",
					message: "The player would not change the queue.",
				});
			}
			// Inside the hold, so a push cannot interleave between read and write.
			const truth = await fetchPlayQueue().catch(() => null);
			if (truth) queryClient.setQueryData(QUEUE_KEY, truth);
			release();
			return ok;
		},
		[queryClient],
	);

	const patch = useCallback(
		(next: (current: PlayQueueItem[]) => PlayQueueItem[]) =>
			queryClient.setQueryData<PlayQueueItem[]>(QUEUE_KEY, (current) =>
				next(current ?? []),
			),
		[queryClient],
	);

	// Sequential, and it has to be: fired concurrently these arrive in whatever
	// order the network settles on, and the order is the point of a queue.
	const queue = useCallback(
		async (pairs: { playlistId: string; itemIndex: number }[]) => {
			if (!canQueue || pairs.length === 0) return;

			const before = (await fetchPlayQueue().catch(() => null))?.length ?? null;

			await write(() =>
				inSequence(pairs, (pair) =>
					addToPlayQueue(pair.playlistId, pair.itemIndex),
				),
			);

			const undo =
				before === null
					? undefined
					: async () => {
							// Those positions are only ours while nothing else has touched the
							// queue -- and a track starting consumes the head of it.
							const current = await fetchPlayQueue().catch(() => null);
							if (!current || current.length !== before + pairs.length) {
								pushToast({
									tone: "error",
									message:
										"The queue has changed since then, so nothing was removed.",
								});
								return;
							}
							// Highest first: every removal renumbers the ones after it.
							await write(() =>
								inSequence(
									descending(current.length - 1, before),
									removeFromPlayQueue,
								),
							);
						};

			pushToast({
				message: `Queued ${plural(pairs.length, "track")}`,
				action: undo ? { label: "Undo", run: undo } : undefined,
			});
		},
		[canQueue, write],
	);

	const remove = useCallback(
		(at: number) => {
			if (!canQueue) return Promise.resolve();
			patch((current) => current.filter((_, index) => index !== at));
			return write(() => removeFromPlayQueue(at));
		},
		[canQueue, patch, write],
	);

	const clear = useCallback(() => {
		if (!canQueue) return Promise.resolve();
		patch(() => []);
		return write(() => clearPlayQueue());
	}, [canQueue, patch, write]);

	const move = useCallback(
		async (from: number, to: number) => {
			if (!canQueue || from === to) return;

			// A track ending mid-drag consumes the head and shifts every index the
			// plan is built from, so a queue that moved is refused, not half-applied.
			const current = await fetchPlayQueue().catch(() => null);
			const shown = queryClient.getQueryData<PlayQueueItem[]>(QUEUE_KEY);
			if (!current || !sameQueue(current, shown)) {
				pushToast({
					tone: "error",
					message:
						"The queue changed while you were dragging, so it was left alone.",
				});
				return;
			}

			const next = moved(current, from, to);
			patch(() => next);

			const at = rebuildFrom(from, to);
			await write(async () => {
				await inSequence(
					descending(current.length - 1, at),
					removeFromPlayQueue,
				);
				await inSequence(next.slice(at), (item) =>
					addToPlayQueue(item.playlistId, item.itemIndex),
				);
			});
		},
		[canQueue, patch, queryClient, write],
	);

	return { canQueue, queue, remove, clear, move };
}
