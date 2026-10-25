import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json } from "../http.ts";
import { UNRESOLVED } from "../jlib.ts";
import type { FakePlaylist, Track } from "../state.ts";
import { evaluate } from "../titleFormat.ts";
import { CHUNK, mapped, runYielding, type Sweep } from "../yielding.ts";
import { ASK_EVERY_TIME } from "./answers.ts";
import {
	answeredUnlessReady,
	hashOf,
	holdsTag,
	LIBRARY_UNAVAILABLE,
	offersGzip,
	questionAsked,
	rolesAsked,
	sendJson,
} from "./library.ts";
import { setSweep } from "./libraryQuestions.ts";
import { runsSweep } from "./libraryRuns.ts";
import { matchingRowsSweep } from "./librarySearch.ts";
import { figuresSweep, LIBRARY_ROLE_NAMES, playsOf } from "./librarySummary.ts";
import { ROWS_MOVED } from "./playlistRows.ts";
import { type Bucket, refuseTooFast, spend } from "./rateLimits.ts";
import type { Asked, FakeState } from "./request.ts";

type PlaylistRuns = components["schemas"]["PlaylistRuns"];

const READ_PATH = /^\/api\/playlists\/([^/]+)\/(runs|find)$/;

export const isPlaylistRead = (method: string, path: string) =>
	method === "GET" && READ_PATH.test(path);

const READS = {
	runs: {
		bucket: "playlistRuns" satisfies Bucket,
		question: { required: ["structure"], optional: [], flags: [] },
		roles: [
			"album",
			"albumArtist",
			"artist",
			"discNumber",
			"trackNumber",
			"duration",
			"year",
			"playCount",
			"playCountLocal",
		],
	},
	find: {
		bucket: "playlistSearches" satisfies Bucket,
		question: { required: ["query", "structure"], optional: [], flags: [] },
		roles: ["title", "artist", "albumArtist", "album", "artistSort"],
	},
} as const;

function* columnsOver<Name extends string>(
	state: FakeState,
	playlist: FakePlaylist,
	roles: Map<string, string>,
	names: readonly Name[],
): Sweep<Record<Name, string[]>> {
	const library = state.ordinalOrder();
	const libraryCopyOrOwn = (track: Track) => {
		const ordinal = state.libraryOrdinalFor(track);
		return ordinal === null ? track : library[ordinal].track;
	};
	const tracks = yield* mapped(playlist.items, libraryCopyOrOwn);
	const columns: Record<string, string[]> = {};
	for (const name of names) {
		const expression = roles.get(name);
		columns[name] =
			expression === undefined
				? yield* mapped(tracks, () => UNRESOLVED)
				: yield* mapped(tracks, (track) => String(evaluate(track, expression)));
	}
	return columns as Record<Name, string[]>;
}

function* runsOver(
	state: FakeState,
	playlist: FakePlaylist,
	roles: Map<string, string>,
) {
	const columns = yield* columnsOver(state, playlist, roles, READS.runs.roles);
	const positions = yield* mapped(playlist.items, (_, at) => at);
	const { lengths, draftAt } = yield* runsSweep({
		count: positions.length,
		columns,
	});
	let mostPlays = 0;
	for (let at = 0; at < positions.length; at += 1) {
		mostPlays = Math.max(mostPlays, playsOf(columns, at) ?? 0);
		if (at % CHUNK === CHUNK - 1) yield;
	}
	return {
		lengths,
		mostPlays,
		...(yield* figuresSweep(columns, positions, draftAt)),
	};
}

export async function handlePlaylistReads({
	state,
	fake,
	path,
	url,
	headers,
	response,
	recorded,
}: Asked) {
	const [, guid, kind] = READ_PATH.exec(path) as RegExpExecArray &
		[string, string, keyof typeof READS];
	const read = READS[kind];

	const roles = rolesAsked(url, LIBRARY_ROLE_NAMES, read.question.required);
	if (!(roles instanceof Map)) return json(response, roles, 400);
	const given = questionAsked(url, read.question);
	if (!(given instanceof Map)) return json(response, given, 400);

	if (!fake.canReadLibrary) return json(response, LIBRARY_UNAVAILABLE, 503);

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, read.bucket, "")
	) {
		recorded.limited = read.bucket;
		return refuseTooFast(response, read.bucket);
	}

	if (answeredUnlessReady(state, fake, response, [...roles.values()]))
		return true;

	const playlist = state.playlistByGuid(guid);
	if (!playlist)
		return json(response, { error: "no such playlist", detail: "" }, 404);
	if (BigInt(given.get("structure") ?? "") !== playlist.structure)
		return json(response, ROWS_MOVED, 409);

	const own = {
		structure: String(playlist.structure),
		revision: String(playlist.revision),
	};

	if (kind === "find") {
		const { matched } = await runYielding(
			(function* () {
				const columns = yield* columnsOver(
					state,
					playlist,
					roles,
					READS.find.roles,
				);
				const rows = yield* matchingRowsSweep(
					columns,
					playlist.items.length,
					given.get("query") ?? "",
				);
				return { matched: yield* setSweep(rows, playlist.items.length) };
			})(),
			state.isDiscarded,
		);
		return sendJson(response, headers, { ...own, matched });
	}

	const content = await runYielding(
		runsOver(state, playlist, roles),
		state.isDiscarded,
	);
	const tag = `"p${hashOf(JSON.stringify(content))}-${offersGzip(headers) ? "gzip" : "identity"}"`;
	const revalidating = {
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Accept-Encoding",
		ETag: tag,
	};
	if (holdsTag(headers, tag)) {
		response.writeHead(304, revalidating);
		response.end();
		return true;
	}
	return sendJson(
		response,
		headers,
		{ ...own, ...content } satisfies PlaylistRuns,
		{ ETag: tag },
	);
}
