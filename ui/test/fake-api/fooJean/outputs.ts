import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { empty, json } from "../http.ts";
import { ASK_EVERY_TIME, notFound, PLAYER_REFUSED } from "./answers.ts";
import type { Asked } from "./request.ts";
import { FIELD_NOT_TAKEN, NOT_A_JSON_OBJECT } from "./requestBodies.ts";

// foobar2000's Null Output is an output module of its own, and `foo_jean` reads the module half of
// the pair rather than the device half: every device under it plays into nothing. Left out of the
// default list, so a spec that wants a player nobody can hear names it.
const NULL_OUTPUT_MODULE = "EEEB07DE-C2C8-44C2-985C-C85856D96DA1";

export const NULL_OUTPUT_DEVICE = {
	id: `${NULL_OUTPUT_MODULE}:5243F9AD-C84F-4723-8194-0788FC021BCC`,
	name: "Null Output",
};

export const isSilentOutput = (deviceId: string) =>
	deviceId.startsWith(`${NULL_OUTPUT_MODULE}:`);

// Word for word what `core/outputs.cpp` describes for `changeOutput`.
const OUTPUT_CHANGE_DISABLED = {
	error:
		"this install has output device changes turned off; turn on changeOutput in config.json to allow them",
	detail: "",
} satisfies components["schemas"]["PlaylistFailed"];

const OUTPUT_DEVICE_NOT_LISTED = {
	error: "the player does not list that output device; read the outputs again",
	detail: "",
} satisfies components["schemas"]["PlaylistFailed"];

const OUTPUT_FIELDS = ["deviceId"] as const;

type ParsedActiveOutput =
	| { ok: true; deviceId: string }
	| { ok: false; status: number; body: { error: string; detail: string } };

// Mirrors core/api.cpp's parseActiveOutput: never throws, and `declaresOnly` refuses a field the
// schema does not declare.
function parseActiveOutput(body: unknown): ParsedActiveOutput {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable output device", detail: NOT_A_JSON_OBJECT },
		};

	const record = body as Record<string, unknown>;
	const stray = Object.keys(record).find(
		(key) => !OUTPUT_FIELDS.includes(key as (typeof OUTPUT_FIELDS)[number]),
	);
	if (stray)
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable output device", detail: FIELD_NOT_TAKEN },
		};

	if (typeof record.deviceId !== "string")
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable output device",
				detail: "'deviceId' is required and must be a string",
			},
		};

	return { ok: true, deviceId: record.deviceId };
}

export function handleOutputs({
	state,
	fake,
	method,
	path,
	body,
	response,
}: Asked) {
	// `changeOutput` alone gates the switch, never `controlPlayback`: outside `needsPlaybackControl`
	// on purpose, and `GET /api/outputs` is not gated at all.
	if (method === "GET" && path === "/api/outputs") {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		const active = fake.outputDevices.some(
			(device) => device.id === fake.activeOutput,
		)
			? fake.activeOutput
			: null;
		return json(response, { devices: fake.outputDevices, active });
	}

	if (method === "POST" && path === "/api/outputs/active") {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		if (!fake.canChangeOutput)
			return json(response, OUTPUT_CHANGE_DISABLED, 403);

		const parsed = parseActiveOutput(body);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (fake.outputSwitchRefusal === 500)
			return json(response, PLAYER_REFUSED, 500);
		if (
			fake.outputSwitchRefusal === 409 ||
			!fake.outputDevices.some((device) => device.id === parsed.deviceId)
		)
			return json(response, OUTPUT_DEVICE_NOT_LISTED, 409);

		state.setActiveOutput(parsed.deviceId);
		return empty(response);
	}

	return notFound(response);
}
