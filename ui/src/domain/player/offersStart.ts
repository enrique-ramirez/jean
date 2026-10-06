import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { offersSessions } from "@/shared/api/discovery";
import { FOO_JEAN_KEY, useFooJean } from "@/shared/hooks/useFooJean";
import { subscribers } from "@/shared/lib/store";

const withdrawals = subscribers();
let withdrawnUnder: number | null = null;

export function withdrawStart(client: QueryClient): void {
	withdrawnUnder = client.getQueryState(FOO_JEAN_KEY)?.dataUpdatedAt ?? 0;
	withdrawals.notify();
}

const withdrawnUnderAnswer = () => withdrawnUnder;

// TanStack Query keeps the same `data` object when an answer deep-equals the one before; its
// `dataUpdatedAt` moves on every answer.
export const awaitsDiscovery = (
	withdrawnUnder: number | null,
	answeredAt: number,
): boolean => withdrawnUnder !== null && answeredAt === withdrawnUnder;

export function useIsStartOffered(): boolean {
	const { discovery, answeredAt } = useFooJean();
	const withdrawn = useSyncExternalStore(
		withdrawals.subscribe,
		withdrawnUnderAnswer,
	);
	return offersSessions(discovery) && !awaitsDiscovery(withdrawn, answeredAt);
}
