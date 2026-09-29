import {
	ask,
	BODYLESS_POST,
	type Call,
	demand,
	orNull,
	PROBE_TIMEOUT_MS,
	reach,
	refusalOf,
	retryAfterMs,
	type Schema,
	TOO_FAST_WAIT_MS,
	UNREACHABLE,
	WRITE_TIMEOUT_MS,
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

const patient = <T>(origin: string, call: Call<T>, signal?: AbortSignal) =>
	ask(origin, WRITE_TIMEOUT_MS, call, signal);

const byId = (id: string) => ({ path: { id } });

export async function fetchPlaylistAnnotations(
	origin: string,
): Promise<PlaylistAnnotation[] | null> {
	const body = await orNull(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/playlists", init)),
	);
	return body?.playlists ?? null;
}

export const fillOwnPlaylist = (
	origin: string,
	role: OwnPlaylistRole,
	request: FillOwnPlaylistRequest,
) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/own/{role}/items", {
				...init,
				params: { path: { role } },
				body: request,
			}),
		),
	);

export const emptyOwnPlaylist = (origin: string, role: OwnPlaylistRole) =>
	demand(
		patient(origin, (api, init) =>
			api.DELETE("/playlists/own/{role}/items", {
				...init,
				params: { path: { role } },
			}),
		),
	);

// A 403 here is always `writePlaylists` off: this route addresses a playlist by the GUID its own
// annotation carries, so the other 403 this contract has, a target foo_jean did not create, cannot
// apply to it.
export const fillPlaylist = (
	origin: string,
	guid: string,
	request: FillPlaylistRequest,
) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}/items", {
				...init,
				params: byId(guid),
				body: request,
			}),
		),
	);

export const fetchPlaylistRows = (
	origin: string,
	id: string,
	offset: number,
	count: number,
	columns: readonly string[],
	{ signal }: { signal?: AbortSignal } = {},
) =>
	demand(
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
		),
	);

export type PlaylistChangesResult =
	| { ok: true; changes: PlaylistChanges }
	| { ok: false; reason: "moved" }
	| { ok: false; reason: "gone" };

export async function fetchPlaylistItemChanges(
	origin: string,
	id: string,
	structure: string,
	since: string,
	columns: readonly string[],
	{ signal }: { signal?: AbortSignal } = {},
): Promise<PlaylistChangesResult> {
	const answer = patient(
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
	const { response } = await answer;
	if (response.status === 409) return { ok: false, reason: "moved" };
	if (response.status === 410) return { ok: false, reason: "gone" };
	return { ok: true, changes: await demand(answer) };
}

export const createPlaylist = (
	origin: string,
	request: CreatePlaylistRequest,
) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists", { ...init, body: request }),
		),
	);

export const renamePlaylist = (origin: string, id: string, title: string) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}", {
				...init,
				params: byId(id),
				body: { title },
			}),
		),
	);

export const removePlaylist = (origin: string, id: string) =>
	demand(
		patient(origin, (api, init) =>
			api.DELETE("/playlists/{id}", { ...init, params: byId(id) }),
		),
	);

export const movePlaylist = (origin: string, id: string, index: number) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}/move", {
				...init,
				params: byId(id),
				body: { index },
			}),
		),
	);

export const playPlaylistItem = (origin: string, id: string, index: number) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}/items/{index}/play", {
				...init,
				headers: BODYLESS_POST,
				params: { path: { id, index } },
			}),
		),
	);

export const copyPlaylistRows = (
	origin: string,
	id: string,
	request: CopyPlaylistRowsRequest,
) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}/items/copy", {
				...init,
				params: byId(id),
				body: request,
			}),
		),
	);

export const removePlaylistRows = (
	origin: string,
	id: string,
	request: RemovePlaylistRowsRequest,
) =>
	demand(
		patient(origin, (api, init) =>
			api.POST("/playlists/{id}/items/remove", {
				...init,
				params: byId(id),
				body: request,
			}),
		),
	);

export type PreviewResult =
	| { ok: true; preview: QueryPreview }
	| { ok: false; retryInMs: number | null };

// A query that does not parse comes back as a 200 carrying `valid: false`, never as a 400. Debounce
// the caller: this runs on foobar2000's main thread.
export async function previewQuery(
	origin: string,
	query: string,
): Promise<PreviewResult> {
	const answer = await reach(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
			api.POST("/autoplaylists/preview", { ...init, body: { query } }),
		),
	);
	if (answer?.response.status === 429)
		return {
			ok: false,
			retryInMs: retryAfterMs(answer.response) ?? TOO_FAST_WAIT_MS,
		};
	return answer?.data
		? { ok: true, preview: answer.data }
		: { ok: false, retryInMs: null };
}

export type CreatedAutoPlaylist =
	| { ok: true; playlist: PlaylistAnnotation }
	| { ok: false; message: string };

export async function createAutoPlaylist(
	origin: string,
	request: AutoPlaylistRequest,
): Promise<CreatedAutoPlaylist> {
	const answer = await reach(
		patient(origin, (api, init) =>
			api.POST("/autoplaylists", { ...init, body: request }),
		),
	);
	if (!answer) return { ok: false, message: UNREACHABLE };
	if (answer.data) return { ok: true, playlist: answer.data };
	return {
		ok: false,
		message: refusalOf(answer.response, answer.error).message,
	};
}
