import createClient from "openapi-fetch";
import { translate } from "@/shared/i18n/locale";
import type { components, paths } from "./fooJeanSchema";

export type Schema = components["schemas"];

export const PROBE_TIMEOUT_MS = 4000;
export const WRITE_TIMEOUT_MS = 35_000;
// A read behind a visible panel is not sized for foobar2000 writing tags to disk.
export const READ_TIMEOUT_MS = 8_000;

export const unreachable = () => translate("fooJean.unreachable.summary");

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

// Seconds, per RFC 9110. The date form is legal and foo_jean does not send it.
export const retryAfterMs = (response: Response) => {
	const seconds = Number(response.headers.get("Retry-After"));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

// foo_jean always sends `Retry-After: 1` when it refuses a preview or a one-track read; this is
// the fallback for the header ever being missing.
const TOO_FAST_WAIT_MS = 1_000;
const TOO_FAST_RETRIES = 3;

export type Failure =
	| { ok: false; reason: "unreachable"; message: string }
	| ({ ok: false; reason: "refused"; retryInMs: number | null } & Refusal);

export type Result<T> = { ok: true; value: T } | Failure;

export async function settle<T>(
	answer: Promise<Answer<T>>,
	signal?: AbortSignal,
): Promise<Result<T>> {
	const answered = await reach(answer, signal);
	if (!answered)
		return { ok: false, reason: "unreachable", message: unreachable() };

	const { data, error, response } = answered;
	if (response.ok) return { ok: true, value: data as T };
	return {
		ok: false,
		reason: "refused",
		...refusalOf(response, error),
		retryInMs:
			response.status === 429
				? (retryAfterMs(response) ?? TOO_FAST_WAIT_MS)
				: null,
	};
}

export const askResult = <T>(
	origin: string,
	timeoutMs: number,
	call: Call<Answer<T>>,
	signal?: AbortSignal,
) => settle(ask(origin, timeoutMs, call, signal), signal);

export class FooJeanFailed extends Error {
	readonly failure: Failure;

	constructor(failure: Failure) {
		super(failure.message);
		this.failure = failure;
	}
}

/** How a caller that has to throw, such as a React Query function, turns a failure into one. */
export function orThrow<T>(result: Result<T>): T {
	if (result.ok) return result.value;
	throw new FooJeanFailed(result);
}

export const refusedStatusOf = (error: unknown) =>
	error instanceof FooJeanFailed && error.failure.reason === "refused"
		? error.failure.status
		: null;

export type SwitchRefusal = "playbackDisabled" | "writesDisabled";

// Word for word what the component's `core/failures.cpp` answers for each switch.
const REFUSAL_MESSAGE = {
	playbackDisabled:
		"this install has playback control turned off; turn on controlPlayback in config.json to allow it",
	writesDisabled:
		"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them",
} satisfies Record<SwitchRefusal, Schema["PlaylistFailed"]["error"]>;

export const switchRefusalIn = (said: string): SwitchRefusal | null =>
	(Object.keys(REFUSAL_MESSAGE) as SwitchRefusal[]).find(
		(refusal) => said === REFUSAL_MESSAGE[refusal],
	) ?? null;

export function switchRefusalOf(failure: Failure): SwitchRefusal | null {
	if (failure.reason !== "refused" || failure.status !== 403) return null;
	return switchRefusalIn(failure.error);
}

export const switchRefusalThrown = (error: unknown) =>
	error instanceof FooJeanFailed ? switchRefusalOf(error.failure) : null;

const tooFastWaitOf = (error: Error) =>
	error instanceof FooJeanFailed && error.failure.reason === "refused"
		? error.failure.retryInMs
		: null;

export const retryWhenTooFast = ({ otherFailures = 0 } = {}) => ({
	retry: (count: number, error: Error) =>
		count < (tooFastWaitOf(error) === null ? otherFailures : TOO_FAST_RETRIES),
	retryDelay: (_: number, error: Error) => tooFastWaitOf(error) ?? 0,
});
