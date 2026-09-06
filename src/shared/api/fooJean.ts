import type { components } from "./fooJeanSchema";

// `foo_jean`, the optional component that writes tags and streams audio. Types are generated from its OpenAPI document.
// The discovery record comes from beefweb, same origin. Everything else comes from the component, cross-origin, with a bearer token.

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

// This may never move to `/api/clientconfig`: beefweb serves that namespace unauthenticated. `jean.listenVolume`, `jean.deviceId` and `jean.deviceName` are excluded from that move as well; the root CLAUDE.md holds the list and the reasons.
export const TOKEN_KEY = "jean.fooJeanToken";

// The component owns this clientconfig id and rewrites it on every start, so Jean must not store settings under it.
export const FOO_JEAN_ID = "foo_jean";

// The component's own version moves independently; this is the number to refuse on.
export const SUPPORTED_API_VERSION = 1;

const PROBE_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 35_000;

// The component's port on the machine beefweb runs on: the page's own host in a build, and `__PLAYER_HOST__` on the dev server, which proxies `/api` to the player.
// Jean's protocol rather than a hardcoded `http:`, so this survives TLS terminated in front of both.
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

// ---- discovery, through beefweb ---------------------------------------------

// The record is writable by anyone who can reach beefweb, so the port is bounded here rather than trusted downstream.
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

export async function fetchDiscoveryRecord(): Promise<DiscoveryRecord | null> {
	const response = await fetch(`/api/clientconfig/${FOO_JEAN_ID}`);
	if (response.status === 404) return null;
	if (!response.ok) return null;

	const body: unknown = await response.json().catch(() => null);
	return looksLikeRecord(body) ? body : null;
}

// ---- the component ----------------------------------------------------------

export type ProbeResult =
	| { ok: true; status: FooJeanStatus }
	| { ok: false; reason: "unreachable" }
	// Something answered and it is not the component, which is what a forged discovery record looks like.
	| { ok: false; reason: "impostor" }
	| { ok: false; reason: "unsupported"; apiVersion: number };

// Unauthenticated, and must stay so: this is what makes the advertised port safe to send a credential to.
export async function probeStatus(origin: string): Promise<ProbeResult> {
	const body = await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
		const response = await fetch(`${origin}/api/status`, { signal });
		if (!response.ok) return null;
		return (await response.json()) as unknown;
	}).catch(() => undefined);

	// `undefined` is a refused connection, a CORS rejection or a timeout; `null` is an answer that was not a 200.
	if (body === undefined || body === null)
		return { ok: false, reason: "unreachable" };

	const status = body as FooJeanStatus;
	if (status?.name !== FOO_JEAN_ID) return { ok: false, reason: "impostor" };
	if (status.apiVersion !== SUPPORTED_API_VERSION)
		return { ok: false, reason: "unsupported", apiVersion: status.apiVersion };

	return { ok: true, status };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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

// Named for what a caller has to decide, which cuts across the HTTP statuses.
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

// 401 and 413 are refused before the route is reached, so neither carries `written`.
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
	let response: Response;
	try {
		response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
			fetch(`${origin}/api/tags`, {
				method: "POST",
				headers: { ...bearer(token), "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal,
			}),
		);
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			message: "Could not reach foo_jean.",
		};
	}

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

// ---- one discovery, two seams -----------------------------------------------

// What Jean found, which is not the same as what it can do. No state here is silent: each has one message and one remedy in `features/settings/`.
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
	// Non-null exactly when the probe succeeded, so holding it is proof the port answered `/api/status` as `foo_jean`. Pairing needs that before it has a token.
	origin: string | null;
	token: string | null;
}

// The order is the security model: read the hint, prove the port with an unauthenticated call, and only then attach the token.
// Skipping the middle step hands a credential to whoever forged the record.
export async function discoverFooJean(
	token: string | null,
): Promise<FooJeanDiscovery> {
	const absent = { origin: null, token: null };
	const record = await fetchDiscoveryRecord().catch(() => null);
	if (!record) return { state: { kind: "absent" }, ...absent };

	if (!record.listening) {
		return {
			state: {
				kind: "not-listening",
				record,
				error: record.error ?? "The component could not start.",
				portInUse: Boolean(record.portInUse),
			},
			...absent,
		};
	}

	const origin = originOfPort(record.port);
	const probe = await probeStatus(origin);

	if (!probe.ok) {
		const state: FooJeanState =
			probe.reason === "unsupported"
				? { kind: "unsupported", record, apiVersion: probe.apiVersion }
				: probe.reason === "impostor"
					? { kind: "impostor", record }
					: { kind: "unreachable", record };
		return { state, ...absent };
	}

	const { status } = probe;
	const proven = { origin, token: null };

	if (!token) return { state: { kind: "no-token", record, status }, ...proven };

	const capabilities = await fetchCapabilities(origin, token);
	if (!capabilities.ok) {
		return {
			state:
				capabilities.reason === "unauthorized"
					? { kind: "unauthorized", record, status }
					: { kind: "unreachable", record },
			...(capabilities.reason === "unauthorized" ? proven : absent),
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
	};
}

// ---- listening ---------------------------------------------------------------

// Named for what a caller has to decide, as the write failures above are.
export type TicketFailure =
	// Serving as many listeners as `maxConcurrentStreams` allows. Retryable, and it must not read as "not supported".
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unauthorized"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type TicketResult = { ok: true; ticket: StreamTicket } | TicketFailure;

// Both are 503, so the `error` string is the only thing separating "does not stream" from "too many listeners".
const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

// Asked for immediately before connecting and never stored.
// Not single-use: Safari sends a `Range: bytes=0-1` probe before fetching for real, so one playback start is two requests.
// The device names itself here because this is the only part of opening a stream a client controls: an `<audio>` element sends no body and no header of its own.
export async function issueStreamTicket(
	origin: string,
	token: string,
	device: DeviceIdentity,
): Promise<TicketResult> {
	let response: Response;
	try {
		response = await withTimeout(PROBE_TIMEOUT_MS, (signal) =>
			fetch(`${origin}/api/stream/ticket`, {
				method: "POST",
				headers: { ...bearer(token), "Content-Type": "application/json" },
				body: JSON.stringify(device),
				signal,
			}),
		);
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			message: "Could not reach foo_jean.",
		};
	}

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

// The ticket travels in the query string and the bearer token never does: an `<audio>` element cannot send a header, and a token here would reach every proxy log on the way.
export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

// `null` rather than a failure shape: a missing timeline costs the progress correction and nothing else.
export async function fetchStreamTimeline(
	origin: string,
	token: string,
): Promise<StreamTimeline | null> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/stream/timeline`, {
				headers: bearer(token),
				signal,
			});
			if (!response.ok) return null;
			return (await response.json()) as StreamTimeline;
		});
	} catch {
		return null;
	}
}

// `null` rather than a failure shape, for the same reason as the timeline: without it the picker shows this device and the player and says nothing about anybody else.
export async function fetchStreamListeners(
	origin: string,
	token: string,
): Promise<StreamListeners | null> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/stream/listeners`, {
				headers: bearer(token),
				signal,
			});
			if (!response.ok) return null;
			return (await response.json()) as StreamListeners;
		});
	} catch {
		return null;
	}
}

// ---- what beefweb cannot say about a playlist -------------------------------

/**
 * Which playlists are autoplaylists. beefweb's `PlaylistInfo` has six fields and none of them is
 * this, and there is no way to work it out from the outside: probing with a write is destructive,
 * `itemCount` drift cannot separate a smart playlist from `Default Playlist` churn, and a name
 * heuristic only catches foobar2000's own `#Quicksearch` prefix.
 *
 * Joined on `beefwebId`. **beefweb must be asked first**: it assigns its ids lazily, so a playlist
 * created a moment ago reports `beefwebId: null` until beefweb next rebuilds its map -- and asking
 * beefweb is what makes it do so.
 */
export async function fetchPlaylistAnnotations(
	origin: string,
	token: string,
): Promise<PlaylistAnnotation[] | null> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/playlists`, {
				headers: bearer(token),
				signal,
			});
			if (!response.ok) return null;
			const body = (await response.json()) as {
				playlists?: PlaylistAnnotation[];
			};
			return body.playlists ?? null;
		});
	} catch {
		return null;
	}
}

/**
 * What a query would match, without creating anything. A query that does not parse is a `200` here
 * carrying `valid: false`, because this is called while somebody types and an unreadable query is
 * data rather than an error.
 *
 * Debounced by the caller: it runs on foobar2000's main thread, so one request per keystroke is one
 * main-thread callback per keystroke.
 */
export async function previewQuery(
	origin: string,
	token: string,
	query: string,
): Promise<QueryPreview | null> {
	try {
		return await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
			const response = await fetch(`${origin}/api/autoplaylists/preview`, {
				method: "POST",
				headers: { ...bearer(token), "Content-Type": "application/json" },
				body: JSON.stringify({ query }),
				signal,
			});
			if (!response.ok) return null;
			return (await response.json()) as QueryPreview;
		});
	} catch {
		return null;
	}
}

export type CreatedAutoPlaylist =
	| { ok: true; playlist: PlaylistAnnotation }
	| { ok: false; message: string };

/** Create one. The component hands it to foobar2000's own autoplaylist client, so the player keeps it filled and keeps it after the component is uninstalled. */
export async function createAutoPlaylist(
	origin: string,
	token: string,
	request: AutoPlaylistRequest,
): Promise<CreatedAutoPlaylist> {
	let response: Response;
	try {
		response = await withTimeout(WRITE_TIMEOUT_MS, (signal) =>
			fetch(`${origin}/api/autoplaylists`, {
				method: "POST",
				headers: { ...bearer(token), "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal,
			}),
		);
	} catch {
		return { ok: false, message: "Could not reach foo_jean." };
	}

	if (response.ok)
		return {
			ok: true,
			playlist: (await response.json()) as PlaylistAnnotation,
		};

	const { message } = await messageOf(response, `HTTP ${response.status}`);
	return { ok: false, message };
}

// Says that this device stopped on purpose, which is what tells a handoff from a dropped connection: both close the socket, and only this one should give the player its sound back now rather than after the component's linger.
// Best effort and never awaited for correctness — a tab that closes says nothing and is noticed a moment later anyway.
export function leaveStream(origin: string, token: string, deviceId: string) {
	void fetch(`${origin}/api/stream/leave`, {
		method: "POST",
		headers: { ...bearer(token), "Content-Type": "application/json" },
		body: JSON.stringify({ deviceId }),
	}).catch(() => {});
}

// ---- pairing -----------------------------------------------------------------

// Named for what the user has to do about it: the common failure is a window nobody opened.
export type PairFailure =
	// The message must name the menu path that opens the pairing window.
	| { ok: false; reason: "not-open"; message: string }
	// Reached from outside the LAN.
	| { ok: false; reason: "not-local"; message: string }
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unreachable"; message: string }
	| { ok: false; reason: "unsupported"; message: string };

export type PairResult = { ok: true; token: string } | PairFailure;

// Pairing is a write, so the caller must probe `/api/status` first and confirm this really is `foo_jean` before posting to the port a forgeable record named.
// `Content-Type: application/json` is what makes the request preflighted: the component refuses anything else, so no page can fire a simple POST blind and spend the single grant.
export async function pairWithAgent(
	origin: string,
	name: string,
): Promise<PairResult> {
	let response: Response;
	try {
		response = await withTimeout(PROBE_TIMEOUT_MS, (signal) =>
			fetch(`${origin}/api/pair`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(name ? { name } : {}),
				signal,
			}),
		);
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			message: "Could not reach foo_jean.",
		};
	}

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
	// 404 from this port means the build has no pair route, not that a track is missing.
	if (response.status === 404 || response.status === 415)
		return { ok: false, reason: "unsupported", message };

	return { ok: false, reason: "unreachable", message };
}
