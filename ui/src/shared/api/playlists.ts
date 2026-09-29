import {
	type Answer,
	askResult,
	BODYLESS_POST,
	type Call,
	PATIENT_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	type Result,
	type Schema,
} from "./client";

export type PlaylistAnnotation = Schema["PlaylistAnnotation"];
export type AutoPlaylistRequest = Schema["AutoPlaylistRequest"];
export type QueryPreview = Schema["QueryPreview"];
export type FillPlaylistRequest = Schema["FillPlaylistRequest"];
export type FillOwnPlaylistRequest = Schema["FillOwnPlaylistRequest"];
export type FillResult = Schema["FillResult"];
export type PlaylistPage = Schema["PlaylistPage"];
export type PlaylistChanges = Schema["PlaylistChanges"];
export type CreatePlaylistRequest = Schema["CreatePlaylistRequest"];
export type CopyPlaylistRowsRequest = Schema["CopyPlaylistRowsRequest"];
export type RemovePlaylistRowsRequest = Schema["RemovePlaylistRowsRequest"];
export type CopiedRows = Schema["CopiedRows"];
export type RemovedRows = Schema["RemovedRows"];

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
	{ signal }: { signal?: AbortSignal } = {},
) =>
	patient(
		origin,
		(api, init) =>
			api.GET("/playlists/{id}/items", {
				...init,
				params: {
					path: { id },
					query: { offset, count, columns: [...columns] },
				},
			}),
		signal,
	);

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
	{ signal }: { signal?: AbortSignal } = {},
): Promise<PlaylistChangesResult> {
	const read = await patient(
		origin,
		(api, init) =>
			api.GET("/playlists/{id}/items/changes", {
				...init,
				params: {
					path: { id },
					query: { structure, since, columns: [...columns] },
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

// A query that does not parse comes back as a 200 carrying `valid: false`, never as a 400. Debounce
// the caller: this runs on foobar2000's main thread.
export const previewQuery = (
	origin: string,
	query: string,
): Promise<Result<QueryPreview>> =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.POST("/autoplaylists/preview", { ...init, body: { query } }),
	);

export const createAutoPlaylist = (
	origin: string,
	create: AutoPlaylistRequest,
): Promise<Result<PlaylistAnnotation>> =>
	patient(origin, (api, init) =>
		api.POST("/autoplaylists", { ...init, body: create }),
	);
