import { sleep } from "@/shared/lib/sleep";
import { fetchState, retryAfterMs, withTimeout } from "./fooJean";
import type { components } from "./fooJeanSchema";
import { decodeJlib, type JlibDelta, type JlibSnapshot } from "./jlib";

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

const detailOf = async (response: Response) => {
	const body = (await response.json().catch(() => null)) as {
		error?: string;
		detail?: string;
	} | null;
	if (!body?.error) return "";
	return body.detail ? `${body.error}: ${body.detail}` : body.error;
};

const retryAfterOf = (response: Response) =>
	Math.min(retryAfterMs(response) ?? BUSY_WAIT_MS, BUSY_WAIT_MAX_MS);

const exportUrl = (origin: string, columns: readonly string[]) => {
	const asked = new URLSearchParams();
	for (const column of columns) asked.append("columns", column);
	return `${origin}/api/library/export?${asked}`;
};

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

type Asked = { ok: true; response: Response } | LibraryFailure;

const ask = async (
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<Asked> => {
	try {
		return {
			ok: true,
			response: await withTimeout(
				timeoutMs,
				(inner) => fetch(url, { signal: inner }),
				signal,
			),
		};
	} catch (error) {
		if (signal?.aborted) throw error;
		return failure("unreachable");
	}
};

const refusalOf = async (
	response: Response,
): Promise<LibraryFailure | null> => {
	const refused = REFUSALS[response.status];
	if (refused) return failure(refused, await detailOf(response));
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
	const asked = await ask(
		exportUrl(origin, columns),
		EXPORT_TIMEOUT_MS,
		signal,
	);
	if (!asked.ok) return { kind: "done", result: asked };

	const { response } = asked;
	if (response.status === 202) return { kind: "building" };
	if (response.status === 429)
		return { kind: "wait", ms: retryAfterOf(response) };

	const refused = await refusalOf(response);
	if (refused) return { kind: "done", result: refused };

	const bytes = await response.arrayBuffer();
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
	const asked = await ask(
		`${origin}/api/library/changes?since=${since}`,
		CHANGES_TIMEOUT_MS,
		signal,
	);
	if (!asked.ok) return asked;

	const { response } = asked;
	if (RESTARTS.has(response.status)) return { ok: true, kind: "restart" };

	const refused = await refusalOf(response);
	if (refused) return refused;

	const bytes = await response.arrayBuffer();
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
