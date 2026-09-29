import {
	type Answer,
	ask,
	orNull,
	PROBE_TIMEOUT_MS,
	reach,
	refusalOf,
	type Schema,
	type SwitchRefusal,
	switchRefusalIn,
	UNREACHABLE,
	WRITE_TIMEOUT_MS,
} from "./client";

export type QueueRead = Schema["QueueRead"];
export type QueuedTrack = Schema["QueuedTrack"];
export type QueuePlaylistRowsRequest = Schema["QueuePlaylistRowsRequest"];
export type QueueLibraryTracksRequest = Schema["QueueLibraryTracksRequest"];
export type MoveQueueRequest = Schema["MoveQueueRequest"];

export type QueueMutationResult =
	| { ok: true }
	| { ok: false; reason: "stale" }
	| {
			ok: false;
			reason: "failed";
			message: string;
			refusal: SwitchRefusal | null;
	  };

async function queueMutation(
	answer: Promise<Answer<unknown>>,
): Promise<QueueMutationResult> {
	const answered = await reach(answer);
	if (!answered)
		return { ok: false, reason: "failed", message: UNREACHABLE, refusal: null };
	const { error, response } = answered;
	if (response.ok) return { ok: true };
	if (response.status === 409) return { ok: false, reason: "stale" };
	const refusal = refusalOf(response, error);
	return {
		ok: false,
		reason: "failed",
		message: refusal.message,
		refusal: response.status === 403 ? switchRefusalIn(refusal.error) : null,
	};
}

export const fetchQueue = (origin: string) =>
	orNull(ask(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/queue", init)));

export const postQueue = (
	origin: string,
	request: QueuePlaylistRowsRequest | QueueLibraryTracksRequest,
) =>
	queueMutation(
		ask(origin, WRITE_TIMEOUT_MS, (api, init) =>
			api.POST("/queue", { ...init, body: request }),
		),
	);

export const clearQueue = (origin: string) =>
	queueMutation(
		ask(origin, WRITE_TIMEOUT_MS, (api, init) => api.DELETE("/queue", init)),
	);

export const moveQueueEntry = (origin: string, request: MoveQueueRequest) =>
	queueMutation(
		ask(origin, WRITE_TIMEOUT_MS, (api, init) =>
			api.POST("/queue/move", { ...init, body: request }),
		),
	);

export const removeQueueEntry = (
	origin: string,
	index: number,
	revision: number,
) =>
	queueMutation(
		ask(origin, WRITE_TIMEOUT_MS, (api, init) =>
			api.DELETE("/queue/{index}", {
				...init,
				params: { path: { index }, query: { revision } },
			}),
		),
	);
