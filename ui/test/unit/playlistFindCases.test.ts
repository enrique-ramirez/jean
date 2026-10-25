import assert from "node:assert/strict";
import test from "node:test";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { GENERATION_SEED, type Track } from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	type CaseLibrary,
	declared,
	type FakeState,
	failureText,
	fixture,
	frozenAt,
	ROLES,
	refusalOf,
	tooFast,
	tracksOfCase,
	withRole,
} from "./fakeLibraryHarness.ts";
import {
	MIXED,
	mixedState,
	playlistOf,
	structureOf,
	UNKNOWN_PLAYLIST,
} from "./fakePlaylistHarness.ts";

type OrdinalSet = components["schemas"]["OrdinalSet"];

const findPath = (guid: string) => `/api/playlists/${guid}/find`;

const askFind = async (
	state: FakeState,
	guid: string,
	query: string,
	{
		structure,
		roles = ROLES,
		client,
	}: { structure?: string; roles?: [string, string][]; client?: string } = {},
) =>
	ask(state, findPath(guid), {
		query: [
			["query", query],
			["structure", structure ?? (await structureOf(state, guid))],
			...roles,
		],
		client,
	});

const positionsOf = (set: OrdinalSet, rows: number) => {
	const keys = Object.keys(set ?? {});
	if (keys.length === 1 && "runs" in set)
		return set.runs.flatMap(([start, count]) =>
			Array.from({ length: count }, (_, at) => start + at),
		);
	if (keys.length === 1 && "bitset" in set) {
		const bytes = Buffer.from(set.bitset, "base64");
		assert.equal(bytes.length, Math.ceil(rows / 8), "a bit for each row");
		const positions: number[] = [];
		for (let at = 0; at < bytes.length * 8; at += 1)
			if (bytes[at >> 3] & (1 << (at & 7))) positions.push(at);
		return positions;
	}
	return assert.fail(
		`not exactly one of runs and bitset: ${JSON.stringify(set)}`,
	);
};

type OutsideRow = Record<
	"title" | "artist" | "albumArtist" | "album" | "artistSort",
	string
>;

interface FindCase {
	name: string;
	source: "library_questions_cases.json";
	rows: ({ ordinal: number } | OutsideRow)[];
	queries: { query: string; matched: number[] }[];
}

interface SourceCase extends CaseLibrary {
	name: string;
}

const CASES = fixture<{ cases: FindCase[] }>("playlist_find_cases.json").cases;

const SOURCES = fixture<{ cases: SourceCase[] }>(
	"library_questions_cases.json",
).cases;

const EXPRESSION_OF = {
	title: TRACK_EXPRESSIONS[FIELD.title],
	artist: TRACK_EXPRESSIONS[FIELD.artist],
	albumArtist: TRACK_EXPRESSIONS[FIELD.albumArtist],
	album: TRACK_EXPRESSIONS[FIELD.album],
	artistSort: TRACK_EXPRESSIONS[FIELD.artistSort],
} as const;

const outsideTrack = (row: OutsideRow, at: number): Track => {
	const track: Track = {
		"%path%": `D:\\Elsewhere\\${String(at).padStart(4, "0")}.flac`,
	};
	for (const [field, expression] of Object.entries(EXPRESSION_OF)) {
		const value = row[field as keyof OutsideRow];
		if (value !== "?") track[expression] = value;
	}
	return track;
};

const caseState = (one: FindCase) => {
	const source = SOURCES.find((held) => held.name === one.name);
	assert.ok(source, `${one.source} holds no case ${one.name}`);
	const library = tracksOfCase(source);
	const rows = one.rows.map((row, at) =>
		"ordinal" in row ? library[row.ordinal] : outsideTrack(row, at),
	);
	return declared({ mediaLibrary: library, playlists: [playlistOf(1, rows)] }, [
		...TRACK_EXPRESSIONS,
	]);
};

// A file cut short would leave the loop below with nothing to run, and the run green.
assert.equal(CASES.length, 19);
assert.equal(
	CASES.reduce((sum, one) => sum + one.queries.length, 0),
	195,
);

for (const findCase of CASES)
	test(`the fake finds in a playlist of case ${findCase.name} the positions playlist_find_cases.json gives`, async (t) => {
		frozenAt(t);
		const state = caseState(findCase);
		const structure = await structureOf(state, MIXED);

		for (const { query, matched } of findCase.queries) {
			const answer = await askFind(state, MIXED, query, { structure });
			assert.equal(answer.status, 200, `query ${JSON.stringify(query)}`);
			const document = bodyOf(answer);
			assert.deepEqual(
				{
					structure: document.structure,
					revision: document.revision,
					matched: positionsOf(document.matched, findCase.rows.length),
				},
				{ structure, revision: String(GENERATION_SEED), matched },
				`query ${JSON.stringify(query)}`,
			);
		}
	});

test("a blank query finds every row of the playlist, inside the library or not", async (t) => {
	frozenAt(t);
	const state = mixedState();

	for (const query of ["", "   "]) {
		const answer = await askFind(state, MIXED, query);
		assert.equal(answer.status, 200, JSON.stringify(query));
		assert.deepEqual(
			positionsOf(bodyOf(answer).matched, 12),
			Array.from({ length: 12 }, (_, at) => at),
			JSON.stringify(query),
		);
	}
});

test("find answers the playlist's own revision once a row has changed in place", async (t) => {
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

	const document = bodyOf(await askFind(state, MIXED, "renamed"));

	assert.equal(document.structure, page.structure);
	assert.equal(document.revision, page.revision);
});

// Counted in bytes of UTF-8, so 512 two-byte letters are the most a query may hold.
test("a query of 1024 bytes is answered and one of 1026 is 400 in the questions' words", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	assert.equal(
		(await askFind(state, MIXED, "é".repeat(512), { structure })).status,
		200,
	);
	assert.deepEqual(
		refusalOf(await askFind(state, MIXED, "é".repeat(513), { structure })),
		{
			status: 400,
			body: {
				error: "unacceptable question",
				detail: "'query' must be at most 1024 bytes",
			},
		},
	);
});

test("find at a structure that is not the playlist's is 409, rows moved", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	assert.equal(
		(await askFind(state, MIXED, "north", { structure })).status,
		200,
	);
	assert.deepEqual(
		refusalOf(
			await askFind(state, MIXED, "north", {
				structure: String(BigInt(structure) + 1n),
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

test("find in a playlist the player does not have is 404, where one it has answers 200", async (t) => {
	frozenAt(t);
	const state = mixedState();

	assert.equal((await askFind(state, MIXED, "north")).status, 200);
	assert.deepEqual(
		refusalOf(
			await askFind(state, UNKNOWN_PLAYLIST, "north", {
				structure: String(GENERATION_SEED),
			}),
		),
		{ status: 404, body: { error: "no such playlist", detail: "" } },
	);
});

test("find refuses a role as the questions do: 400 for an unknown one, 503 without a library, 202 before a snapshot, 409 for an undeclared expression", async (t) => {
	frozenAt(t);
	const state = mixedState();
	const structure = await structureOf(state, MIXED);

	assert.deepEqual(
		refusalOf(
			await askFind(state, MIXED, "north", {
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
			await askFind(state, MIXED, "north", {
				structure,
				roles: withRole("title", "%nothing%"),
			}),
		),
		{ status: 409, body: { error: "'%nothing%' is not a declared column" } },
	);

	const unbuilt = mixedState({}, { build: false });
	const library = bodyOf(await ask(unbuilt, "/api/state")).library;
	const waiting = await askFind(unbuilt, MIXED, "north");
	assert.equal(waiting.status, 202);
	assert.deepEqual(bodyOf(waiting), library);

	const without = mixedState({ canReadLibrary: false });
	assert.deepEqual(refusalOf(await askFind(without, MIXED, "north")), {
		status: 503,
		body: { error: failureText("kNoLibrary") },
	});
});

test("the find bucket answers 200 deep and refuses the next 429 too many playlist searches, with Retry-After, a budget of its own", async (t) => {
	frozenAt(t);
	const state = mixedState({ rateLimits: COMPONENT_RATE_LIMITS });
	const structure = await structureOf(state, MIXED);

	for (let request = 1; request <= 200; request += 1)
		assert.equal(
			(await askFind(state, MIXED, "north", { structure })).status,
			200,
			`request ${request}`,
		);

	assert.deepEqual(
		tooFast(await askFind(state, MIXED, "north", { structure })),
		{
			status: 429,
			body: { error: "too many playlist searches" },
			waits: true,
		},
	);
	assert.equal(state.requests.at(-1)?.limited, "playlistSearches");
	assert.equal(
		(
			await ask(state, "/api/library/search", {
				query: [
					["query", "north"],
					["limit", "0"],
					["entityLimit", "0"],
					["splitsCredits", "false"],
					...ROLES,
				],
			})
		).status,
		200,
		"the library's questions share no bucket with a playlist's find",
	);
	assert.equal(
		(
			await ask(state, `/api/playlists/${MIXED}/runs`, {
				query: [["structure", structure], ...ROLES],
			})
		).status,
		200,
		"nor does a playlist's runs",
	);
});

test("find refused 400 for what it asks spends nothing from its bucket", async (t) => {
	frozenAt(t);
	const state = mixedState({ rateLimits: COMPONENT_RATE_LIMITS });
	const structure = await structureOf(state, MIXED);

	for (let request = 1; request <= 50; request += 1)
		assert.equal(
			(await askFind(state, MIXED, "é".repeat(513), { structure })).status,
			400,
		);
	for (let request = 1; request <= 200; request += 1)
		assert.equal(
			(await askFind(state, MIXED, "north", { structure })).status,
			200,
			`request ${request}`,
		);
	assert.equal(
		(await askFind(state, MIXED, "north", { structure })).status,
		429,
	);
});
