import type { PlaybackMode } from "../../../src/shared/api/types.ts";
import { empty, json } from "../http.ts";
import { DETACHED_PLAYBACK_MODES } from "../sessions.ts";
import { NOT_BUILT, notFound, STRUCTURE_MOVED } from "./answers.ts";
import { delay } from "./latency.ts";
import { hasLibrarySnapshot } from "./library.ts";
import { orderIndexForMode, PLAYBACK_MODES } from "./playbackModes.ts";
import type { Asked } from "./request.ts";
import {
	declaresOnly,
	decodeSelection,
	FIELD_NOT_TAKEN,
	fillFailure,
	isNonNegInt,
	NOT_A_JSON_OBJECT,
} from "./requestBodies.ts";

const ENGINE_PLAYS_ROWS = {
	error: "the engine session plays a playlist row; name a detached session",
};

const MODE_NOT_OFFERED = {
	error: "this install does not offer that playback mode",
};

const LIBRARY_SET_FIELDS = ["structure", "runs", "bitset", "ordinals", "index"];

type ParsedLibrarySet =
	| { ok: true; ordinals: number[]; index: number }
	| { ok: false; status: number; body: unknown };

// A moved `structure` is answered before `index` is looked at, as `contract/openapi.yaml` orders it.
function parseLibrarySet(
	body: unknown,
	trackCount: number,
	expectedStructure: number,
): ParsedLibrarySet {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;

	if (!declaresOnly(record, LIBRARY_SET_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (!Number.isInteger(record.structure))
		return {
			ok: false,
			...fillFailure(400, "malformed request", "'structure' is required"),
		};

	if (record.structure !== expectedStructure)
		return { ok: false, status: 409, body: STRUCTURE_MOVED };

	const selection = decodeSelection(record, trackCount);
	if (!selection.ok) return selection;

	if (!isNonNegInt(record.index))
		return {
			ok: false,
			status: 400,
			body: { error: "'index' must be a whole number" },
		};

	if (record.index >= selection.ordinals.length)
		return { ok: false, ...fillFailure(400, "that position is past the end") };

	return { ok: true, ordinals: selection.ordinals, index: record.index };
}

const SEEK_FIELDS = ["seconds", "relativeSeconds"] as const;

type ParsedSeek =
	| { ok: true; seconds?: number; relativeSeconds?: number }
	| { ok: false; status: number; body: { error: string; detail: string } };

function parseSeek(body: unknown): ParsedSeek {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable seek", detail: NOT_A_JSON_OBJECT },
		};

	const record = body as Record<string, unknown>;
	const stray = Object.keys(record).find(
		(key) => !SEEK_FIELDS.includes(key as (typeof SEEK_FIELDS)[number]),
	);
	if (stray)
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable seek", detail: FIELD_NOT_TAKEN },
		};

	const forms = SEEK_FIELDS.filter((key) => record[key] !== undefined);
	if (forms.length !== 1)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail:
					forms.length === 0
						? "send exactly one of 'seconds' and 'relativeSeconds'"
						: "'seconds' and 'relativeSeconds' were both present; send exactly one",
			},
		};

	const [field] = forms;
	if (typeof record[field] !== "number")
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: `'${field}' must be a number`,
			},
		};

	const value = record[field] as number;
	if (!Number.isFinite(value))
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: `'${field}' must be a number this can hold`,
			},
		};

	if (field === "seconds" && value < 0)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: "'seconds' must not be negative",
			},
		};

	return field === "seconds"
		? { ok: true, seconds: value }
		: { ok: true, relativeSeconds: value };
}

const VOLUME_FIELDS = ["value", "step", "muted"] as const;

type ParsedVolume =
	| { ok: true; value?: number; step?: "up" | "down"; muted?: boolean }
	| { ok: false; status: number; body: { error: string; detail: string } };

function parseVolume(
	body: unknown,
	range: { min: number; max: number },
): ParsedVolume {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable volume", detail: NOT_A_JSON_OBJECT },
		};

	const record = body as Record<string, unknown>;
	const stray = Object.keys(record).find(
		(key) => !VOLUME_FIELDS.includes(key as (typeof VOLUME_FIELDS)[number]),
	);
	if (stray)
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable volume", detail: FIELD_NOT_TAKEN },
		};

	const forms = VOLUME_FIELDS.filter((key) => record[key] !== undefined);
	if (forms.length !== 1)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable volume",
				detail: "send exactly one of 'value', 'step' and 'muted'",
			},
		};

	const [field] = forms;
	if (field === "value") {
		if (typeof record.value !== "number")
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'value' must be a number",
				},
			};
		if (!Number.isFinite(record.value))
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'value' must be a number this can hold",
				},
			};
		if (record.value < range.min || record.value > range.max)
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: `'value' must be between ${range.min} and ${range.max}`,
				},
			};
		return { ok: true, value: record.value };
	}
	if (field === "step") {
		if (record.step !== "up" && record.step !== "down")
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'step' must be 'up' or 'down'",
				},
			};
		return { ok: true, step: record.step };
	}
	if (typeof record.muted !== "boolean")
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable volume",
				detail: "'muted' must be a boolean",
			},
		};
	return { ok: true, muted: record.muted };
}

export async function handlePlayback({
	state,
	fake,
	method,
	path,
	body,
	response,
	session,
	addressed,
}: Asked) {
	if (method === "POST" && path === "/api/playback/play") {
		if (!session) return json(response, ENGINE_PLAYS_ROWS, 409);
		if (!fake.canReadLibrary)
			return json(
				response,
				{ error: "the media library is not available" },
				503,
			);
		if (!hasLibrarySnapshot(state)) return json(response, NOT_BUILT, 503);

		const parsed = parseLibrarySet(
			body,
			state.libraryTracks.length,
			state.libraryFeed.structure,
		);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		const ordered = state.ordinalOrder();
		session.play(
			parsed.ordinals.map((ordinal) => ordered[ordinal].track),
			parsed.index,
		);
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/play-pause") {
		if (state.latency > 0) await delay(state.latency);
		addressed.playPause();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/next") {
		if (state.latency > 0) await delay(state.latency);
		addressed.next();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/previous") {
		if (state.latency > 0) await delay(state.latency);
		addressed.previous();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/stop") {
		if (state.latency > 0) await delay(state.latency);
		addressed.stop();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/seek") {
		if (state.latency > 0) await delay(state.latency);
		const parsed = parseSeek(body);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);
		if (session) session.seek(parsed);
		else
			state.patchPlayer(
				parsed.seconds !== undefined
					? { position: parsed.seconds }
					: { relativePosition: parsed.relativeSeconds },
			);
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/mode") {
		if (state.latency > 0) await delay(state.latency);
		if (typeof body !== "object" || body === null || Array.isArray(body))
			return json(
				response,
				{ error: "unacceptable mode", detail: NOT_A_JSON_OBJECT },
				400,
			);

		const record = body as Record<string, unknown>;
		const stray = Object.keys(record).find((key) => key !== "mode");
		if (stray)
			return json(
				response,
				{ error: "unacceptable mode", detail: FIELD_NOT_TAKEN },
				400,
			);

		if (typeof record.mode !== "string")
			return json(
				response,
				{
					error: "unacceptable mode",
					detail: "'mode' is required and must be a string",
				},
				400,
			);

		if (!PLAYBACK_MODES.has(record.mode as PlaybackMode))
			return json(
				response,
				{
					error: "unacceptable mode",
					detail: `'${record.mode}' is not a playback mode this API knows`,
				},
				400,
			);

		const mode = record.mode as PlaybackMode;
		if (session) {
			if (!DETACHED_PLAYBACK_MODES.includes(mode))
				return json(response, MODE_NOT_OFFERED, 409);
			session.setMode(mode);
			return empty(response);
		}

		const index = orderIndexForMode(state, mode);
		if (index === null) return json(response, MODE_NOT_OFFERED, 409);

		state.patchPlayer({ options: [{ id: "playbackOrder", value: index }] });
		return empty(response);
	}

	if (method === "POST" && path === "/api/volume") {
		if (state.latency > 0) await delay(state.latency);
		const parsed = parseVolume(body, {
			min: state.player.volume.min,
			max: state.player.volume.max,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);
		if (parsed.value !== undefined) state.patchPlayer({ volume: parsed.value });
		else if (parsed.step !== undefined)
			state.nudgeVolume(parsed.step === "up" ? 1 : -1);
		else state.patchPlayer({ isMuted: parsed.muted });
		return empty(response);
	}

	return notFound(response);
}
