import {
	type Answer,
	ask,
	askResult,
	BODYLESS_POST,
	type Call,
	type Failure,
	PATIENT_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	READ_TIMEOUT_MS,
	type Result,
	reach,
	refusalOf,
	retryAfterMs,
	type Schema,
	unreachable,
} from "./client";
import { decodeSet, type LibraryRoles } from "./libraryQuestions";
import { type ReadFailure, readFailed } from "./readFailure";

export type PlaylistAnnotation = Schema["PlaylistAnnotation"];
export type AutoPlaylistRequest = Schema["AutoPlaylistRequest"];
export type QueryPreview = Schema["QueryPreview"];
export type FillPlaylistRequest = Schema["FillPlaylistRequest"];
export type FillOwnPlaylistRequest = Schema["FillOwnPlaylistRequest"];
export type Duplicates = Schema["Duplicates"];
export type PlaylistPage = Schema["PlaylistPage"];
export type PlaylistChanges = Schema["PlaylistChanges"];
export type PlaylistRuns = Schema["PlaylistRuns"];
export type CreatePlaylistRequest = Schema["CreatePlaylistRequest"];
export type CopyPlaylistRowsRequest = Schema["CopyPlaylistRowsRequest"];
export type RemovePlaylistRowsRequest = Schema["RemovePlaylistRowsRequest"];
export type MovePlaylistRowsRequest = Schema["MovePlaylistRowsRequest"];
export type SortPlaylistRowsRequest = Schema["SortPlaylistRowsRequest"];
export type MovedRows = Schema["MovedRows"];
export type SortedRows = Schema["SortedRows"];

export type OwnPlaylistRole = "scratch";

export const playlistPath = (id: string) =>
	`playlists/${encodeURIComponent(id)}`;

const patient = <T>(
	origin: string,
	call: Call<Answer<T>>,
	signal?: AbortSignal,
) => askResult(origin, PATIENT_TIMEOUT_MS, call, signal);

const byId = (id: string) => ({ path: { id } });

export async function fetchPlaylistAnnotations(
	origin: string,
): Promise<Result<PlaylistAnnotation[]>> {
	const read = await askResult(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.GET("/playlists", init),
	);
	return read.ok ? { ok: true, value: read.value.playlists } : read;
}

export const fillOwnPlaylist = (
	origin: string,
	role: OwnPlaylistRole,
	fill: FillOwnPlaylistRequest,
) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/own/{role}/items", {
			...init,
			params: { path: { role } },
			body: fill,
		}),
	);

export const emptyOwnPlaylist = (origin: string, role: OwnPlaylistRole) =>
	patient(origin, (api, init) =>
		api.DELETE("/playlists/own/{role}/items", {
			...init,
			params: { path: { role } },
		}),
	);

// A 403 here is always `writePlaylists` off: this route addresses a playlist by the GUID its own
// annotation carries, so the other 403 this contract has, a target foo_jean did not create, cannot
// apply to it.
export const fillPlaylist = (
	origin: string,
	guid: string,
	fill: FillPlaylistRequest,
) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items", {
			...init,
			params: byId(guid),
			body: fill,
		}),
	);

export const fetchPlaylistRows = (
	origin: string,
	id: string,
	offset: number,
	count: number,
	columns: readonly string[],
	{ signal, roles }: { signal?: AbortSignal; roles?: LibraryRoles } = {},
) =>
	patient(
		origin,
		(api, init) =>
			api.GET("/playlists/{id}/items", {
				...init,
				params: {
					path: { id },
					query: { ...roles, offset, count, columns: [...columns] },
				},
			}),
		signal,
	);

export type PlaylistRunsResult =
	| { ok: true; unchanged: true }
	| { ok: true; unchanged: false; runs: PlaylistRuns; etag: string | null }
	| (ReadFailure & { structureMoved: boolean });

const RUNS_REFUSALS: Partial<Record<number, ReadFailure["reason"]>> = {
	202: "notReady",
	400: "refused",
	409: "undeclared",
	429: "tooFast",
	503: "unavailable",
};

const runsFailed = (
	failure: ReadFailure,
	structureMoved = false,
): PlaylistRunsResult => ({ ...failure, structureMoved });

export async function readPlaylistRuns(
	origin: string,
	id: string,
	structure: string,
	roles: LibraryRoles,
	etag?: string,
	signal?: AbortSignal,
): Promise<PlaylistRunsResult> {
	const answer = await reach(
		// foo_jean copies the playlist's handles on foobar2000's main thread, as a page read does.
		ask(
			origin,
			PATIENT_TIMEOUT_MS,
			(api, init) =>
				api.GET("/playlists/{id}/runs", {
					...init,
					params: { path: { id }, query: { ...roles, structure } },
					headers: etag ? { "If-None-Match": etag } : undefined,
					cache: "no-store",
				}),
			signal,
		),
		signal,
	);
	if (!answer) return runsFailed(readFailed("unreachable"));
	const { data, error, response } = answer;

	if (response.status === 304) return { ok: true, unchanged: true };

	const refusal = RUNS_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		const isMoved = response.status === 409 && said === ROWS_MOVED_ERROR;
		return runsFailed(
			readFailed(
				isMoved ? "refused" : refusal,
				said ? message : "",
				refusal === "tooFast" ? retryAfterMs(response) : null,
			),
			isMoved,
		);
	}
	if (!data) return runsFailed(readFailed("failed", `HTTP ${response.status}`));

	return {
		ok: true,
		unchanged: false,
		runs: data as PlaylistRuns,
		etag: response.headers.get("ETag"),
	};
}

export type PlaylistFind = Omit<Schema["PlaylistFind"], "matched"> & {
	matched: Int32Array;
};

export type FindRoles = Pick<
	LibraryRoles,
	"title" | "artist" | "albumArtist" | "album" | "artistSort"
>;

export async function fetchPlaylistFind(
	origin: string,
	id: string,
	ask: {
		query: string;
		structure: string;
		roles: FindRoles;
		length: number;
	},
	signal?: AbortSignal,
): Promise<Result<PlaylistFind> | { ok: false; reason: "notReady" }> {
	const read = await askResult<Schema["PlaylistFind"] | Schema["Library"]>(
		origin,
		READ_TIMEOUT_MS,
		(api, init) =>
			api.GET("/playlists/{id}/find", {
				...init,
				cache: "no-store",
				params: {
					path: { id },
					query: {
						query: ask.query,
						structure: ask.structure,
						title: ask.roles.title,
						artist: ask.roles.artist,
						albumArtist: ask.roles.albumArtist,
						album: ask.roles.album,
						artistSort: ask.roles.artistSort,
					},
				},
			}),
		signal,
	);
	if (!read.ok) return read;

	const { value } = read;
	if (!("matched" in value)) return { ok: false, reason: "notReady" };

	const matched = decodeSet(value.matched, ask.length);
	return matched
		? { ok: true, value: { ...value, matched } }
		: { ok: false, reason: "unreachable", message: unreachable() };
}

export type PlaylistChangesResult =
	| Result<PlaylistChanges>
	| { ok: false; reason: "moved" }
	| { ok: false; reason: "gone" };

const CHANGES_RESTART: Partial<Record<number, "moved" | "gone">> = {
	409: "moved",
	410: "gone",
};

export async function fetchPlaylistItemChanges(
	origin: string,
	id: string,
	structure: string,
	since: string,
	columns: readonly string[],
	{ signal, roles }: { signal?: AbortSignal; roles?: LibraryRoles } = {},
): Promise<PlaylistChangesResult> {
	const read = await patient(
		origin,
		(api, init) =>
			api.GET("/playlists/{id}/items/changes", {
				...init,
				params: {
					path: { id },
					query: { ...roles, structure, since, columns: [...columns] },
				},
			}),
		signal,
	);
	const restart = restartOf(read);
	return restart ? { ok: false, reason: restart } : read;
}

const restartOf = (read: Result<unknown>) =>
	!read.ok && read.reason === "refused"
		? (CHANGES_RESTART[read.status] ?? null)
		: null;

export const createPlaylist = (origin: string, create: CreatePlaylistRequest) =>
	patient(origin, (api, init) =>
		api.POST("/playlists", { ...init, body: create }),
	);

export const renamePlaylist = (origin: string, id: string, title: string) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}", {
			...init,
			params: byId(id),
			body: { title },
		}),
	);

export const removePlaylist = (origin: string, id: string) =>
	patient(origin, (api, init) =>
		api.DELETE("/playlists/{id}", { ...init, params: byId(id) }),
	);

export const movePlaylist = (origin: string, id: string, index: number) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/move", {
			...init,
			params: byId(id),
			body: { index },
		}),
	);

export const playPlaylistItem = (origin: string, id: string, index: number) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items/{index}/play", {
			...init,
			headers: BODYLESS_POST,
			params: { path: { id, index } },
		}),
	);

export const copyPlaylistRows = (
	origin: string,
	id: string,
	copy: CopyPlaylistRowsRequest,
) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items/copy", {
			...init,
			params: byId(id),
			body: copy,
		}),
	);

export const removePlaylistRows = (
	origin: string,
	id: string,
	removal: RemovePlaylistRowsRequest,
) =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items/remove", {
			...init,
			params: byId(id),
			body: removal,
		}),
	);

export const movePlaylistRows = (
	origin: string,
	id: string,
	move: MovePlaylistRowsRequest,
): Promise<Result<MovedRows>> =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items/move", {
			...init,
			params: byId(id),
			body: move,
		}),
	);

export const sortPlaylistRows = (
	origin: string,
	id: string,
	sort: SortPlaylistRowsRequest,
): Promise<Result<SortedRows>> =>
	patient(origin, (api, init) =>
		api.POST("/playlists/{id}/items/sort", {
			...init,
			params: byId(id),
			body: sort,
		}),
	);

// Word for word what `foo_jean` answers a row edit with `409`, by `error`: the playlist's
// `structure` moved since the rows were read, or another component has locked it against the edit.
const ROWS_MOVED_ERROR =
	"the playlist's rows were added, removed or reordered; read them again";
const ROWS_LOCKED_ERROR =
	"another component has locked that playlist against that edit";

export function rowEditRefusal(failure: Failure): "moved" | "locked" | "other" {
	if (failure.reason !== "refused" || failure.status !== 409) return "other";
	if (failure.error === ROWS_MOVED_ERROR) return "moved";
	if (failure.error === ROWS_LOCKED_ERROR) return "locked";
	return "other";
}

// A query that does not parse comes back as a 200 carrying `valid: false`, never as a 400. Debounce
// the caller: this runs on foobar2000's main thread, which answers `504` only after the patient
// timeout, so a broad query over a large library is waited for rather than dropped.
export const previewQuery = (
	origin: string,
	query: string,
	{ rows }: { rows?: boolean } = {},
): Promise<Result<QueryPreview>> =>
	patient(origin, (api, init) =>
		api.POST("/autoplaylists/preview", {
			...init,
			body: rows ? { query, rows } : { query },
		}),
	);

export const createAutoPlaylist = (
	origin: string,
	create: AutoPlaylistRequest,
): Promise<Result<PlaylistAnnotation>> =>
	patient(origin, (api, init) =>
		api.POST("/autoplaylists", { ...init, body: create }),
	);

export const updateAutoPlaylist = (
	origin: string,
	id: string,
	update: AutoPlaylistRequest,
): Promise<Result<PlaylistAnnotation>> =>
	patient(origin, (api, init) =>
		api.POST("/autoplaylists/{id}", {
			...init,
			params: byId(id),
			body: update,
		}),
	);
