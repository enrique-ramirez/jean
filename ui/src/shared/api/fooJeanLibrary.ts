import { sleep } from "@/shared/lib/sleep";
import {
	type Answer,
	ask,
	type Call,
	reach,
	refusalOf as refusalIn,
	retryAfterMs,
} from "./client";
import type { components } from "./fooJeanSchema";
import { decodeJlib, type JlibDelta, type JlibSnapshot } from "./jlib";
import { fetchState } from "./state";

type LibraryBuild = components["schemas"]["LibraryBuild"];

export type LibraryFailureReason =
	| "unavailable"
	| "too-large"
	| "refused"
	| "unreachable"
	| "timeout"
	| "failed";

export interface LibraryFailure {
	ok: false;
	reason: LibraryFailureReason;
	/** What the component said, which the contract says is safe to show. Empty when it said nothing. */
	detail: string;
}

export type LibraryResult =
	| { ok: true; library: JlibSnapshot }
	| LibraryFailure;

export type LibraryChanges =
	| { ok: true; kind: "delta"; delta: JlibDelta }
	| { ok: true; kind: "restart" }
	| LibraryFailure;

const EXPORT_TIMEOUT_MS = 120_000;
const CHANGES_TIMEOUT_MS = 30_000;

const POLL_MIN_MS = 500;
const POLL_MAX_MS = 5_000;

const BUILD_STALL_MS = 60_000;

// foo_jean refills one rebuild every thirty seconds, so this is what a 429 with no `Retry-After`
// is worth waiting.
const BUSY_WAIT_MS = 30_000;
const BUSY_WAIT_MAX_MS = 60_000;

const failure = (
	reason: LibraryFailureReason,
	detail = "",
): LibraryFailure => ({ ok: false, reason, detail });

const retryAfterOf = (response: Response) =>
	Math.min(retryAfterMs(response) ?? BUSY_WAIT_MS, BUSY_WAIT_MAX_MS);

const sameColumns = (held: readonly string[], asked: readonly string[]) => {
	const built = new Set(held);
	return built.size === asked.length && asked.every((one) => built.has(one));
};

const sameBuild = (held: LibraryBuild | null, polled: LibraryBuild | null) => {
	if (held === polled) return true;
	if (!held || !polled) return false;
	return (
		held.phase === polled.phase &&
		held.formatted === polled.formatted &&
		held.total === polled.total
	);
};

type Attempt =
	| { kind: "done"; result: LibraryResult }
	| { kind: "building" }
	| { kind: "wait"; ms: number };

const REFUSALS: Partial<Record<number, LibraryFailureReason>> = {
	400: "refused",
	413: "too-large",
	503: "unavailable",
};

type Asked = { ok: true; answer: Answer<ArrayBuffer> } | LibraryFailure;

const askBytes = async (
	origin: string,
	timeoutMs: number,
	call: Call<Answer<ArrayBuffer>>,
	signal: AbortSignal | undefined,
): Promise<Asked> => {
	const answer = await reach(ask(origin, timeoutMs, call, signal), signal);
	return answer ? { ok: true, answer } : failure("unreachable");
};

const refusalOf = ({
	error,
	response,
}: Answer<ArrayBuffer>): LibraryFailure | null => {
	const refused = REFUSALS[response.status];
	if (refused) {
		const said = refusalIn(response, error);
		return failure(refused, said.error ? said.message : "");
	}
	return response.ok ? null : failure("failed", `HTTP ${response.status}`);
};

const decoded = <T>(
	read: () => T,
	signal: AbortSignal | undefined,
): { ok: true; value: T } | LibraryFailure => {
	try {
		return { ok: true, value: read() };
	} catch (error) {
		if (signal?.aborted) throw error;
		return failure("failed", error instanceof Error ? error.message : "");
	}
};

async function attemptExport(
	origin: string,
	columns: readonly string[],
	signal: AbortSignal | undefined,
): Promise<Attempt> {
	const asked = await askBytes(
		origin,
		EXPORT_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/export", {
				...init,
				params: { query: { columns: [...columns] } },
				parseAs: "arrayBuffer",
			}),
		signal,
	);
	if (!asked.ok) return { kind: "done", result: asked };

	const { response, data } = asked.answer;
	if (response.status === 202) return { kind: "building" };
	if (response.status === 429)
		return { kind: "wait", ms: retryAfterOf(response) };

	const refused = refusalOf(asked.answer);
	if (refused) return { kind: "done", result: refused };

	const bytes = data ?? new ArrayBuffer(0);
	const read = decoded(() => {
		const library = decodeJlib(bytes);
		if (library.kind !== "snapshot") throw new Error("not a snapshot");
		return library;
	}, signal);

	return {
		kind: "done",
		result: read.ok ? { ok: true, library: read.value } : read,
	};
}

export const TRANSIENT: ReadonlySet<LibraryFailureReason> = new Set([
	"unreachable",
	"timeout",
	"failed",
]);

const RESTARTS = new Set([409, 410]);

export async function fetchLibraryChanges(
	origin: string,
	since: number,
	signal?: AbortSignal,
): Promise<LibraryChanges> {
	const asked = await askBytes(
		origin,
		CHANGES_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/changes", {
				...init,
				params: { query: { since } },
				parseAs: "arrayBuffer",
			}),
		signal,
	);
	if (!asked.ok) return asked;

	const { response, data } = asked.answer;
	if (RESTARTS.has(response.status)) return { ok: true, kind: "restart" };

	const refused = refusalOf(asked.answer);
	if (refused) return refused;

	const bytes = data ?? new ArrayBuffer(0);
	const read = decoded(() => {
		const delta = decodeJlib(bytes);
		if (delta.kind !== "delta") throw new Error("not a delta");
		return delta;
	}, signal);

	return read.ok ? { ok: true, kind: "delta", delta: read.value } : read;
}

export async function fetchLibrary(
	origin: string,
	columns: readonly string[],
	signal?: AbortSignal,
	onProgress?: (build: LibraryBuild) => void,
): Promise<LibraryResult> {
	let pollMs = POLL_MIN_MS;
	let lastBuild: LibraryBuild | null = null;
	let stalledSince = Date.now();

	const stalled = () => Date.now() - stalledSince >= BUILD_STALL_MS;

	while (!stalled()) {
		const attempt = await attemptExport(origin, columns, signal);
		if (attempt.kind === "done") return attempt.result;

		if (attempt.kind === "wait") {
			await sleep(attempt.ms, signal);
			continue;
		}

		while (!stalled()) {
			await sleep(pollMs, signal);
			pollMs = Math.min(pollMs * 2, POLL_MAX_MS);

			const polled = await fetchState(origin, null, signal);
			if (!polled.ok && !TRANSIENT.has(polled.reason)) return polled;
			if (!polled.ok || polled.kind !== "state") continue;

			const build = polled.state.library.build;
			if (!sameBuild(lastBuild, build)) {
				lastBuild = build;
				stalledSince = Date.now();
				if (build) onProgress?.(build);
			}

			if (
				polled.state.library.ready &&
				sameColumns(polled.state.library.columns, columns)
			)
				break;
		}
	}

	return failure("timeout");
}
