import { useQuery } from "@tanstack/react-query";

import { orThrow, type Schema, settle } from "@/shared/api/client";
import { isFooJeanReady, requireFooJean } from "@/shared/api/discovery";
import { listSessions, type SessionDocument } from "@/shared/api/sessions";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { AUDIENCE_POLL_MS, deviceName, numberedLabels } from "./audience";
import { deviceId } from "./device";

export const SESSIONS_KEY = ["sessions"];

export interface ListedSession {
	document: SessionDocument;
	label: string;
	isOwn: boolean;
}

export interface SessionList {
	player: SessionDocument | null;
	sessions: ListedSession[];
}

function listOf({ sessions }: Schema["Sessions"]): SessionList {
	const self = deviceId();
	const labelled = numberedLabels();
	const detached: ListedSession[] = [];
	let player: SessionDocument | null = null;

	for (const document of sessions) {
		if (document.kind === "engine") {
			player = document;
			continue;
		}
		detached.push({
			document,
			label: labelled(deviceName(document.createdBy?.name)),
			isOwn: document.createdBy?.deviceId === self,
		});
	}

	return { player, sessions: detached };
}

export function useSessions(isOpen: boolean): SessionList | undefined {
	const { discovery } = useFooJean();
	const enabled = isOpen && isFooJeanReady(discovery);

	return useQuery({
		queryKey: SESSIONS_KEY,
		enabled,
		staleTime: 0,
		refetchInterval: enabled ? AUDIENCE_POLL_MS.open : false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
		select: listOf,
		queryFn: async () =>
			orThrow(
				await settle<Schema["Sessions"]>(
					listSessions(requireFooJean(discovery.origin), deviceId()),
				),
			),
	}).data;
}
