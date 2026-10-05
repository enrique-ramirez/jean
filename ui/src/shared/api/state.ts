import { ask, reach, refusalOf, type Schema } from "./client";

export type StateDocument = Schema["State"];

const STATE_TIMEOUT_MS = 5_000;

export type StateFailureReason =
	| "unavailable"
	| "unreachable"
	| "failed"
	| "noSuchSession";

export interface StateFailure {
	ok: false;
	reason: StateFailureReason;
	detail: string;
}

export type StateResult =
	| { ok: true; kind: "unchanged" }
	| { ok: true; kind: "state"; state: StateDocument; tag: string | null }
	| StateFailure;

const STATE_REFUSALS: Partial<Record<number, StateFailureReason>> = {
	404: "noSuchSession",
	503: "unavailable",
};

export async function fetchState(
	origin: string,
	tag: string | null,
	signal?: AbortSignal,
): Promise<StateResult> {
	const answer = await reach(askState(origin, tag, signal), signal);
	if (!answer) return { ok: false, reason: "unreachable", detail: "" };
	const { data, error, response } = answer;

	if (response.status === 304) return { ok: true, kind: "unchanged" };

	const refusal = STATE_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		return { ok: false, reason: refusal, detail: said ? message : "" };
	}
	if (!data)
		return { ok: false, reason: "failed", detail: `HTTP ${response.status}` };

	return {
		ok: true,
		kind: "state",
		state: data,
		tag: response.headers.get("ETag"),
	};
}

const askState = (
	origin: string,
	tag: string | null,
	signal: AbortSignal | undefined,
) =>
	ask(
		origin,
		STATE_TIMEOUT_MS,
		(api, init) =>
			api.GET("/state", {
				...init,
				headers: tag ? { "If-None-Match": tag } : undefined,
				cache: "no-store",
			}),
		signal,
	);
