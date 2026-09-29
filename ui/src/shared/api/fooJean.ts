import type { components } from "./fooJeanSchema";
import type { TrackAddress } from "./types";

type Schema = components["schemas"];

export type FooJeanCapabilities = Schema["Capabilities"];
export type TagWriteRequest = Schema["TagWriteRequest"];
export type TagWritten = Schema["TagWritten"];
export type StreamTicket = Schema["StreamTicket"];
export type StreamTimeline = Schema["StreamTimeline"];
export type StreamMark = StreamTimeline["marks"][number];
export type StreamListeners = Schema["StreamListeners"];
export type StreamListener = StreamListeners["devices"][number];
export type DeviceIdentity = Schema["DeviceIdentity"];
export type PlaylistAnnotation = Schema["PlaylistAnnotation"];
export type AutoPlaylistRequest = Schema["AutoPlaylistRequest"];
export type QueryPreview = Schema["QueryPreview"];
export type FillPlaylistRequest = Schema["FillPlaylistRequest"];
export type FillOwnPlaylistRequest = Schema["FillOwnPlaylistRequest"];
export type FillResult = Schema["FillResult"];
export type LibraryTrack = Schema["LibraryTrack"];
export type PlayingTrackColumns = Schema["PlayingTrackColumns"];
export type PlaylistPage = Schema["PlaylistPage"];
export type PlaylistChanges = Schema["PlaylistChanges"];
export type CreatePlaylistRequest = Schema["CreatePlaylistRequest"];
export type CopyPlaylistRowsRequest = Schema["CopyPlaylistRowsRequest"];
export type RemovePlaylistRowsRequest = Schema["RemovePlaylistRowsRequest"];
export type CopiedRows = Schema["CopiedRows"];
export type RemovedRows = Schema["RemovedRows"];

export type OwnPlaylistRole = "scratch";

const PROBE_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 35_000;
const STATE_TIMEOUT_MS = 5_000;

export const withTimeout = async <T>(
	ms: number,
	run: (signal: AbortSignal) => Promise<T>,
	outer?: AbortSignal,
): Promise<T> => {
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), ms);
	try {
		return await run(
			outer ? AbortSignal.any([outer, deadline.signal]) : deadline.signal,
		);
	} finally {
		clearTimeout(timer);
	}
};

const JSON_BODY = { "Content-Type": "application/json" };

const UNREACHABLE = "Could not reach foo_jean.";

const postJson = async (
	url: string,
	body: unknown,
	{ timeoutMs = PROBE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Response | null> => {
	try {
		return await withTimeout(timeoutMs, (signal) =>
			fetch(url, {
				method: "POST",
				headers: JSON_BODY,
				body: JSON.stringify(body),
				signal,
			}),
		);
	} catch {
		return null;
	}
};

const fetchJson = async <T>(
	origin: string,
	path: string,
	init?: RequestInit,
): Promise<T | null> => {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}${path}`, { ...init, signal });
			if (!response.ok) return null;
			return (await response.json()) as T;
		});
	} catch {
		return null;
	}
};

export type CapabilitiesResult =
	| { ok: true; capabilities: FooJeanCapabilities }
	| { ok: false; reason: "unreachable" };

export async function fetchCapabilities(
	origin: string,
): Promise<CapabilitiesResult> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/capabilities`, { signal });
			if (!response.ok) return { ok: false, reason: "unreachable" } as const;
			return {
				ok: true,
				capabilities: (await response.json()) as FooJeanCapabilities,
			} as const;
		});
	} catch {
		return { ok: false, reason: "unreachable" };
	}
}

export type StateDocument = Schema["State"];

export type StateFailureReason = "unavailable" | "unreachable" | "failed";

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
	503: "unavailable",
};

export async function fetchState(
	origin: string,
	tag: string | null,
	signal?: AbortSignal,
): Promise<StateResult> {
	let response: Response;
	try {
		response = await withTimeout(
			STATE_TIMEOUT_MS,
			(inner) =>
				fetch(`${origin}/api/state`, {
					headers: tag ? { "If-None-Match": tag } : undefined,
					cache: "no-store",
					signal: inner,
				}),
			signal,
		);
	} catch (error) {
		if (signal?.aborted) throw error;
		return { ok: false, reason: "unreachable", detail: "" };
	}

	if (response.status === 304) return { ok: true, kind: "unchanged" };

	const refusal = STATE_REFUSALS[response.status];
	if (refusal) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
			detail?: string;
		} | null;
		const detail = body?.error
			? body.detail
				? `${body.error}: ${body.detail}`
				: body.error
			: "";
		return { ok: false, reason: refusal, detail };
	}
	if (!response.ok)
		return { ok: false, reason: "failed", detail: `HTTP ${response.status}` };

	return {
		ok: true,
		kind: "state",
		state: (await response.json()) as StateDocument,
		tag: response.headers.get("ETag"),
	};
}

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

export type SwitchRefusal = "playbackDisabled" | "writesDisabled";

// Word for word what the component's `core/playlists.cpp` answers for each switch.
const REFUSAL_MESSAGE = {
	playbackDisabled:
		"this install has playback control turned off; turn on controlPlayback in config.json to allow it",
	writesDisabled:
		"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them",
} satisfies Record<SwitchRefusal, Schema["PlaylistFailed"]["error"]>;

const switchRefusalIn = (message: string): SwitchRefusal | null =>
	(Object.keys(REFUSAL_MESSAGE) as SwitchRefusal[]).find((refusal) =>
		message.includes(REFUSAL_MESSAGE[refusal]),
	) ?? null;

// Every write a switch can refuse throws through `requestThrowing`, whose message carries the body's
// own `error`, so a caller reads the refusal off the thrown error rather than parsing a response again.
export function switchRefusalOf(error: unknown): SwitchRefusal | null {
	if (!(error instanceof Error) || error.cause !== 403) return null;
	return switchRefusalIn(error.message);
}

const messageOf = async (response: Response, fallback: string) => {
	const body = (await response.json().catch(() => null)) as {
		error?: string;
		detail?: string;
		field?: string;
	} | null;
	if (!body?.error) return { message: fallback, error: "", field: null };
	return {
		message: body.detail ? `${body.error}: ${body.detail}` : body.error,
		error: body.error,
		field: body.field ?? null,
	};
};

// The only 409 a write may answer by trying again. The other two, a playlist read at an older
// structure and a library rebuilt under an ordinal, are stale addresses and nothing to send a
// second write to.
const NAMES_TWO_TRACKS =
	"the media library holds more than one track at that address" satisfies Schema["TagFailed"]["error"];

export async function writeTags(
	origin: string,
	request: TagWriteRequest,
): Promise<WriteResult> {
	const response = await postJson(`${origin}/api/tags`, request, {
		timeoutMs: WRITE_TIMEOUT_MS,
	});
	if (!response)
		return { ok: false, reason: "unreachable", message: UNREACHABLE };

	if (response.ok)
		return { ok: true, written: (await response.json()) as TagWritten };

	const { message, error, field } = await messageOf(
		response,
		`HTTP ${response.status}`,
	);

	if (response.status === 403)
		return { ok: false, reason: "not-allowed", field, message };
	if (response.status === 404)
		return { ok: false, reason: "unknown-track", message };
	if (response.status === 409)
		return error === NAMES_TWO_TRACKS
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

export type FooJeanState =
	| { kind: "unreachable" }
	| { kind: "ready"; capabilities: FooJeanCapabilities };

export interface FooJeanDiscovery {
	state: FooJeanState;
	origin: string | null;
	retryable: boolean;
}

export const libraryOrigin = (discovery: FooJeanDiscovery) =>
	discovery.state.kind === "ready" &&
	discovery.state.capabilities.canReadLibrary
		? discovery.origin
		: null;

// Absent or unreached reads as writable: the field is read to take an affordance away and never to
// hand it out.
export const permitsPlaylistWrites = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canWritePlaylists !== false;

// Absent or unreached reads as permitted, for the same reason `permitsPlaylistWrites` does.
export const permitsPlaybackControl = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canControlPlayback !== false;

// Absent or unreached reads as permitted, for the same reason `permitsPlaybackControl` does.
export const permitsOutputChange = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canChangeOutput !== false;

export const isFooJeanReady = (discovery: FooJeanDiscovery) =>
	discovery.state.kind === "ready";

// A caller already inside a guarded control has `origin` as a nullable string, from
// `FooJeanDiscovery` or threaded down separately; this is the one throw every shape shares.
export function requireFooJean(origin: string | null): string {
	if (!origin) throw new Error("foo_jean is not reachable");
	return origin;
}

export async function discoverFooJean(): Promise<FooJeanDiscovery> {
	const origin = window.location.origin;

	const capabilities = await fetchCapabilities(origin);
	if (!capabilities.ok)
		return { state: { kind: "unreachable" }, origin, retryable: true };

	return {
		state: { kind: "ready", capabilities: capabilities.capabilities },
		origin,
		retryable: false,
	};
}

export type TicketFailure =
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type TicketResult = { ok: true; ticket: StreamTicket } | TicketFailure;

const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

export async function issueStreamTicket(
	origin: string,
	device: DeviceIdentity,
): Promise<TicketResult> {
	const response = await postJson(`${origin}/api/stream/ticket`, device);
	if (!response)
		return { ok: false, reason: "unreachable", message: UNREACHABLE };

	if (response.ok)
		return { ok: true, ticket: (await response.json()) as StreamTicket };

	const { message } = await messageOf(response, `HTTP ${response.status}`);
	if (response.status === 503)
		return {
			ok: false,
			reason: isBusy(message) ? "busy" : "unavailable",
			message,
		};
	return { ok: false, reason: "unreachable", message };
}

const playlistPath = (id: string) => `playlists/${encodeURIComponent(id)}`;

export const libraryArtworkUrl = (origin: string | null, path: string) =>
	origin && `${origin}/api/artwork?track=${encodeURIComponent(path)}`;

export const playingArtworkUrl = (origin: string | null) =>
	origin && `${origin}/api/artwork/playing`;

export const playlistRowArtworkUrl = (
	origin: string | null,
	playlistId: string,
	index: number,
) => origin && `${origin}/api/artwork/${playlistPath(playlistId)}/${index}`;

export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

export const fetchStreamTimeline = (origin: string) =>
	fetchJson<StreamTimeline>(origin, "/api/stream/timeline");

export const fetchStreamListeners = (origin: string) =>
	fetchJson<StreamListeners>(origin, "/api/stream/listeners");

export async function fetchPlaylistAnnotations(
	origin: string,
): Promise<PlaylistAnnotation[] | null> {
	const body = await fetchJson<{ playlists?: PlaylistAnnotation[] }>(
		origin,
		"/api/playlists",
	);
	return body?.playlists ?? null;
}

// Seconds, per RFC 9110. The date form is legal and foo_jean does not send it.
export const retryAfterMs = (response: Response) => {
	const seconds = Number(response.headers.get("Retry-After"));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

// foo_jean always sends `Retry-After: 1` when it refuses a preview or a one-track read; this is
// the fallback for the header ever being missing.
const TOO_FAST_WAIT_MS = 1_000;
const TOO_FAST_RETRIES = 3;

export class TooFast extends Error {
	readonly retryInMs: number;

	constructor(retryInMs: number) {
		super("foo_jean refused a request as too fast");
		this.retryInMs = retryInMs;
	}
}

const tooFast = (response: Response) =>
	new TooFast(retryAfterMs(response) ?? TOO_FAST_WAIT_MS);

export const retryWhenTooFast = ({ otherFailures = 0 } = {}) => ({
	retry: (count: number, error: Error) =>
		count < (error instanceof TooFast ? TOO_FAST_RETRIES : otherFailures),
	retryDelay: (_: number, error: Error) =>
		error instanceof TooFast ? error.retryInMs : 0,
});

export type PreviewResult =
	| { ok: true; preview: QueryPreview }
	| { ok: false; retryInMs: number | null };

// A query that does not parse comes back as a 200 carrying `valid: false`, never as a 400. Debounce
// the caller: this runs on foobar2000's main thread.
export async function previewQuery(
	origin: string,
	query: string,
): Promise<PreviewResult> {
	const response = await postJson(`${origin}/api/autoplaylists/preview`, {
		query,
	});
	if (response?.status === 429)
		return {
			ok: false,
			retryInMs: retryAfterMs(response) ?? TOO_FAST_WAIT_MS,
		};
	const preview = response?.ok
		? ((await response.json().catch(() => null)) as QueryPreview | null)
		: null;
	return preview ? { ok: true, preview } : { ok: false, retryInMs: null };
}

export type CreatedAutoPlaylist =
	| { ok: true; playlist: PlaylistAnnotation }
	| { ok: false; message: string };

export async function createAutoPlaylist(
	origin: string,
	request: AutoPlaylistRequest,
): Promise<CreatedAutoPlaylist> {
	const response = await postJson(`${origin}/api/autoplaylists`, request, {
		timeoutMs: WRITE_TIMEOUT_MS,
	});
	if (!response) return { ok: false, message: UNREACHABLE };

	if (response.ok)
		return {
			ok: true,
			playlist: (await response.json()) as PlaylistAnnotation,
		};

	const { message } = await messageOf(response, `HTTP ${response.status}`);
	return { ok: false, message };
}

// Unlike `postJson` and `fetchJson`, these throw rather than answer null: the refusals a caller
// cares about, such as `writePlaylists` off or a moved `structure`, ride the status on the error's
// `cause` and the body's `error` in its message, and an answer of `null` would have nowhere to carry
// either.
const requestThrowing = async (
	url: string,
	method: string,
	body?: unknown,
): Promise<Response> => {
	const response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
		fetch(url, {
			method,
			headers: method === "POST" ? JSON_BODY : undefined,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		}),
	);
	if (!response.ok) {
		const { message } = await messageOf(response, `HTTP ${response.status}`);
		throw new Error(`${method} ${url} failed: ${response.status}: ${message}`, {
			cause: response.status,
		});
	}
	return response;
};

const postThrowing = (url: string, body: unknown) =>
	requestThrowing(url, "POST", body);

export async function postFooJeanCommand(
	origin: string,
	path: string,
	body?: unknown,
): Promise<void> {
	await requestThrowing(`${origin}${path}`, "POST", body);
}

const playlistUrl = (origin: string, id: string) =>
	`${origin}/api/${playlistPath(id)}`;

export async function fillOwnPlaylist(
	origin: string,
	role: OwnPlaylistRole,
	request: FillOwnPlaylistRequest,
): Promise<FillResult> {
	const response = await postThrowing(
		`${origin}/api/playlists/own/${role}/items`,
		request,
	);
	return (await response.json()) as FillResult;
}

export const emptyOwnPlaylist = (origin: string, role: OwnPlaylistRole) =>
	requestThrowing(`${origin}/api/playlists/own/${role}/items`, "DELETE");

// A 403 here is always `writePlaylists` off: this route addresses a playlist by the GUID its own
// annotation carries, so the other 403 this contract has, a target foo_jean did not create, cannot
// apply to it.
export async function fillPlaylist(
	origin: string,
	guid: string,
	request: FillPlaylistRequest,
): Promise<FillResult> {
	const response = await postThrowing(
		`${playlistUrl(origin, guid)}/items`,
		request,
	);
	return (await response.json()) as FillResult;
}

const columnsQuery = (columns: readonly string[]) =>
	columns.map((column) => `columns=${encodeURIComponent(column)}`).join("&");

export type LibraryTrackAddress = Extract<
	TrackAddress,
	{ kind: "library" | "ordinal" }
>;

const libraryTrackAddressQuery = (address: LibraryTrackAddress) =>
	address.kind === "library"
		? `track=${encodeURIComponent(address.track)}&subsong=${address.subsong}`
		: `ordinal=${address.ordinal}&structure=${address.structure}`;

// foo_jean sends a library delta when it notices a change rather than when a client asks, so this is
// the only way to read one track's current values back.
export async function fetchLibraryTrack(
	origin: string,
	address: LibraryTrackAddress,
	columns: readonly string[],
): Promise<LibraryTrack> {
	const response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
		fetch(
			`${origin}/api/track/library?${libraryTrackAddressQuery(address)}&${columnsQuery(columns)}`,
			{ signal },
		),
	);
	if (response.status === 429) throw tooFast(response);
	if (!response.ok)
		throw new Error(`GET library track failed: ${response.status}`, {
			cause: response.status,
		});
	return (await response.json()) as LibraryTrack;
}

// A read behind a visible panel is not sized for foobar2000 writing tags to disk.
const READ_TIMEOUT_MS = 8_000;

export async function fetchPlayingTrack(
	origin: string,
	columns: readonly string[],
	{ signal }: { signal?: AbortSignal } = {},
): Promise<PlayingTrackColumns> {
	const response = await withTimeout(
		READ_TIMEOUT_MS,
		(inner) =>
			fetch(`${origin}/api/track/playing?${columnsQuery(columns)}`, {
				signal: inner,
			}),
		signal,
	);
	if (response.status === 429) throw tooFast(response);
	if (!response.ok)
		throw new Error(`GET playing track failed: ${response.status}`, {
			cause: response.status,
		});
	return (await response.json()) as PlayingTrackColumns;
}

export async function fetchPlaylistRows(
	origin: string,
	id: string,
	offset: number,
	count: number,
	columns: readonly string[],
	{ signal }: { signal?: AbortSignal } = {},
): Promise<PlaylistPage> {
	const response = await withTimeout(
		WRITE_TIMEOUT_MS,
		(inner) =>
			fetch(
				`${playlistUrl(origin, id)}/items?offset=${offset}&count=${count}&${columnsQuery(columns)}`,
				{ signal: inner },
			),
		signal,
	);
	if (!response.ok)
		throw new Error(`GET playlist items failed: ${response.status}`, {
			cause: response.status,
		});
	return (await response.json()) as PlaylistPage;
}

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
	const response = await withTimeout(
		WRITE_TIMEOUT_MS,
		(inner) =>
			fetch(
				`${playlistUrl(origin, id)}/items/changes?structure=${structure}&since=${since}&${columnsQuery(columns)}`,
				{ signal: inner },
			),
		signal,
	);
	if (response.status === 409) return { ok: false, reason: "moved" };
	if (response.status === 410) return { ok: false, reason: "gone" };
	if (!response.ok)
		throw new Error(`GET playlist item changes failed: ${response.status}`, {
			cause: response.status,
		});
	return { ok: true, changes: (await response.json()) as PlaylistChanges };
}

export async function createPlaylist(
	origin: string,
	request: CreatePlaylistRequest,
): Promise<PlaylistAnnotation> {
	const response = await postThrowing(`${origin}/api/playlists`, request);
	return (await response.json()) as PlaylistAnnotation;
}

export const renamePlaylist = (origin: string, id: string, title: string) =>
	postThrowing(playlistUrl(origin, id), { title });

export const removePlaylist = (origin: string, id: string) =>
	requestThrowing(playlistUrl(origin, id), "DELETE");

export const movePlaylist = (origin: string, id: string, index: number) =>
	postThrowing(`${playlistUrl(origin, id)}/move`, { index });

export const playPlaylistItem = (origin: string, id: string, index: number) =>
	requestThrowing(`${playlistUrl(origin, id)}/items/${index}/play`, "POST");

export async function copyPlaylistRows(
	origin: string,
	id: string,
	request: CopyPlaylistRowsRequest,
): Promise<CopiedRows> {
	const response = await postThrowing(
		`${playlistUrl(origin, id)}/items/copy`,
		request,
	);
	return (await response.json()) as CopiedRows;
}

export async function removePlaylistRows(
	origin: string,
	id: string,
	request: RemovePlaylistRowsRequest,
): Promise<RemovedRows> {
	const response = await postThrowing(
		`${playlistUrl(origin, id)}/items/remove`,
		request,
	);
	return (await response.json()) as RemovedRows;
}

// Tells a deliberate stop from a dropped connection: both close the socket, and only this one gives
// the player its sound back now rather than after the component's linger.
export function leaveStream(origin: string, deviceId: string) {
	void fetch(`${origin}/api/stream/leave`, {
		method: "POST",
		headers: JSON_BODY,
		body: JSON.stringify({ deviceId }),
	}).catch(() => {});
}

export type QueueRead = Schema["QueueRead"];
export type QueuedTrack = Schema["QueuedTrack"];
export type QueuePlaylistRowsRequest = Schema["QueuePlaylistRowsRequest"];
export type QueueLibraryTracksRequest = Schema["QueueLibraryTracksRequest"];
export type MoveQueueRequest = Schema["MoveQueueRequest"];

const deleteJson = async (
	url: string,
	{ timeoutMs = WRITE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Response | null> => {
	try {
		return await withTimeout(timeoutMs, (signal) =>
			fetch(url, { method: "DELETE", signal }),
		);
	} catch {
		return null;
	}
};

export type QueueMutationResult =
	| { ok: true }
	| { ok: false; reason: "stale" }
	| {
			ok: false;
			reason: "failed";
			message: string;
			refusal: SwitchRefusal | null;
	  };

const queueMutationResult = async (
	response: Response | null,
): Promise<QueueMutationResult> => {
	if (!response)
		return { ok: false, reason: "failed", message: UNREACHABLE, refusal: null };
	if (response.ok) return { ok: true };
	if (response.status === 409) return { ok: false, reason: "stale" };
	const { message, error } = await messageOf(
		response,
		`HTTP ${response.status}`,
	);
	return {
		ok: false,
		reason: "failed",
		message,
		refusal: response.status === 403 ? switchRefusalIn(error) : null,
	};
};

export const fetchQueue = (origin: string) =>
	fetchJson<QueueRead>(origin, "/api/queue");

export type Outputs = Schema["Outputs"];
export type OutputDevice = Schema["OutputDevice"];

export const fetchOutputs = (origin: string) =>
	fetchJson<Outputs>(origin, "/api/outputs");

export async function postQueue(
	origin: string,
	request: QueuePlaylistRowsRequest | QueueLibraryTracksRequest,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await postJson(`${origin}/api/queue`, request, {
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
	);
}

export async function clearQueue(origin: string): Promise<QueueMutationResult> {
	return queueMutationResult(await deleteJson(`${origin}/api/queue`));
}

export async function moveQueueEntry(
	origin: string,
	request: MoveQueueRequest,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await postJson(`${origin}/api/queue/move`, request, {
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
	);
}

export async function removeQueueEntry(
	origin: string,
	index: number,
	revision: number,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await deleteJson(`${origin}/api/queue/${index}?revision=${revision}`),
	);
}
