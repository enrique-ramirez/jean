import { empty, json } from "../http.ts";
import { NOT_BUILT, notFound, STRUCTURE_MOVED } from "./answers.ts";
import { delay } from "./latency.ts";
import { rolesAsked } from "./library.ts";
import { LIBRARY_ROLE_NAMES } from "./librarySummary.ts";
import { coversFor, settleCovers } from "./playlistCovers.ts";
import type { Asked, FakeState } from "./request.ts";
import {
	declaresOnly,
	decodeSelection,
	type FillFailure,
	fillFailure,
	GUID_PATTERN,
	isDecimal,
	isNonNegInt,
} from "./requestBodies.ts";

type QueuedRead = ReturnType<FakeState["queuedEntries"]>[number];

const QUEUE_PARAMETERS = ["session", "deviceId"];

const SESSION_QUEUE_LIMIT = 10_000;

const SESSION_QUEUE_FULL = { error: "the session's queue is full" };

type ParsedQueuePosition =
	| { ok: true; at?: { index: number; revision: number } }
	| ({ ok: false } & FillFailure);

function parseQueuePosition(
	record: Record<string, unknown>,
): ParsedQueuePosition {
	if (record.at === undefined) return { ok: true, at: undefined };

	if (!isNonNegInt(record.at))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'at' must be a non-negative integer",
			),
		};
	if (!isNonNegInt(record.revision))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'at' requires 'revision'",
			),
		};

	return { ok: true, at: { index: record.at, revision: record.revision } };
}

// Exactly the fields contract/openapi.yaml declares for each request body below,
// `additionalProperties: false` there; `declaresOnly` refuses anything else, mirroring
// core/api.cpp's own `declaresOnly` and its three field lists.
const QUEUE_ROWS_FIELDS = ["playlistId", "positions", "at", "revision"];
const QUEUE_TRACKS_FIELDS = [
	"structure",
	"runs",
	"bitset",
	"ordinals",
	"at",
	"revision",
];
const MOVE_QUEUE_FIELDS = ["from", "to", "revision"];

type ParsedQueueRows =
	| {
			ok: true;
			playlistId: string;
			positions: number[];
			at?: { index: number; revision: number };
	  }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseQueueRows: the same refusals, checked before the store is
// touched, so a fake refusal never queues anything either.
function parseQueueRows(body: unknown): ParsedQueueRows {
	if (typeof body !== "object" || body === null)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;

	if (!declaresOnly(record, QUEUE_ROWS_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (
		typeof record.playlistId !== "string" ||
		!GUID_PATTERN.test(record.playlistId)
	)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable playlist id",
				"'playlistId' must be a playlist id this component issued",
			),
		};

	const positions = record.positions;
	if (
		!Array.isArray(positions) ||
		positions.length === 0 ||
		!positions.every(isNonNegInt)
	)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'positions' must be a non-empty list of non-negative integers",
			),
		};

	const position = parseQueuePosition(record);
	if (!position.ok) return position;

	return {
		ok: true,
		playlistId: record.playlistId,
		positions,
		at: position.at,
	};
}

type ParsedQueueTracks =
	| {
			ok: true;
			structure: number;
			ordinals: number[];
			at?: { index: number; revision: number };
	  }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseQueueTracks.
function parseQueueTracks(
	body: unknown,
	trackCount: number,
	expectedStructure: number,
): ParsedQueueTracks {
	if (typeof body !== "object" || body === null)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;

	if (!declaresOnly(record, QUEUE_TRACKS_FIELDS))
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
	if (selection.ordinals.length === 0)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"the selection must not be empty",
			),
		};

	const position = parseQueuePosition(record);
	if (!position.ok) return position;

	return {
		ok: true,
		structure: record.structure as number,
		ordinals: selection.ordinals,
		at: position.at,
	};
}

const QUEUE_MOVED = {
	error: "the queue changed since that revision; read it again",
	detail: "",
};

type ParsedMoveQueue =
	| { ok: true; from: number; to: number; revision: number }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseMoveQueue.
function parseMoveQueue(body: unknown): ParsedMoveQueue {
	if (typeof body !== "object" || body === null)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;

	if (!declaresOnly(record, MOVE_QUEUE_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (!isNonNegInt(record.from))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'from' is required"),
		};
	if (!isNonNegInt(record.to))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'to' is required"),
		};
	if (!isNonNegInt(record.revision))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'revision' is required"),
		};

	return {
		ok: true,
		from: record.from,
		to: record.to,
		revision: record.revision,
	};
}

type ParsedRemoveQueue =
	| { ok: true; index: number; revision: number }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseRemoveQueue: the index arrives as a URL segment and the
// revision as a query parameter, so neither ever throws on a client's typo.
function parseRemoveQueue(
	indexText: string,
	revisionText: string | null,
): ParsedRemoveQueue {
	if (!isDecimal(indexText))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"the queue index must be a whole number",
			),
		};

	if (revisionText === null || !isDecimal(revisionText))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'revision' is required"),
		};

	return { ok: true, index: Number(indexText), revision: Number(revisionText) };
}

type QueueSource = "rows" | "tracks" | "invalid";

// Mirrors core/api.cpp's queueSourceOf.
function queueSourceOf(body: unknown): QueueSource {
	if (typeof body !== "object" || body === null) return "invalid";

	const record = body as Record<string, unknown>;
	const namesRows =
		record.playlistId !== undefined || record.positions !== undefined;
	const namesTracks =
		record.structure !== undefined ||
		record.ordinals !== undefined ||
		record.runs !== undefined ||
		record.bitset !== undefined;

	if (namesRows === namesTracks) return "invalid";
	return namesRows ? "rows" : "tracks";
}

// One row of `GET /api/queue`, read through the entry's handle. A missing tag is
// an empty string, and a position the player has lost is no position at all.
const queuedTrackOf = (
	state: FakeState,
	entry: QueuedRead,
	coverOf: ReturnType<typeof coversFor>,
) => {
	const playlist = entry.playlistId
		? state.playlistById(entry.playlistId)
		: null;
	const value = (field: string) => String(entry.track[field] ?? "");
	return {
		title: value("%title%"),
		artist: value("%artist%"),
		duration: Number(entry.track["%length_seconds%"]) || 0,
		album: value("%album%"),
		albumArtist: value("%album artist%"),
		libraryPath: state.libraryPathFor(entry.track),
		location:
			playlist && entry.index >= 0
				? { playlistId: playlist.guid, index: entry.index }
				: null,
		...(coverOf ? { cover: coverOf(entry.track) } : null),
	};
};

export async function handleQueue({
	state,
	fake,
	method,
	path,
	url,
	body,
	response,
	session,
	addressed,
}: Asked) {
	if (fake.failQueue && method !== "GET") {
		if (fake.failQueue === 429) response.setHeader("Retry-After", "1");
		return json(
			response,
			{ error: "the queue could not be changed", detail: "" },
			fake.failQueue,
		);
	}

	// How a queue mutation the player has already carried out is answered: at once,
	// or refused once `loseQueueAnswer` has passed, which is a client being told the
	// change failed after the queue moved.
	const queueChanged = async () => {
		if (fake.loseQueueAnswer === null) return empty(response);
		await delay(fake.loseQueueAnswer);
		return json(
			response,
			{ error: "the queue changed and the answer went missing", detail: "" },
			500,
		);
	};

	const overfills = (count: number) =>
		session !== null &&
		session.queuedEntries().length + count > SESSION_QUEUE_LIMIT;

	if (path === "/api/queue") {
		if (method === "GET") {
			const roles = rolesAsked(url, LIBRARY_ROLE_NAMES, QUEUE_PARAMETERS);
			if (!(roles instanceof Map)) return json(response, roles, 400);

			if (state.latency > 0) await delay(state.latency);
			await settleCovers(state, roles);
			const coverOf = coversFor(state, roles);
			return json(response, {
				revision: addressed.queueRevision,
				entries: addressed
					.queuedEntries()
					.map((entry) => queuedTrackOf(state, entry, coverOf)),
			});
		}

		if (method === "POST") {
			const source = queueSourceOf(body);
			if (source === "invalid")
				return json(
					response,
					{
						error: "malformed request",
						detail:
							"the body must name exactly one of a playlist's rows or the library's tracks",
					},
					400,
				);

			if (source === "rows") {
				const parsed = parseQueueRows(body);
				if (!parsed.ok) return json(response, parsed.body, parsed.status);

				// Judged by the route before the player is involved, which is why a
				// stale revision outranks an unknown playlist.
				if (parsed.at && parsed.at.revision !== addressed.queueRevision)
					return json(response, QUEUE_MOVED, 409);

				const playlist = state.playlistByGuid(parsed.playlistId);
				if (!playlist)
					return json(response, { error: "no such playlist", detail: "" }, 404);

				const pastEnd = parsed.positions.find(
					(position) => position >= playlist.items.length,
				);
				if (
					pastEnd !== undefined ||
					(parsed.at && parsed.at.index > addressed.queuedEntries().length)
				)
					return json(
						response,
						{ error: "that position is past the end", detail: "" },
						400,
					);

				if (overfills(parsed.positions.length))
					return json(response, SESSION_QUEUE_FULL, 409);

				addressed.queueInsert(
					parsed.positions.map((position) => ({
						playlistId: playlist.id,
						track: playlist.items[position],
					})),
					parsed.at?.index,
				);
				return queueChanged();
			}

			if (!fake.canReadLibrary)
				return json(
					response,
					{ error: "the media library is not available" },
					503,
				);
			if (state.libraryFeed.columns.length === 0)
				return json(response, NOT_BUILT, 503);

			const parsed = parseQueueTracks(
				body,
				state.libraryTracks.length,
				state.libraryFeed.structure,
			);
			if (!parsed.ok) return json(response, parsed.body, parsed.status);

			if (parsed.at && parsed.at.revision !== addressed.queueRevision)
				return json(response, QUEUE_MOVED, 409);

			if (parsed.at && parsed.at.index > addressed.queuedEntries().length)
				return json(
					response,
					{ error: "that position is past the end", detail: "" },
					400,
				);

			if (overfills(parsed.ordinals.length))
				return json(response, SESSION_QUEUE_FULL, 409);

			const ordered = state.ordinalOrder();
			addressed.queueInsert(
				parsed.ordinals.map((ordinal) => ({
					playlistId: null,
					track: ordered[ordinal].track,
				})),
				parsed.at?.index,
			);
			return queueChanged();
		}

		if (method === "DELETE") {
			if (state.latency > 0) await delay(state.latency);
			addressed.queueClear();
			return queueChanged();
		}

		return notFound(response);
	}

	if (path === "/api/queue/move" && method === "POST") {
		const parsed = parseMoveQueue(body);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.revision !== addressed.queueRevision)
			return json(response, QUEUE_MOVED, 409);

		const length = addressed.queuedEntries().length;
		if (parsed.from >= length || parsed.to >= length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		addressed.queueMove(parsed.from, parsed.to);
		return queueChanged();
	}

	const queueEntryMatch = /^\/api\/queue\/([^/]+)$/.exec(path);
	if (method === "DELETE" && queueEntryMatch) {
		const parsed = parseRemoveQueue(
			queueEntryMatch[1],
			url.searchParams.get("revision"),
		);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.revision !== addressed.queueRevision)
			return json(response, QUEUE_MOVED, 409);

		if (parsed.index >= addressed.queuedEntries().length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		addressed.queueRemoveAt(parsed.index);
		return queueChanged();
	}

	return notFound(response);
}
