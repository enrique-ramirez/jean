export const textOf = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

export const fieldsOf = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
