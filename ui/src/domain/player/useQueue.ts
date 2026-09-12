import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
	addToPlayQueue,
	clearPlayQueue,
	fetchPlayQueue,
	removeFromPlayQueue,
} from "@/shared/api/beefweb";
import { isFooJeanReady } from "@/shared/api/fooJean";
import type { PlayQueueItem } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { inSequence } from "@/shared/lib/sequence";
import { pushToast } from "@/shared/ui/toastStore";
import {
	holdQueue,
	insertPlan,
	movePlan,
	QUEUE_KEY,
	type QueueTarget,
	readQueue,
	sameQueue,
} from "./queue";
import { askToShowQueue } from "./showQueue";

export function useQueue() {
	const { data } = useQuery({
		queryKey: QUEUE_KEY,
		queryFn: fetchPlayQueue,
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
	const { discovery } = useFooJean();
	const canQueue = isFooJeanReady(discovery);

	const underQueueHold = useCallback(
		async (run: () => Promise<unknown>) => {
			const release = holdQueue();
			let ok = true;
			try {
				await run();
			} catch {
				ok = false;
				pushToast({
					tone: "error",
					message: translate("queue.refused"),
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

	const queue = useCallback(
		async (pairs: QueueTarget[], at?: number) => {
			if (!canQueue || pairs.length === 0) return;

			askToShowQueue();

			let removals: number[] = [];
			let additions: QueueTarget[] = pairs;

			const shown = queryClient.getQueryData<PlayQueueItem[]>(QUEUE_KEY);

			if (at !== undefined && at < (shown?.length ?? 0)) {
				const current = await fetchPlayQueue().catch(() => null);
				if (!current || !sameQueue(current, shown)) {
					pushToast({
						tone: "error",
						message: translate("queue.movedUnderYou"),
					});
					return;
				}
				({ removals, additions } = insertPlan(current, at, pairs));
			}

			await underQueueHold(async () => {
				await inSequence(removals, removeFromPlayQueue);
				await inSequence(additions, (item) =>
					addToPlayQueue(item.playlistId, item.itemIndex),
				);
			});
		},
		[canQueue, queryClient, underQueueHold],
	);

	const remove = useCallback(
		(at: number) => {
			if (!canQueue) return Promise.resolve();
			patch((current) => current.filter((_, index) => index !== at));
			return underQueueHold(() => removeFromPlayQueue(at));
		},
		[canQueue, patch, underQueueHold],
	);

	const clear = useCallback(() => {
		if (!canQueue) return Promise.resolve();
		patch(() => []);
		return underQueueHold(() => clearPlayQueue());
	}, [canQueue, patch, underQueueHold]);

	const move = useCallback(
		async (from: number, to: number) => {
			if (!canQueue || from === to) return;

			const current = await fetchPlayQueue().catch(() => null);
			const shown = queryClient.getQueryData<PlayQueueItem[]>(QUEUE_KEY);
			if (!current || !sameQueue(current, shown)) {
				pushToast({
					tone: "error",
					message: translate("queue.movedUnderYou"),
				});
				return;
			}

			const plan = movePlan(current, from, to);
			patch(() => plan.next);

			await underQueueHold(async () => {
				await inSequence(plan.removals, removeFromPlayQueue);
				await inSequence(plan.additions, (item) =>
					addToPlayQueue(item.playlistId, item.itemIndex),
				);
			});
		},
		[canQueue, patch, queryClient, underQueueHold],
	);

	return { canQueue, queue, remove, clear, move };
}
