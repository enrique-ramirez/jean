import createClient from "openapi-fetch";
import type { components, paths } from "./fooJeanSchema";

export type Schema = components["schemas"];

export const PROBE_TIMEOUT_MS = 4000;
export const WRITE_TIMEOUT_MS = 35_000;
// A read behind a visible panel is not sized for foobar2000 writing tags to disk.
export const READ_TIMEOUT_MS = 8_000;

export const UNREACHABLE = "Could not reach foo_jean.";

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

// openapi-fetch keeps the `fetch` it was created with, so reading the global per call is what lets a
// test replace it.
const api = createClient<paths>({
	fetch: (request) => globalThis.fetch(request),
});

export type Call<T> = (
	client: typeof api,
	init: { baseUrl: string; signal: AbortSignal },
) => Promise<T>;

export interface Answer<T> {
	data?: T;
	error?: unknown;
	response: Response;
}

/** Resolves with whatever status foo_jean answered, and throws only when nothing answered. */
export const ask = <T>(
	origin: string,
	timeoutMs: number,
	call: Call<T>,
	outer?: AbortSignal,
): Promise<T> =>
	withTimeout(
		timeoutMs,
		(signal) => call(api, { baseUrl: `${origin}/api`, signal }),
		outer,
	);

export async function reach<T>(
	answer: Promise<T>,
	signal?: AbortSignal,
): Promise<T | null> {
	try {
		return await answer;
	} catch (error) {
		if (signal?.aborted) throw error;
		return null;
	}
}

// foo_jean refuses a bodyless POST without a JSON content type, and openapi-fetch sets one only when
// there is a body.
export const BODYLESS_POST = { "Content-Type": "application/json" };

export interface Refusal {
	status: number;
	error: string;
	message: string;
	field: string | null;
}

export function refusalOf(response: Response, body: unknown): Refusal {
	const parsed =
		typeof body === "object" && body !== null
			? (body as { error?: string; detail?: string; field?: string })
			: null;
	if (!parsed?.error)
		return {
			status: response.status,
			error: "",
			message: `HTTP ${response.status}`,
			field: null,
		};
	return {
		status: response.status,
		error: parsed.error,
		message: parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error,
		field: parsed.field ?? null,
	};
}

export async function demand<T>(answer: Promise<Answer<T>>): Promise<T> {
	const { data, error, response } = await answer;
	if (response.ok) return data as T;
	const { message } = refusalOf(response, error);
	throw new Error(`${response.url} failed: ${response.status}: ${message}`, {
		cause: response.status,
	});
}

export async function orNull<T>(answer: Promise<Answer<T>>): Promise<T | null> {
	const answered = await reach(answer);
	return answered?.response.ok ? (answered.data ?? null) : null;
}

export type SwitchRefusal = "playbackDisabled" | "writesDisabled";

// Word for word what the component's `core/failures.cpp` answers for each switch.
const REFUSAL_MESSAGE = {
	playbackDisabled:
		"this install has playback control turned off; turn on controlPlayback in config.json to allow it",
	writesDisabled:
		"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them",
} satisfies Record<SwitchRefusal, Schema["PlaylistFailed"]["error"]>;

export const switchRefusalIn = (message: string): SwitchRefusal | null =>
	(Object.keys(REFUSAL_MESSAGE) as SwitchRefusal[]).find((refusal) =>
		message.includes(REFUSAL_MESSAGE[refusal]),
	) ?? null;

export function switchRefusalOf(error: unknown): SwitchRefusal | null {
	if (!(error instanceof Error) || error.cause !== 403) return null;
	return switchRefusalIn(error.message);
}

// Seconds, per RFC 9110. The date form is legal and foo_jean does not send it.
export const retryAfterMs = (response: Response) => {
	const seconds = Number(response.headers.get("Retry-After"));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

// foo_jean always sends `Retry-After: 1` when it refuses a preview or a one-track read; this is
// the fallback for the header ever being missing.
export const TOO_FAST_WAIT_MS = 1_000;
const TOO_FAST_RETRIES = 3;

export class TooFast extends Error {
	readonly retryInMs: number;

	constructor(retryInMs: number) {
		super("foo_jean refused a request as too fast");
		this.retryInMs = retryInMs;
	}
}

export const tooFast = (response: Response) =>
	new TooFast(retryAfterMs(response) ?? TOO_FAST_WAIT_MS);

export const retryWhenTooFast = ({ otherFailures = 0 } = {}) => ({
	retry: (count: number, error: Error) =>
		count < (error instanceof TooFast ? TOO_FAST_RETRIES : otherFailures),
	retryDelay: (_: number, error: Error) =>
		error instanceof TooFast ? error.retryInMs : 0,
});
