import {
	ask,
	READ_TIMEOUT_MS,
	reach,
	refusalOf,
	retryAfterMs,
	type Schema,
} from "./client";
import type { Run } from "./fillEncoding";
import { decodeRows, type JlibColumn, type JlibSpine } from "./jlib";
import type { LibraryRoles } from "./libraryQuestions";
import {
	type ReadFailure,
	type ReadFailureReason,
	readFailed,
} from "./readFailure";

type Library = Schema["Library"];
type LibraryRuns = Schema["LibraryRuns"];

export type RowSet = { runs: Run[] } | { ordinals: number[] };

export interface RowsAsk {
	columns: readonly string[];
	structure: number;
	set: RowSet;
}

export interface RowsWindow {
	structure: number;
	revision: number;
	trackCount: number;
	rows: number;
	ordinals: Int32Array;
	columns: ReadonlyMap<string, JlibColumn>;
	spine: JlibSpine;
}

export interface RowsFailure extends ReadFailure {
	structureMoved: boolean;
	building: Library | null;
}

export type RowsResult = { ok: true; window: RowsWindow } | RowsFailure;

type RunsResult =
	| { ok: true; unchanged: true }
	| { ok: true; unchanged: false; runs: LibraryRuns; etag: string | null }
	| ReadFailure;

const ROWS_REFUSALS: Partial<Record<number, ReadFailureReason>> = {
	400: "refused",
	409: "refused",
	429: "tooFast",
	503: "unavailable",
};

const RUNS_REFUSALS: Partial<Record<number, ReadFailureReason>> = {
	202: "notReady",
	400: "refused",
	409: "undeclared",
	429: "tooFast",
	503: "unavailable",
};

const rowsFailed = (
	failure: ReadFailure,
	extra: { structureMoved?: boolean; building?: Library | null } = {},
): RowsFailure => ({
	...failure,
	structureMoved: extra.structureMoved ?? false,
	building: extra.building ?? null,
});

const ordinalsOf = (set: RowSet) => {
	if ("ordinals" in set) return Int32Array.from(set.ordinals);
	const ordinals: number[] = [];
	for (const [start, length] of set.runs)
		for (let step = 0; step < length; step += 1) ordinals.push(start + step);
	return Int32Array.from(ordinals);
};

const buildingIn = (body: ArrayBuffer | undefined): Library | null => {
	try {
		return JSON.parse(new TextDecoder().decode(body)) as Library;
	} catch {
		return null;
	}
};

export async function readRows(
	origin: string,
	{ columns, structure, set }: RowsAsk,
	signal?: AbortSignal,
): Promise<RowsResult> {
	const answer = await reach(
		ask(
			origin,
			READ_TIMEOUT_MS,
			(api, init) =>
				api.POST("/library/rows", {
					...init,
					body: { columns: [...columns], structure: String(structure), ...set },
					parseAs: "arrayBuffer",
					cache: "no-store",
				}),
			signal,
		),
		signal,
	);
	if (!answer) return rowsFailed(readFailed("unreachable"));
	const { data, error, response } = answer;

	if (response.status === 202)
		return rowsFailed(readFailed("notReady"), { building: buildingIn(data) });

	const refusal = ROWS_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		return rowsFailed(
			readFailed(
				refusal,
				said ? message : "",
				refusal === "tooFast" ? retryAfterMs(response) : null,
			),
			{ structureMoved: response.status === 409 },
		);
	}
	if (!(response.status === 200 && data))
		return rowsFailed(readFailed("failed", `HTTP ${response.status}`));

	try {
		const rows = decodeRows(data);
		return {
			ok: true,
			window: {
				structure: rows.structure,
				revision: rows.revision,
				trackCount: rows.trackCount,
				rows: rows.rows,
				ordinals: ordinalsOf(set),
				columns: rows.columns,
				spine: rows.spine,
			},
		};
	} catch (thrown) {
		if (signal?.aborted) throw thrown;
		return rowsFailed(
			readFailed("failed", thrown instanceof Error ? thrown.message : ""),
		);
	}
}

export async function readRuns(
	origin: string,
	roles: LibraryRoles,
	etag?: string,
	signal?: AbortSignal,
): Promise<RunsResult> {
	const answer = await reach(
		ask(
			origin,
			READ_TIMEOUT_MS,
			(api, init) =>
				api.GET("/library/runs", {
					...init,
					params: { query: roles },
					headers: etag ? { "If-None-Match": etag } : undefined,
					cache: "no-store",
				}),
			signal,
		),
		signal,
	);
	if (!answer) return readFailed("unreachable");
	const { data, error, response } = answer;

	if (response.status === 304) return { ok: true, unchanged: true };

	const refusal = RUNS_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		return readFailed(
			refusal,
			said ? message : "",
			refusal === "tooFast" ? retryAfterMs(response) : null,
		);
	}
	if (!data) return readFailed("failed", `HTTP ${response.status}`);

	return {
		ok: true,
		unchanged: false,
		runs: data as LibraryRuns,
		etag: response.headers.get("ETag"),
	};
}
