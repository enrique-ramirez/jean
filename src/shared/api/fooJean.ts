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

const looksLikeRecord = (value: unknown): value is DiscoveryRecord =>
	typeof value === "object" &&
	value !== null &&
	(value as DiscoveryRecord).name === FOO_JEAN_ID &&
	typeof (value as DiscoveryRecord).port === "number";

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
