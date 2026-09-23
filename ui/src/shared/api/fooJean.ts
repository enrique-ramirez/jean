import type { components } from "./fooJeanSchema";
import type { TrackAddress } from "./types";

type Schema = components["schemas"];

export type DiscoveryRecord = Schema["DiscoveryRecord"];
export type FooJeanStatus = Schema["Status"];
export type FooJeanCapabilities = Schema["Capabilities"];
export type TagWriteRequest = Schema["TagWriteRequest"];
export type TagWritten = Schema["TagWritten"];
export type StreamTicket = Schema["StreamTicket"];
export type StreamTimeline = Schema["StreamTimeline"];
export type StreamMark = StreamTimeline["marks"][number];
export type StreamListeners = Schema["StreamListeners"];
export type StreamListener = StreamListeners["devices"][number];
export type DeviceIdentity = Schema["DeviceIdentity"];
export type Paired = Schema["Paired"];
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

// Never moves to `/api/clientconfig`: beefweb serves that namespace unauthenticated. The root CLAUDE.md holds the rest of the exclusion list.
export const TOKEN_KEY = "jean.fooJeanToken";

// The component rewrites this clientconfig id on every start, so Jean must not store settings under it.
export const FOO_JEAN_ID = "foo_jean";

export const SUPPORTED_API_VERSION = 1;

const PROBE_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 35_000;
const STATE_TIMEOUT_MS = 5_000;

// The component listens on the player's host, which is the page's own host in a build but not on the
// dev server: there `/api` is proxied and this is not.
export const originOfPort = (port: number) =>
	`${window.location.protocol}//${__PLAYER_HOST__ ?? window.location.hostname}:${port}`;

export const withTimeout = async <T>(
	ms: number,
	run: (signal: AbortSignal) => Promise<T>,
	outer?: AbortSignal,
): Promise<T> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	const relay = () => controller.abort();
	outer?.addEventListener("abort", relay);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
		outer?.removeEventListener("abort", relay);
	}
};

const isPort = (value: unknown) =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	value > 0 &&
	value <= 65535;

const looksLikeRecord = (value: unknown): value is DiscoveryRecord =>
	typeof value === "object" &&
	value !== null &&
	(value as DiscoveryRecord).name === FOO_JEAN_ID &&
	isPort((value as DiscoveryRecord).port);

// A 404 is beefweb saying nobody has written that id, which is the not-installed signal. Anything
// else throws, so a hiccup is never cached as absent.
export async function fetchDiscoveryRecord(): Promise<DiscoveryRecord | null> {
	const response = await fetch(`/api/clientconfig/${FOO_JEAN_ID}`);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`HTTP ${response.status}`);

	const body: unknown = await response.json().catch(() => null);
	return looksLikeRecord(body) ? body : null;
}

export type ProbeResult =
	| { ok: true; status: FooJeanStatus }
	| { ok: false; reason: "unreachable" }
	| { ok: false; reason: "impostor" }
	| { ok: false; reason: "unsupported"; apiVersion: number };

// Unauthenticated, and must stay so: this is what makes the advertised port safe to send a credential to.
export async function probeStatus(origin: string): Promise<ProbeResult> {
	const body = await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
		const response = await fetch(`${origin}/api/status`, { signal });
		if (!response.ok) return null;
		return (await response.json()) as unknown;
	}).catch(() => undefined);

	if (body === undefined || body === null)
		return { ok: false, reason: "unreachable" };

	const status = body as FooJeanStatus;
	if (status?.name !== FOO_JEAN_ID) return { ok: false, reason: "impostor" };
	if (status.apiVersion !== SUPPORTED_API_VERSION)
		return { ok: false, reason: "unsupported", apiVersion: status.apiVersion };

	return { ok: true, status };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const JSON_BODY = { "Content-Type": "application/json" };

const UNREACHABLE = "Could not reach foo_jean.";

const postJson = async (
	url: string,
	body: unknown,
	{
		token,
		timeoutMs = PROBE_TIMEOUT_MS,
	}: { token?: string; timeoutMs?: number } = {},
): Promise<Response | null> => {
	try {
		return await withTimeout(timeoutMs, (signal) =>
			fetch(url, {
				method: "POST",
				headers: token ? { ...bearer(token), ...JSON_BODY } : JSON_BODY,
				body: JSON.stringify(body),
				signal,
			}),
		);
	} catch {
		return null;
	}
};

const refusals = new Set<() => void>();

export const whenTokenRefused = (listener: () => void) => {
	refusals.add(listener);
	return () => {
		refusals.delete(listener);
	};
};

export const noteTokenRefused = (status: number) => {
	if (status !== 401) return;
	for (const listener of [...refusals]) listener();
};

const authedJson = async <T>(
	origin: string,
	token: string,
	path: string,
	// A plain object, not a `Headers`: spreading a `Headers` instance yields `{}`, so a POST would
	// silently lose its content type.
	init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<T | null> => {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}${path}`, {
				...init,
				headers: { ...bearer(token), ...init?.headers },
				signal,
			});
			if (!response.ok) {
				noteTokenRefused(response.status);
				return null;
			}
			return (await response.json()) as T;
		});
	} catch {
		return null;
	}
};

export type CapabilitiesResult =
	| { ok: true; capabilities: FooJeanCapabilities }
	| { ok: false; reason: "unauthorized" | "unreachable" };

export async function fetchCapabilities(
	origin: string,
	token: string,
): Promise<CapabilitiesResult> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/capabilities`, {
				headers: bearer(token),
				signal,
			});
			if (response.status === 401)
				return { ok: false, reason: "unauthorized" } as const;
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

export type StateFailureReason =
	| "unavailable"
	| "unauthorized"
	| "unreachable"
	| "failed";

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
	401: "unauthorized",
	503: "unavailable",
};

export async function fetchState(
	origin: string,
	token: string,
	tag: string | null,
	signal?: AbortSignal,
): Promise<StateResult> {
	let response: Response;
	try {
		response = await withTimeout(
			STATE_TIMEOUT_MS,
			(inner) =>
				fetch(`${origin}/api/state`, {
					headers: tag
						? { ...bearer(token), "If-None-Match": tag }
						: bearer(token),
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
		noteTokenRefused(response.status);
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
	| { ok: false; reason: "unauthorized"; message: string }
	| { ok: false; reason: "refused"; message: string }
	| { ok: false; reason: "failed"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type WriteResult = { ok: true; written: TagWritten } | WriteFailure;

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
	token: string,
	request: TagWriteRequest,
): Promise<WriteResult> {
	const response = await postJson(`${origin}/api/tags`, request, {
		token,
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
	if (response.status === 401) {
		noteTokenRefused(response.status);
		return { ok: false, reason: "unauthorized", message };
	}
	if (response.status === 409)
		return error === NAMES_TWO_TRACKS
			? { ok: false, reason: "ambiguous", message }
			: { ok: false, reason: "moved", message };
	if (response.status === 504) return { ok: false, reason: "timeout", message };
	if (response.status === 400 || response.status === 413)
		return { ok: false, reason: "refused", message };
	if (response.status === 503)
		return { ok: false, reason: "unavailable", message };

	return { ok: false, reason: "failed", message };
}

export type FooJeanState =
	| { kind: "absent" }
	| {
			kind: "not-listening";
			record: DiscoveryRecord;
			error: string;
			portInUse: boolean;
	  }
	| { kind: "unreachable"; record: DiscoveryRecord }
	| { kind: "impostor"; record: DiscoveryRecord }
	| { kind: "unsupported"; record: DiscoveryRecord; apiVersion: number }
	| { kind: "no-token"; record: DiscoveryRecord; status: FooJeanStatus }
	| { kind: "unauthorized"; record: DiscoveryRecord; status: FooJeanStatus }
	| {
			kind: "ready";
			record: DiscoveryRecord;
			status: FooJeanStatus;
			capabilities: FooJeanCapabilities;
	  };

export interface FooJeanDiscovery {
	state: FooJeanState;
	origin: string | null;
	token: string | null;
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

export const isFooJeanReady = (discovery: FooJeanDiscovery) =>
	discovery.state.kind === "ready";

// A caller already inside a guarded control has `origin` and `token` as two nullable strings, from
// `FooJeanDiscovery` or threaded down separately; this is the one throw both shapes share.
export function requireFooJean(
	origin: string | null,
	token: string | null,
): { origin: string; token: string } {
	if (!origin || !token) throw new Error("foo_jean is not reachable");
	return { origin, token };
}

export async function discoverFooJean(
	token: string | null,
): Promise<FooJeanDiscovery> {
	const unproven = { origin: null, token: null };
	const settled = { ...unproven, retryable: false };
	const transient = { ...unproven, retryable: true };

	const record = await fetchDiscoveryRecord().catch(() => undefined);
	if (record === undefined) return { state: { kind: "absent" }, ...transient };
	if (record === null) return { state: { kind: "absent" }, ...settled };

	if (!record.listening) {
		return {
			state: {
				kind: "not-listening",
				record,
				error: record.error ?? "The component could not start.",
				portInUse: Boolean(record.portInUse),
			},
			...settled,
		};
	}

	const origin = originOfPort(record.port);
	const probe = await probeStatus(origin);

	if (!probe.ok) {
		if (probe.reason === "unreachable")
			return { state: { kind: "unreachable", record }, ...transient };
		return {
			state:
				probe.reason === "unsupported"
					? { kind: "unsupported", record, apiVersion: probe.apiVersion }
					: { kind: "impostor", record },
			...settled,
		};
	}

	const { status } = probe;

	if (!token)
		return {
			state: { kind: "no-token", record, status },
			origin,
			token: null,
			retryable: false,
		};

	const capabilities = await fetchCapabilities(origin, token);
	if (!capabilities.ok) {
		if (capabilities.reason === "unreachable")
			return { state: { kind: "unreachable", record }, ...transient };
		return {
			state: { kind: "unauthorized", record, status },
			origin,
			token: null,
			retryable: false,
		};
	}

	return {
		state: {
			kind: "ready",
			record,
			status,
			capabilities: capabilities.capabilities,
		},
		origin,
		token,
		retryable: false,
	};
}

export type TicketFailure =
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unauthorized"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type TicketResult = { ok: true; ticket: StreamTicket } | TicketFailure;

const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

export async function issueStreamTicket(
	origin: string,
	token: string,
	device: DeviceIdentity,
): Promise<TicketResult> {
	const response = await postJson(`${origin}/api/stream/ticket`, device, {
		token,
	});
	if (!response)
		return { ok: false, reason: "unreachable", message: UNREACHABLE };

	if (response.ok)
		return { ok: true, ticket: (await response.json()) as StreamTicket };

	const { message } = await messageOf(response, `HTTP ${response.status}`);
	if (response.status === 401)
		return { ok: false, reason: "unauthorized", message };
	if (response.status === 503)
		return {
			ok: false,
			reason: isBusy(message) ? "busy" : "unavailable",
			message,
		};
	return { ok: false, reason: "unreachable", message };
}

export const libraryArtworkUrl = (origin: string | null, path: string) =>
	origin && `${origin}/api/artwork?track=${encodeURIComponent(path)}`;

export const playingArtworkUrl = (origin: string | null) =>
	origin && `${origin}/api/artwork/playing`;

export const playlistRowArtworkUrl = (
	origin: string | null,
	playlistId: string,
	index: number,
) => origin && `${origin}/api/artwork/playlists/${playlistId}/${index}`;

// The ticket travels in the query string and the bearer token never does: an `<audio>` element sends
// no headers, and a token here would reach every proxy log on the way.
export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

export const fetchStreamTimeline = (origin: string, token: string) =>
	authedJson<StreamTimeline>(origin, token, "/api/stream/timeline");

export const fetchStreamListeners = (origin: string, token: string) =>
	authedJson<StreamListeners>(origin, token, "/api/stream/listeners");

export async function fetchPlaylistAnnotations(
	origin: string,
	token: string,
): Promise<PlaylistAnnotation[] | null> {
	const body = await authedJson<{ playlists?: PlaylistAnnotation[] }>(
		origin,
		token,
		"/api/playlists",
	);
	return body?.playlists ?? null;
}

// A query that does not parse comes back as a 200 carrying `valid: false`, never as a 400. Debounce
// the caller: this runs on foobar2000's main thread.
export const previewQuery = (origin: string, token: string, query: string) =>
	authedJson<QueryPreview>(origin, token, "/api/autoplaylists/preview", {
		method: "POST",
		headers: JSON_BODY,
		body: JSON.stringify({ query }),
	});

export type CreatedAutoPlaylist =
	| { ok: true; playlist: PlaylistAnnotation }
	| { ok: false; message: string };

export async function createAutoPlaylist(
	origin: string,
	token: string,
	request: AutoPlaylistRequest,
): Promise<CreatedAutoPlaylist> {
	const response = await postJson(`${origin}/api/autoplaylists`, request, {
		token,
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

// Unlike `postJson` and `authedJson`, these throw rather than answer null: the refusals a caller
// cares about, such as `writePlaylists` off or a moved `structure`, ride the status on the error's
// `cause`, and an answer of `null` would have nowhere to carry it.
const requestThrowing = async (
	url: string,
	token: string,
	method: string,
	body?: unknown,
): Promise<Response> => {
	const response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
		fetch(url, {
			method,
			headers:
				body === undefined ? bearer(token) : { ...bearer(token), ...JSON_BODY },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		}),
	);
	if (!response.ok)
		throw new Error(`${method} ${url} failed: ${response.status}`, {
			cause: response.status,
		});
	return response;
};

const postThrowing = (url: string, token: string, body: unknown) =>
	requestThrowing(url, token, "POST", body);

const playlistUrl = (origin: string, id: string) =>
	`${origin}/api/playlists/${encodeURIComponent(id)}`;

export async function fillOwnPlaylist(
	origin: string,
	token: string,
	role: OwnPlaylistRole,
	request: FillOwnPlaylistRequest,
): Promise<FillResult> {
	const response = await postThrowing(
		`${origin}/api/playlists/own/${role}/items`,
		token,
		request,
	);
	return (await response.json()) as FillResult;
}

export const emptyOwnPlaylist = (
	origin: string,
	token: string,
	role: OwnPlaylistRole,
) =>
	requestThrowing(`${origin}/api/playlists/own/${role}/items`, token, "DELETE");

// A 403 here is always `writePlaylists` off: this route addresses a playlist by the GUID its own
// annotation carries, so the other 403 this contract has, a target foo_jean did not create, cannot
// apply to it.
export async function fillPlaylist(
	origin: string,
	token: string,
	guid: string,
	request: FillPlaylistRequest,
): Promise<FillResult> {
	const response = await postThrowing(
		`${origin}/api/playlists/${guid}/items`,
		token,
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
	token: string,
	address: LibraryTrackAddress,
	columns: readonly string[],
): Promise<LibraryTrack> {
	const response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
		fetch(
			`${origin}/api/track/library?${libraryTrackAddressQuery(address)}&${columnsQuery(columns)}`,
			{ headers: bearer(token), signal },
		),
	);
	if (!response.ok) {
		noteTokenRefused(response.status);
		throw new Error(`GET library track failed: ${response.status}`, {
			cause: response.status,
		});
	}
	return (await response.json()) as LibraryTrack;
}

// A read behind a visible panel is not sized for foobar2000 writing tags to disk.
const READ_TIMEOUT_MS = 8_000;

export async function fetchPlayingTrack(
	origin: string,
	token: string,
	columns: readonly string[],
): Promise<PlayingTrackColumns> {
	const response = await withTimeout(READ_TIMEOUT_MS, (signal) =>
		fetch(`${origin}/api/track/playing?${columnsQuery(columns)}`, {
			headers: bearer(token),
			signal,
		}),
	);
	if (!response.ok) {
		noteTokenRefused(response.status);
		throw new Error(`GET playing track failed: ${response.status}`, {
			cause: response.status,
		});
	}
	return (await response.json()) as PlayingTrackColumns;
}

export async function fetchPlaylistRows(
	origin: string,
	token: string,
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
				{ headers: bearer(token), signal: inner },
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
	token: string,
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
				{ headers: bearer(token), signal: inner },
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
	token: string,
	request: CreatePlaylistRequest,
): Promise<PlaylistAnnotation> {
	const response = await postThrowing(
		`${origin}/api/playlists`,
		token,
		request,
	);
	return (await response.json()) as PlaylistAnnotation;
}

export const renamePlaylist = (
	origin: string,
	token: string,
	id: string,
	title: string,
) => postThrowing(playlistUrl(origin, id), token, { title });

export const removePlaylist = (origin: string, token: string, id: string) =>
	requestThrowing(playlistUrl(origin, id), token, "DELETE");

export const movePlaylist = (
	origin: string,
	token: string,
	id: string,
	index: number,
) => postThrowing(`${playlistUrl(origin, id)}/move`, token, { index });

export const playPlaylistItem = (
	origin: string,
	token: string,
	id: string,
	index: number,
) =>
	requestThrowing(
		`${playlistUrl(origin, id)}/items/${index}/play`,
		token,
		"POST",
	);

export async function copyPlaylistRows(
	origin: string,
	token: string,
	id: string,
	request: CopyPlaylistRowsRequest,
): Promise<CopiedRows> {
	const response = await postThrowing(
		`${playlistUrl(origin, id)}/items/copy`,
		token,
		request,
	);
	return (await response.json()) as CopiedRows;
}

export async function removePlaylistRows(
	origin: string,
	token: string,
	id: string,
	request: RemovePlaylistRowsRequest,
): Promise<RemovedRows> {
	const response = await postThrowing(
		`${playlistUrl(origin, id)}/items/remove`,
		token,
		request,
	);
	return (await response.json()) as RemovedRows;
}

// Tells a deliberate stop from a dropped connection: both close the socket, and only this one gives
// the player its sound back now rather than after the component's linger.
export function leaveStream(origin: string, token: string, deviceId: string) {
	void fetch(`${origin}/api/stream/leave`, {
		method: "POST",
		headers: { ...bearer(token), ...JSON_BODY },
		body: JSON.stringify({ deviceId }),
	}).catch(() => {});
}

export type PairFailure =
	| { ok: false; reason: "not-open"; message: string }
	| { ok: false; reason: "not-local"; message: string }
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unreachable"; message: string }
	| { ok: false; reason: "unsupported"; message: string };

export type PairResult = { ok: true; token: string } | PairFailure;

export async function pairWithAgent(
	origin: string,
	name: string,
): Promise<PairResult> {
	const response = await postJson(`${origin}/api/pair`, name ? { name } : {});
	if (!response)
		return { ok: false, reason: "unreachable", message: UNREACHABLE };

	if (response.ok) {
		const body = (await response.json()) as Paired;
		if (!body?.token)
			return {
				ok: false,
				reason: "unsupported",
				message: "foo_jean answered without a token.",
			};
		return { ok: true, token: body.token };
	}

	const { message } = await messageOf(response, `HTTP ${response.status}`);

	if (response.status === 403)
		return /local network/i.test(message)
			? { ok: false, reason: "not-local", message }
			: { ok: false, reason: "not-open", message };
	if (response.status === 429) return { ok: false, reason: "busy", message };
	if (response.status === 404 || response.status === 415)
		return { ok: false, reason: "unsupported", message };

	return { ok: false, reason: "unreachable", message };
}

export type QueueRead = Schema["QueueRead"];
export type QueuedTrack = Schema["QueuedTrack"];
export type QueuePlaylistRowsRequest = Schema["QueuePlaylistRowsRequest"];
export type QueueLibraryTracksRequest = Schema["QueueLibraryTracksRequest"];
export type MoveQueueRequest = Schema["MoveQueueRequest"];

const deleteJson = async (
	url: string,
	token: string,
	{ timeoutMs = WRITE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Response | null> => {
	try {
		return await withTimeout(timeoutMs, (signal) =>
			fetch(url, { method: "DELETE", headers: bearer(token), signal }),
		);
	} catch {
		return null;
	}
};

export type QueueMutationResult =
	| { ok: true }
	| { ok: false; reason: "stale" }
	| { ok: false; reason: "failed"; message: string };

const queueMutationResult = async (
	response: Response | null,
): Promise<QueueMutationResult> => {
	if (!response) return { ok: false, reason: "failed", message: UNREACHABLE };
	if (response.ok) return { ok: true };
	if (response.status === 409) return { ok: false, reason: "stale" };
	const { message } = await messageOf(response, `HTTP ${response.status}`);
	return { ok: false, reason: "failed", message };
};

export const fetchQueue = (origin: string, token: string) =>
	authedJson<QueueRead>(origin, token, "/api/queue");

export async function postQueue(
	origin: string,
	token: string,
	request: QueuePlaylistRowsRequest | QueueLibraryTracksRequest,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await postJson(`${origin}/api/queue`, request, {
			token,
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
	);
}

export async function clearQueue(
	origin: string,
	token: string,
): Promise<QueueMutationResult> {
	return queueMutationResult(await deleteJson(`${origin}/api/queue`, token));
}

export async function moveQueueEntry(
	origin: string,
	token: string,
	request: MoveQueueRequest,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await postJson(`${origin}/api/queue/move`, request, {
			token,
			timeoutMs: WRITE_TIMEOUT_MS,
		}),
	);
}

export async function removeQueueEntry(
	origin: string,
	token: string,
	index: number,
	revision: number,
): Promise<QueueMutationResult> {
	return queueMutationResult(
		await deleteJson(
			`${origin}/api/queue/${index}?revision=${revision}`,
			token,
		),
	);
}

export type Run = [start: number, count: number];

// A playlist copy and a playlist row removal both take `runs` and read them in ascending order
// whatever order they arrive in, so a caller holding an arbitrary or click-ordered set collapses it
// here rather than sending an order the route would silently ignore.
export function runsOf(positions: ArrayLike<number>): Run[] {
	const sorted = Array.from(new Set(Array.from(positions))).sort(
		(a, b) => a - b,
	);
	const runs: Run[] = [];
	for (const value of sorted) {
		const last = runs[runs.length - 1];
		if (last && value === last[0] + last[1]) last[1] += 1;
		else runs.push([value, 1]);
	}
	return runs;
}

type AscendingScan = { ascending: true; runs: Run[] } | { ascending: false };

const strictlyAscendingRuns = (rows: number[]): AscendingScan => {
	const runs: Run[] = [[rows[0], 1]];
	for (let index = 1; index < rows.length; index += 1) {
		const value = rows[index];
		if (value <= rows[index - 1]) return { ascending: false };

		const run = runs[runs.length - 1];
		if (value === run[0] + run[1]) run[1] += 1;
		else runs.push([value, 1]);
	}
	return { ascending: true, runs };
};

const BASE64_CHARS =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64Of = (bytes: Uint8Array): string => {
	let text = "";
	for (let at = 0; at < bytes.length; at += 3) {
		const b0 = bytes[at];
		const b1 = bytes[at + 1];
		const b2 = bytes[at + 2];
		text += BASE64_CHARS[b0 >> 2];
		text += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
		text +=
			b1 === undefined
				? "="
				: BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
		text += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
	}
	return text;
};

const bitsetOf = (rows: number[], trackCount: number): string => {
	const bytes = new Uint8Array(Math.ceil(trackCount / 8));
	for (const ordinal of rows) bytes[ordinal >> 3] |= 1 << (ordinal & 7);
	return base64Of(bytes);
};

export function encodeFill(
	ordinals: ArrayLike<number>,
	library: { structure: number; trackCount: number },
): FillPlaylistRequest {
	const rows = Array.from(ordinals);
	if (rows.length === 0)
		throw new Error("encodeFill: an empty set cannot fill a playlist");

	const scan = strictlyAscendingRuns(rows);
	if (!scan.ascending) return { structure: library.structure, ordinals: rows };

	const bitsetByteBudget = 4 * Math.ceil(Math.ceil(library.trackCount / 8) / 3);
	const runsCharCount = JSON.stringify(scan.runs).length;

	return runsCharCount <= bitsetByteBudget
		? { structure: library.structure, runs: scan.runs }
		: {
				structure: library.structure,
				bitset: bitsetOf(rows, library.trackCount),
			};
}
