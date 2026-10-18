export type ReadFailureReason =
	| "notReady"
	| "undeclared"
	| "tooFast"
	| "refused"
	| "unavailable"
	| "unreachable"
	| "failed";

export interface ReadFailure {
	ok: false;
	reason: ReadFailureReason;
	detail: string;
	retryAfterMs: number | null;
}

export const readFailed = (
	reason: ReadFailureReason,
	detail = "",
	retryAfter: number | null = null,
): ReadFailure => ({ ok: false, reason, detail, retryAfterMs: retryAfter });
