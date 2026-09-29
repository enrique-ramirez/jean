import {
	ask,
	reach,
	refusalOf,
	type Schema,
	unreachable,
	WRITE_TIMEOUT_MS,
} from "./client";

export type TagWriteRequest = Schema["TagWriteRequest"];
export type TagWritten = Schema["TagWritten"];

export type WriteFailure =
	| { ok: false; reason: "not-allowed"; field: string | null; message: string }
	| { ok: false; reason: "unknown-track"; message: string }
	// Two media library roots hold the path that was sent, so foo_jean refused to pick one.
	| { ok: false; reason: "ambiguous"; message: string }
	// foo_jean checks the generation inside the job that writes, so nothing was written.
	| { ok: false; reason: "moved"; message: string }
	// The write may still land, so it is never rolled back.
	| { ok: false; reason: "timeout"; message: string }
	| { ok: false; reason: "too-fast"; message: string }
	| { ok: false; reason: "refused"; message: string }
	| { ok: false; reason: "failed"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type WriteResult = { ok: true; written: TagWritten } | WriteFailure;

// The only 409 a write may answer by trying again. The other two, a playlist read at an older
// structure and a library rebuilt under an ordinal, are stale addresses and nothing to send a
// second write to.
const NAMES_TWO_TRACKS =
	"the media library holds more than one track at that address" satisfies Schema["TagFailed"]["error"];

export async function writeTags(
	origin: string,
	request: TagWriteRequest,
): Promise<WriteResult> {
	const answer = await reach(askWrite(origin, request));
	if (!answer)
		return { ok: false, reason: "unreachable", message: unreachable() };
	const { data, error, response } = answer;
	if (data) return { ok: true, written: data };

	const { message, error: said, field } = refusalOf(response, error);

	if (response.status === 403)
		return { ok: false, reason: "not-allowed", field, message };
	if (response.status === 404)
		return { ok: false, reason: "unknown-track", message };
	if (response.status === 409)
		return said === NAMES_TWO_TRACKS
			? { ok: false, reason: "ambiguous", message }
			: { ok: false, reason: "moved", message };
	if (response.status === 504) return { ok: false, reason: "timeout", message };
	if (response.status === 429)
		return { ok: false, reason: "too-fast", message };
	if (response.status === 400 || response.status === 413)
		return { ok: false, reason: "refused", message };
	if (response.status === 503)
		return { ok: false, reason: "unavailable", message };

	return { ok: false, reason: "failed", message };
}

const askWrite = (origin: string, request: TagWriteRequest) =>
	ask(origin, WRITE_TIMEOUT_MS, (api, init) =>
		api.POST("/tags", { ...init, body: request }),
	);
