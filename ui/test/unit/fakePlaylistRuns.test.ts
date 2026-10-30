import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { GENERATION_SEED } from "../fake-api/state.ts";
import {
	type CaseLibrary,
	fixture,
	questionCases,
	summaryFile,
} from "./caseFiles.ts";
import {
	ask,
	bodyOf,
	control,
	declared,
	type FakeState,
	failureText,
	frozenAt,
	ROLES,
	rawOf,
	refusalOf,
	tooFast,
	tracksOfCase,
	withRole,
} from "./fakeLibraryHarness.ts";
import {
	EMPTY,
	LIBRARY_ORDINAL,
	MIXED,
	mixedState,
	playlistOf,
	structureOf,
	UNKNOWN_PLAYLIST,
	YEARLESS,
} from "./fakePlaylistHarness.ts";

const runsPath = (guid: string) => `/api/playlists/${guid}/runs`;

const askRuns = async (
	state: FakeState,
	guid: string,
	{
		structure,
		headers = {},
		roles = ROLES,
		client,
	}: {
		structure?: string;
		headers?: Record<string, string>;
		roles?: [string, string][];
		client?: string;
	} = {},
) =>
	ask(state, runsPath(guid), {
		query: [
			["structure", structure ?? (await structureOf(state, guid))],
			...roles,
		],
		headers,
		client,
	});

test("a playlist's runs break where the album or its credited artist changes, an outside row of the same album and artist joining a library row's run", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	const answer = await askRuns(state, MIXED, { structure });

	assert.equal(answer.status, 200);
	assert.deepEqual(bodyOf(answer), {
		structure,
		revision: String(GENERATION_SEED),
		// South | North by Ana with x1 | North by Cal | Dee's two untagged | Eve's untagged |
		// Blank, whitespace and no credit alike | South | North by Ana.
		lengths: [1, 3, 1, 2, 1, 2, 1, 1],
		// x2, a row the library does not hold, has the most plays.
		mostPlays: 20,
		// South by Bea, North by Ana, North by Cal and Blank by nobody; the untagged rows are no album.
		albumCount: 4,
		trackCount: 12,
		seconds: 1020,
		earliestYear: 1999,
		// x1's year, read off the outside row.
		latestYear: 2015,
	});
});

test("a playlist whose rows carry no year answers both years null, and an empty one answers no runs and zero figures", async (t) => {
	frozenAt(t);
	const state = mixedState();

	assert.deepEqual(bodyOf(await askRuns(state, YEARLESS)), {
		structure: await structureOf(state, YEARLESS),
		revision: String(GENERATION_SEED),
		lengths: [2, 1],
		mostPlays: 20,
		albumCount: 1,
		trackCount: 3,
		seconds: 50,
		earliestYear: null,
		latestYear: null,
	});
	assert.deepEqual(bodyOf(await askRuns(state, EMPTY)), {
		structure: await structureOf(state, EMPTY),
		revision: String(GENERATION_SEED),
		lengths: [],
		mostPlays: 0,
		albumCount: 0,
		trackCount: 0,
		seconds: 0,
		earliestYear: null,
		latestYear: null,
	});
});

interface RunsCase {
	name: string;
	source: "library_summary_cases.json" | "library_questions_cases.json";
	lengths: number[];
}

interface SourceCase extends CaseLibrary {
	name: string;
}

const RUNS_CASES = fixture<{ cases: RunsCase[] }>(
	"library_runs_cases.json",
).cases;

const SOURCES: Record<RunsCase["source"], SourceCase[]> = {
	"library_summary_cases.json": summaryFile().cases,
	"library_questions_cases.json": questionCases(),
};

test("a playlist holding a case's whole library in ordinal order runs as library_runs_cases.json says that library runs", async (t) => {
	frozenAt(t);
	assert.ok(RUNS_CASES.length > 0);
	for (const runsCase of RUNS_CASES) {
		const source = SOURCES[runsCase.source].find(
			(held) => held.name === runsCase.name,
		);
		assert.ok(source, `${runsCase.source} holds no case ${runsCase.name}`);
		const tracks = tracksOfCase(source);
		const state = declared(
			{ mediaLibrary: tracks, playlists: [playlistOf(1, [...tracks])] },
			[...TRACK_EXPRESSIONS],
		);

		const answer = await askRuns(state, MIXED);

		assert.equal(answer.status, 200, `${runsCase.source} ${runsCase.name}`);
		assert.deepEqual(
			bodyOf(answer).lengths,
			runsCase.lengths,
			`${runsCase.source} ${runsCase.name}`,
		);
	}
});

test("a playlist's runs carry a strong quoted ETag, private, no-cache, and asking with it is 304 with no body", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const first = await askRuns(state, MIXED);

	assert.equal(first.status, 200);
	assert.equal(first.headers["cache-control"], "private, no-cache");
	assert.match(first.headers.etag ?? "", /^"[^"]+"$/);

	const again = await askRuns(state, MIXED, {
		headers: { "if-none-match": first.headers.etag },
	});
	assert.equal(again.status, 304);
	assert.equal(again.headers.etag, first.headers.etag);
	assert.equal(rawOf(again).length, 0);
});

// A play moves a count on one row, and nothing the runs answer carries moves unless that count is
// now the highest. The second play proves the first reached the playlist's rows at all.
test("a play below the highest count keeps the runs' ETag, and one that becomes the highest moves it and mostPlays", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const before = await askRuns(state, MIXED);

	assert.equal(
		control(state, "play", { ordinal: LIBRARY_ORDINAL.b1, count: 2 }).status,
		204,
	);
	const kept = await askRuns(state, MIXED, {
		headers: { "if-none-match": before.headers.etag },
	});
	assert.equal(kept.status, 304);

	assert.equal(
		control(state, "play", { ordinal: LIBRARY_ORDINAL.a2, count: 50 }).status,
		204,
	);
	const moved = await askRuns(state, MIXED, {
		headers: { "if-none-match": before.headers.etag },
	});
	assert.equal(moved.status, 200);
	assert.notEqual(moved.headers.etag, before.headers.etag);
	assert.equal(bodyOf(moved).mostPlays, 50);
});

test("a row added to the playlist moves the runs' ETag, and the runs cover it at the new structure", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const before = await askRuns(state, MIXED);
	const { structure } = bodyOf(before);

	assert.equal(
		control(state, "append", { sourceId: "p1", targetId: "p1", items: [0] })
			.status,
		204,
	);
	const after = await askRuns(state, MIXED, {
		headers: { "if-none-match": before.headers.etag },
	});

	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	const document = bodyOf(after);
	assert.notEqual(document.structure, structure);
	assert.deepEqual(document.lengths, [1, 3, 1, 2, 1, 2, 1, 1, 1]);
	assert.equal(document.trackCount, 13);
});

test("a reorder that changes only where the runs break moves the runs' ETag", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const before = await askRuns(state, MIXED);

	const moved = await ask(state, `/api/playlists/${MIXED}/items/move`, {
		method: "POST",
		body: {
			structure: await structureOf(state, MIXED),
			runs: [[11, 1]],
			to: 1,
		},
	});
	assert.equal(moved.status, 200);

	const after = await askRuns(state, MIXED, {
		headers: { "if-none-match": before.headers.etag },
	});
	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	assert.deepEqual(bodyOf(after).lengths, [1, 4, 1, 2, 1, 2, 1]);
});

test("runs answer the playlist's own revision once a row has changed in place", async (t) => {
	frozenAt(t);
	const state = mixedState();
	state.playItem("p1", 1);
	assert.ok(state.retagPlaying({ "%title%": "Renamed" }));
	const page = bodyOf(
		await ask(state, `/api/playlists/${MIXED}/items`, {
			query: [
				["offset", "0"],
				["count", "0"],
				["columns", "%title%"],
			],
		}),
	);
	assert.notEqual(page.revision, page.structure);

	const document = bodyOf(await askRuns(state, MIXED));

	assert.equal(document.structure, page.structure);
	assert.equal(document.revision, page.revision);
});

test("runs asked at a structure that is not the playlist's are 409, rows moved", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	assert.deepEqual(
		refusalOf(
			await askRuns(state, MIXED, {
				structure: String(BigInt(structure) - 1n),
			}),
		),
		{
			status: 409,
			body: {
				error:
					"the playlist's rows were added, removed or reordered; read them again",
				detail: "",
			},
		},
	);
});

test("runs of a playlist the player does not have are 404, where one it has answers 200", async (t) => {
	frozenAt(t);
	const state = mixedState();

	assert.equal((await askRuns(state, MIXED)).status, 200);
	assert.deepEqual(
		refusalOf(
			await askRuns(state, UNKNOWN_PLAYLIST, {
				structure: String(GENERATION_SEED),
			}),
		),
		{ status: 404, body: { error: "no such playlist", detail: "" } },
	);
});

test("playlist runs refuse a role as the library runs do: 400 for an unknown one, 503 without a library, 202 before a snapshot, 409 for an undeclared expression", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	assert.deepEqual(
		refusalOf(
			await askRuns(state, MIXED, {
				structure,
				roles: [...ROLES, ["colour", "%genre%"]],
			}),
		),
		{
			status: 400,
			body: { error: "unacceptable role", detail: "'colour' is not a role" },
		},
	);
	assert.deepEqual(
		refusalOf(
			await askRuns(state, MIXED, {
				structure,
				roles: withRole("album", "%nothing%"),
			}),
		),
		{ status: 409, body: { error: "'%nothing%' is not a declared column" } },
	);

	const unbuilt = mixedState({}, { build: false });
	const library = bodyOf(await ask(unbuilt, "/api/state")).library;
	const waiting = await askRuns(unbuilt, MIXED);
	assert.equal(waiting.status, 202);
	assert.deepEqual(bodyOf(waiting), library);

	const without = mixedState({ canReadLibrary: false });
	assert.deepEqual(refusalOf(await askRuns(without, MIXED)), {
		status: 503,
		body: { error: failureText("kNoLibrary") },
	});
});

test("the playlist runs bucket answers 200 deep and refuses the next 429 too many playlist run reads, with Retry-After, a budget of its own", async (t) => {
	frozenAt(t);
	const state = mixedState({ rateLimits: COMPONENT_RATE_LIMITS });
	const structure = await structureOf(state, MIXED);

	for (let request = 1; request <= 200; request += 1)
		assert.equal(
			(await askRuns(state, MIXED, { structure })).status,
			200,
			`request ${request}`,
		);

	assert.deepEqual(tooFast(await askRuns(state, MIXED, { structure })), {
		status: 429,
		body: { error: "too many playlist run reads" },
		waits: true,
	});
	assert.equal(state.requests.at(-1)?.limited, "playlistRuns");
	assert.equal(
		(await ask(state, "/api/library/runs", { query: ROLES })).status,
		200,
		"the library's runs share no bucket with a playlist's",
	);
});

test("playlist runs refused 400 for what they ask spend nothing from their bucket", async (t) => {
	frozenAt(t);
	const state = mixedState({ rateLimits: COMPONENT_RATE_LIMITS });
	const structure = await structureOf(state, MIXED);
	const unknownRole: [string, string][] = [...ROLES, ["colour", "%genre%"]];

	for (let request = 1; request <= 50; request += 1)
		assert.equal(
			(await askRuns(state, MIXED, { structure, roles: unknownRole })).status,
			400,
		);
	for (let request = 1; request <= 200; request += 1)
		assert.equal(
			(await askRuns(state, MIXED, { structure })).status,
			200,
			`request ${request}`,
		);
	assert.equal((await askRuns(state, MIXED, { structure })).status, 429);
});
