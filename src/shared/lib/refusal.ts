// An error whose message is meant to be read by the person who clicked, as
// against the `POST /api/... failed: 500` that most failures here carry.

const REFUSAL = Symbol.for("jean.refusal");

export const refusal = (message: string) =>
	Object.assign(new Error(message), { [REFUSAL]: true });

export const isRefusal = (error: unknown): error is Error =>
	error instanceof Error &&
	(error as unknown as Record<symbol, unknown>)[REFUSAL] === true;
