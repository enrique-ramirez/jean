import type { components } from "./fooJeanSchema";

// `foo_jean`, the optional component that writes tags. Types are generated from
// its OpenAPI document; regenerating and the reason for the file's name are in
// `shared/api/CLAUDE.md`.
//
// The discovery record comes from beefweb, same origin. Everything else comes
// from the component, on its own port, cross-origin, with a bearer token.

type Schema = components["schemas"];

export type DiscoveryRecord = Schema["DiscoveryRecord"];
export type FooJeanStatus = Schema["Status"];
export type FooJeanCapabilities = Schema["Capabilities"];
export type TagWriteRequest = Schema["TagWriteRequest"];
export type TagWritten = Schema["TagWritten"];
export type StreamTicket = Schema["StreamTicket"];
export type StreamTimeline = Schema["StreamTimeline"];
export type StreamMark = StreamTimeline["marks"][number];
export type Paired = Schema["Paired"];

// **The one setting that may never move to `/api/clientconfig`.** beefweb serves
// that namespace unauthenticated, so syncing this through it would recreate the
// exact escalation the credential exists to prevent. It lives here rather than
// beside one of its readers because there are now two, in two tiers that may not
// import each other: tag writing and listening.
export const TOKEN_KEY = "jean.fooJeanToken";

// The component owns this clientconfig id and rewrites it on every start, so
// Jean's own settings may never be stored under it.
export const FOO_JEAN_ID = "foo_jean";

// The component's own version moves independently and is informational; this is
// the number to refuse on.
export const SUPPORTED_API_VERSION = 1;

const PROBE_TIMEOUT_MS = 4000;
// Past the component's own 30s player timeout, so anything longer is the network.
const WRITE_TIMEOUT_MS = 35_000;

// The component's own port on the machine beefweb is running on. That is the
// page's own host in a build -- beefweb serves Jean -- and *not* on the dev
// server, which serves it from a developer's machine and proxies `/api` to the
// player. `__PLAYER_HOST__` is how the second case is told apart; see
// `vite.config.ts` and CONTRIBUTING.md.
//
// Jean's protocol rather than a hardcoded `http:`, so this still works if TLS is
// ever terminated in front of both.
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

// The port is the one field of this record that becomes a URL, and the record is
// writable by anyone who can reach beefweb -- so it is bounded here, at the only
// place that decides a record is a record. A number cannot smuggle a `/` or an
// `@` past `originOfPort`, so this is not what stops a forged host; it is so
// that a record this file accepts is one the rest of the file can rely on.
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

// `null` is "not installed", the common case, and not an error.
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
	// Something answered and it is not the component, which is what a forged
	// discovery record looks like from here.
	| { ok: false; reason: "impostor" }
	| { ok: false; reason: "unsupported"; apiVersion: number };

// Unauthenticated, and must stay so: this is what makes the advertised port safe
// to send a credential to.
export async function probeStatus(origin: string): Promise<ProbeResult> {
	const body = await withTimeout(PROBE_TIMEOUT_MS, async (signal) => {
		const response = await fetch(`${origin}/api/status`, { signal });
		if (!response.ok) return null;
		return (await response.json()) as unknown;
	}).catch(() => undefined);

	// `undefined` is a refused connection, a CORS rejection or a timeout; `null`
	// is an answer that was not a 200.
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

// Named for what a caller has to decide -- retry, roll back, stop offering the
// control -- which cuts across the HTTP statuses.
export type WriteFailure =
	| { ok: false; reason: "not-allowed"; field: string | null; message: string }
	| { ok: false; reason: "unknown-track"; message: string }
	// The write may still land. Never rolled back; see `domain/track/CLAUDE.md`.
	| { ok: false; reason: "timeout"; message: string }
	| { ok: false; reason: "unauthorized"; message: string }
	| { ok: false; reason: "refused"; message: string }
	| { ok: false; reason: "failed"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type WriteResult = { ok: true; written: TagWritten } | WriteFailure;

// Branches on the status, never on `written`: 401 and 413 are refused before the
// route is reached and do not carry it.
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

// What Jean found, which is not the same as what it can do. This is the whole
// list, and **nothing here is a silent state**: five of these are a component
// that is installed and running, and in three the user has done everything
// right. `features/settings/` holds one message and one remedy per state.
//
// It lives here rather than beside either seam because there are two of them --
// tag writing in `domain/track`, listening in `domain/player` -- in tiers that
// may not import each other, and re-running the probe once per seam would send
// two requests to answer one question.
export type FooJeanState =
	| { kind: "absent" }
	| {
			kind: "not-listening";
			record: DiscoveryRecord;
			// The component's own words, safe to show.
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
	// **Non-null exactly when the probe succeeded**, which makes it the proof rather
	// than a convenience: a caller holding an origin is holding a port that answered
	// `/api/status` as `foo_jean` at a version this build understands. Pairing needs
	// that and has no token yet, so it cannot be gated on `ready`.
	origin: string | null;
	// Only when there is one, and only when the component accepted it.
	token: string | null;
}

// **The order is the security model**: read the hint, prove the port with an
// unauthenticated call, and only then attach the token. Skipping the middle step
// hands a credential to whoever forged the record.
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
	// The port is proven from here on, so the origin travels with every state below it.
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

// Named for what a caller has to decide, as the write failures above are: retry
// later, try a different codec, or stop offering the control.
export type TicketFailure =
	// Serving as many listeners as `maxConcurrentStreams` allows. Retryable, and
	// it MUST read as "busy" rather than "not supported".
	| { ok: false; reason: "busy"; message: string }
	// This install does not stream at all.
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unauthorized"; message: string }
	| { ok: false; reason: "unreachable"; message: string };

export type TicketResult = { ok: true; ticket: StreamTicket } | TicketFailure;

// The component distinguishes "does not stream" from "too many listeners" in the
// `error` string alone -- both are 503 -- and the two want opposite responses.
const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

// Asked for immediately before connecting and never stored: it is a capability
// URL for as long as it lives. **Not single-use** -- Safari sends a
// `Range: bytes=0-1` probe before fetching for real, so one playback start is
// two requests -- but a reconnect still takes a fresh one.
export async function issueStreamTicket(
	origin: string,
	token: string,
): Promise<TicketResult> {
	let response: Response;
	try {
		response = await withTimeout(PROBE_TIMEOUT_MS, (signal) =>
			fetch(`${origin}/api/stream/ticket`, {
				method: "POST",
				headers: bearer(token),
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

// **The ticket travels in the query string and the bearer token never does.** An
// `<audio>` element cannot send a header, which is the whole reason the ticket
// exists; putting the token here instead would publish it to every proxy log
// between here and the player.
export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

// `null` rather than a failure shape: a timeline that does not answer costs the
// progress correction and nothing else, and the caller's remedy is to keep the
// anchor it already has.
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

// ---- pairing -----------------------------------------------------------------

// Named for what the user has to do about it, which is the whole point: the common
// failure is a window nobody opened, and that is a button to press rather than an error.
export type PairFailure =
	// By far the most common, and the message MUST name the menu path.
	| { ok: false; reason: "not-open"; message: string }
	// Reached from outside the LAN. No amount of pressing fixes this one.
	| { ok: false; reason: "not-local"; message: string }
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unreachable"; message: string }
	| { ok: false; reason: "unsupported"; message: string };

export type PairResult = { ok: true; token: string } | PairFailure;

// **Pairing is a write, so it follows the same rule as sending the token**: the caller
// probes `/api/status` first and confirms this really is `foo_jean` before posting
// anything to the port a forgeable record named. See the root CLAUDE.md.
//
// `Content-Type: application/json` is not decoration -- the component refuses anything
// else, because a simple POST needs no CORS preflight and could be fired blind by a page
// to spend the single grant. Sending it is what makes this request preflighted.
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
				// Optional, and it stays optional: requiring a name would put back the
				// typing this exists to remove.
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

	// The component distinguishes the two 403s in the error string on purpose: one is a
	// button, the other is a network.
	if (response.status === 403)
		return /local network/i.test(message)
			? { ok: false, reason: "not-local", message }
			: { ok: false, reason: "not-open", message };
	if (response.status === 429) return { ok: false, reason: "busy", message };
	// A component too old to have the route at all. 404 from this port is not "no such
	// track", it is "this build cannot pair".
	if (response.status === 404 || response.status === 415)
		return { ok: false, reason: "unsupported", message };

	return { ok: false, reason: "unreachable", message };
}
