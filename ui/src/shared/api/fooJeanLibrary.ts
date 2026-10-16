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
import {
	decodeJlib,
	type JlibDelta,
	type JlibSnapshot,
	type JlibSplice,
} from "./jlib";
import { fetchState } from "./state";

type LibraryBuild = components["schemas"]["LibraryBuild"];
type LibraryState = components["schemas"]["Library"];

export type LibraryFailureReason =
	| "unavailable"
	| "too-large"
	| "refused"
	| "unreachable"
	| "timeout"
	| "halted"
	| "failed";

export interface LibraryFailure {
	ok: false;
	reason: LibraryFailureReason;
	/** What the component said, which the contract says is safe to show. Empty when it said nothing. */
	detail: string;
}

export type LibraryResult =
	| { ok: true; library: JlibSnapshot; bytes: ArrayBuffer }
	| LibraryFailure;

export type LibraryChanges =
	| { ok: true; kind: "delta"; delta: JlibDelta; bytes: ArrayBuffer }
	| { ok: true; kind: "splice"; splice: JlibSplice; bytes: ArrayBuffer }
	// A `409`: the pair names no position this run of the component held.
	| { ok: true; kind: "another-run" }
	// A `410`: the changes are no longer kept, or are too large to send.
	| { ok: true; kind: "gone" }
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

export const sameColumns = (
	held: readonly string[],
	asked: readonly string[],
) => {
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

const haltedIn = (body: ArrayBuffer | undefined) => {
	try {
		const library: LibraryState = JSON.parse(new TextDecoder().decode(body));
		return library.halted === true;
	} catch {
		return false;
	}
};

export interface LibraryPart {
	only: readonly string[];
	hasSpine: boolean;
}

async function attemptExport(
	origin: string,
	columns: readonly string[],
	part: LibraryPart | undefined,
	signal: AbortSignal | undefined,
): Promise<Attempt> {
	const asked = await askBytes(
		origin,
		EXPORT_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/export", {
				...init,
				params: {
					query: {
						columns: [...columns],
						...(part && { only: [...part.only] }),
						...(part && !part.hasSpine && { spine: false }),
					},
				},
				parseAs: "arrayBuffer",
			}),
		signal,
	);
	if (!asked.ok) return { kind: "done", result: asked };

	const { response, data } = asked.answer;
	if (response.status === 202)
		return haltedIn(data)
			? { kind: "done", result: failure("halted") }
			: { kind: "building" };
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
		result: read.ok ? { ok: true, library: read.value, bytes } : read,
	};
}

export const TRANSIENT: ReadonlySet<LibraryFailureReason> = new Set([
	"unreachable",
	"timeout",
	"failed",
]);

export async function fetchLibraryChanges(
	origin: string,
	since: number,
	structure: number,
	signal?: AbortSignal,
): Promise<LibraryChanges> {
	const asked = await askBytes(
		origin,
		CHANGES_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/changes", {
				...init,
				params: { query: { since, structure } },
				parseAs: "arrayBuffer",
			}),
		signal,
	);
	if (!asked.ok) return asked;

	const { response, data } = asked.answer;
	if (response.status === 409) return { ok: true, kind: "another-run" };
	if (response.status === 410) return { ok: true, kind: "gone" };

	const refused = refusalOf(asked.answer);
	if (refused) return refused;

	const bytes = data ?? new ArrayBuffer(0);
	const read = decoded(() => {
		const changes = decodeJlib(bytes);
		if (changes.kind === "snapshot") throw new Error("not a delta or a splice");
		return changes;
	}, signal);

	if (!read.ok) return read;
	return read.value.kind === "delta"
		? { ok: true, kind: "delta", delta: read.value, bytes }
		: { ok: true, kind: "splice", splice: read.value, bytes };
}

interface BuildWait {
	pollMs: number;
	lastBuild: LibraryBuild | null;
	stalledSince: number;
}

const newBuildWait = (): BuildWait => ({
	pollMs: POLL_MIN_MS,
	lastBuild: null,
	stalledSince: Date.now(),
});

const isStalled = (wait: BuildWait) =>
	Date.now() - wait.stalledSince >= BUILD_STALL_MS;

async function untilBuilt(
	origin: string,
	columns: readonly string[],
	wait: BuildWait,
	signal: AbortSignal | undefined,
	onProgress: ((build: LibraryBuild) => void) | undefined,
): Promise<LibraryFailure | null> {
	while (!isStalled(wait)) {
		await sleep(wait.pollMs, signal);
		wait.pollMs = Math.min(wait.pollMs * 2, POLL_MAX_MS);

		const polled = await fetchState(origin, null, signal);
		if (!polled.ok) {
			// `foo_jean` answers `404` here only for a session named and gone, and its library is the
			// player's whichever session is named.
			if (polled.reason !== "noSuchSession" && !TRANSIENT.has(polled.reason))
				return failure(polled.reason, polled.detail);
			continue;
		}
		if (polled.kind !== "state") continue;
		if (polled.state.library.halted) return failure("halted");

		const build = polled.state.library.build;
		if (!sameBuild(wait.lastBuild, build)) {
			wait.lastBuild = build;
			wait.stalledSince = Date.now();
			if (build) onProgress?.(build);
		}

		if (
			polled.state.library.ready &&
			sameColumns(polled.state.library.columns, columns)
		)
			return null;
	}

	return failure("timeout");
}

export async function fetchLibrary(
	origin: string,
	columns: readonly string[],
	signal?: AbortSignal,
	onProgress?: (build: LibraryBuild) => void,
	part?: LibraryPart,
): Promise<LibraryResult> {
	const wait = newBuildWait();

	while (!isStalled(wait)) {
		const attempt = await attemptExport(origin, columns, part, signal);
		if (attempt.kind === "done") return attempt.result;

		if (attempt.kind === "wait") {
			await sleep(attempt.ms, signal);
			continue;
		}

		const failed = await untilBuilt(origin, columns, wait, signal, onProgress);
		if (failed) return failed;
	}

	return failure("timeout");
}

// A component that answers the export with a body had the columns built already; the body is not read.
export async function declareLibrary(
	origin: string,
	columns: readonly string[],
	signal?: AbortSignal,
	onProgress?: (build: LibraryBuild) => void,
): Promise<LibraryFailure | null> {
	const wait = newBuildWait();

	while (!isStalled(wait)) {
		const attempt = await attemptExport(origin, columns, undefined, signal);
		if (attempt.kind === "done")
			return attempt.result.ok ? null : attempt.result;

		if (attempt.kind === "wait") {
			await sleep(attempt.ms, signal);
			continue;
		}

		return untilBuilt(origin, columns, wait, signal, onProgress);
	}

	return failure("timeout");
}
