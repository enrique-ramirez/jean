import type { components } from "./fooJeanSchema";

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

// Never moves to `/api/clientconfig`: beefweb serves that namespace unauthenticated. The root CLAUDE.md holds the rest of the exclusion list.
export const TOKEN_KEY = "jean.fooJeanToken";

// The component rewrites this clientconfig id on every start, so Jean must not store settings under it.
export const FOO_JEAN_ID = "foo_jean";

export const SUPPORTED_API_VERSION = 1;

const PROBE_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 35_000;

// The component listens on the player's host, which is the page's own host in a build but not on the
// dev server: there `/api` is proxied and this is not.
export const originOfPort = (port: number) =>
	`${window.location.protocol}//${__PLAYER_HOST__ ?? window.location.hostname}:${port}`;

const withTimeout = async <T>(
	ms: number,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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
			if (!response.ok) return null;
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

export type WriteFailure =
	| { ok: false; reason: "not-allowed"; field: string | null; message: string }
	| { ok: false; reason: "unknown-track"; message: string }
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
	if (!body?.error) return { message: fallback, field: null };
	return {
		message: body.detail ? `${body.error}: ${body.detail}` : body.error,
		field: body.field ?? null,
	};
};

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

	const { message, field } = await messageOf(
		response,
		`HTTP ${response.status}`,
	);

	if (response.status === 403)
		return { ok: false, reason: "not-allowed", field, message };
	if (response.status === 404)
		return { ok: false, reason: "unknown-track", message };
	if (response.status === 401)
		return { ok: false, reason: "unauthorized", message };
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
	// Non-null exactly when the probe succeeded, so holding it is the proof the port answered
	// `/api/status` as `foo_jean`. Pairing needs that before it has a token.
	origin: string | null;
	token: string | null;
	retryable: boolean;
}

// The order is the security model: read the hint, prove the port with an unauthenticated call, and
// only then attach the token. Skipping the middle step hands a credential to whoever forged the record.
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

// Busy and unavailable are both 503; the error string is all that separates them.
const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

// A ticket is not single-use: Safari sends a `Range: bytes=0-1` probe before fetching for real, so
// one playback start is two requests.
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

// The ticket travels in the query string and the bearer token never does: an `<audio>` element sends
// no headers, and a token here would reach every proxy log on the way.
export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

export const fetchStreamTimeline = (origin: string, token: string) =>
	authedJson<StreamTimeline>(origin, token, "/api/stream/timeline");

export const fetchStreamListeners = (origin: string, token: string) =>
	authedJson<StreamListeners>(origin, token, "/api/stream/listeners");

// Joined on `beefwebId`, and beefweb must be asked first: it assigns those ids lazily, so a playlist
// created a moment ago reports `beefwebId: null` until beefweb next rebuilds its map, and asking
// beefweb is what makes it do so.
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

// Pairing is a write, so the caller must probe `/api/status` first and confirm this really is
// `foo_jean` before posting to the port a forgeable record named.
// The `Content-Type: application/json` is what makes this preflighted: the component refuses anything
// else, so no page can fire a simple POST blind and spend the single grant.
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

	// The two 403s are told apart by the error string: one is a button to press, the other is a network.
	if (response.status === 403)
		return /local network/i.test(message)
			? { ok: false, reason: "not-local", message }
			: { ok: false, reason: "not-open", message };
	if (response.status === 429) return { ok: false, reason: "busy", message };
	if (response.status === 404 || response.status === 415)
		return { ok: false, reason: "unsupported", message };

	return { ok: false, reason: "unreachable", message };
}
