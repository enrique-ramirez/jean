import {
	type Answer,
	askResult,
	type Call,
	PATIENT_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	type Result,
	type Schema,
} from "./client";

export type QueueRead = Schema["QueueRead"];
export type QueuedTrack = Schema["QueuedTrack"];
export type QueuePlaylistRowsRequest = Schema["QueuePlaylistRowsRequest"];
export type QueueLibraryTracksRequest = Schema["QueueLibraryTracksRequest"];
export type MoveQueueRequest = Schema["MoveQueueRequest"];

export type QueueMutationResult =
	| Result<unknown>
	| { ok: false; reason: "stale" };

async function queueMutation(
	origin: string,
	call: Call<Answer<unknown>>,
): Promise<QueueMutationResult> {
	const written = await askResult(origin, PATIENT_TIMEOUT_MS, call);
	return !written.ok && written.reason === "refused" && written.status === 409
		? { ok: false, reason: "stale" }
		: written;
}

export const fetchQueue = (origin: string) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/queue", init));

export const postQueue = (
	origin: string,
	addition: QueuePlaylistRowsRequest | QueueLibraryTracksRequest,
) =>
	queueMutation(origin, (api, init) =>
		api.POST("/queue", { ...init, body: addition }),
	);

export const clearQueue = (origin: string) =>
	queueMutation(origin, (api, init) => api.DELETE("/queue", init));

export const moveQueueEntry = (origin: string, move: MoveQueueRequest) =>
	queueMutation(origin, (api, init) =>
		api.POST("/queue/move", { ...init, body: move }),
	);

export const removeQueueEntry = (
	origin: string,
	index: number,
	revision: number,
) =>
	queueMutation(origin, (api, init) =>
		api.DELETE("/queue/{index}", {
			...init,
			params: { path: { index }, query: { revision } },
		}),
	);
