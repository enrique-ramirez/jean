import type { QueryClient } from "@tanstack/react-query";

import { AUDIENCE_POLL_MS } from "./audience";
import { sessionEpoch, sessionSnapshot } from "./session";
import { readSessionDocument } from "./sessionDocument";
import { leaveSession } from "./sessionOperations";

// `kMuteLingerSeconds` in `foo_jean`'s `core/settings.h`: how long a listener whose stream dropped
// has to reconnect before the component lets it go. No route publishes it.
const COMPONENT_LINGER_MS = 8_000;

export const NOBODY_LISTENING_MS = COMPONENT_LINGER_MS + AUDIENCE_POLL_MS.open;

let nobodySince: { epoch: number; at: number } | null = null;
let lastReadAt = Number.NEGATIVE_INFINITY;
let isReading = false;

function hasNobodyListenedTooLong(listeners: number, epoch: number): boolean {
	const now = performance.now();
	if (listeners > 0) {
		nobodySince = null;
		return false;
	}
	if (nobodySince?.epoch !== epoch) {
		nobodySince = { epoch, at: now };
		return false;
	}
	return now - nobodySince.at > NOBODY_LISTENING_MS;
}

export async function watchForNobodyListening(
	client: QueryClient,
	origin: string,
	answeredChange: boolean,
): Promise<void> {
	const { id, role } = sessionSnapshot();
	if (id === null || role !== "controlling") {
		nobodySince = null;
		return;
	}
	const isDue = performance.now() - lastReadAt >= AUDIENCE_POLL_MS.open;
	if (isReading || !(answeredChange || isDue)) return;

	const epoch = sessionEpoch();
	isReading = true;
	lastReadAt = performance.now();
	try {
		const document = await readSessionDocument(client, origin, id);
		if (!document || sessionSnapshot().role !== "controlling") return;
		if (hasNobodyListenedTooLong(document.listeners, epoch))
			void leaveSession(
				{ origin, queryClient: client },
				{ kind: "nobodyListening", id },
			);
	} finally {
		isReading = false;
	}
}
