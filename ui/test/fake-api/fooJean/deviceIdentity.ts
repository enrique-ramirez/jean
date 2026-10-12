import type { SessionDevice } from "../sessions.ts";

const MAX_LABEL_BYTES = 64;

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

// `sanitised` in `foo_jean`'s `core/device.cpp`: spaces and tabs trimmed, and a label too long or
// holding an unprintable character reads as none.
export const labelOf = (value: unknown): string => {
	if (typeof value !== "string") return "";
	const trimmed = value.replace(/^[ \t]+|[ \t]+$/g, "");
	return bytesOf(trimmed) > MAX_LABEL_BYTES || /\p{Cc}/u.test(trimmed)
		? ""
		: trimmed;
};

type IdentityRead =
	| { ok: true; device: SessionDevice }
	| { ok: false; refusal: string };

// `parseDeviceIdentity` in `foo_jean`'s `core/device.cpp`: a field of the wrong type or too long
// refuses the request, where an empty or unprintable one only reads as none.
export const readDeviceIdentity = (body: unknown): IdentityRead => {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return { ok: false, refusal: "body is not a JSON object" };
	const { deviceId = "", name = "" } = body as Record<string, unknown>;
	if (typeof deviceId !== "string" || typeof name !== "string")
		return { ok: false, refusal: "deviceId and name must be text" };
	for (const [field, value] of [
		["deviceId", deviceId],
		["name", name],
	])
		if (bytesOf(value) > MAX_LABEL_BYTES)
			return {
				ok: false,
				refusal: `${field} may be at most ${MAX_LABEL_BYTES} characters`,
			};
	return {
		ok: true,
		device: { deviceId: labelOf(deviceId), name: labelOf(name) || null },
	};
};

export const ANONYMOUS: IdentityRead = {
	ok: true,
	device: { deviceId: "", name: null },
};
