import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createState } from "../fake-api/state.ts";
import { evaluate } from "../fake-api/titleFormat.ts";
import {
	type Answer,
	ask,
	bodyOf,
	bytewise,
	componentBucket,
	control,
	DAY,
	declared,
	type FakeState,
	failureText,
	frozenAt,
	libraryOf,
	MISSING_FIELD,
	ordinalsOfRuns,
	ROLES,
	rawOf,
	readRows,
	refusalOf,
	send,
	settled,
	withFake,
} from "./fakeLibraryHarness.ts";

const ROWS = "/api/library/rows";
const GRUNGE: [string, string][] = [["name", "Grunge"], ...ROLES];
const DECLARED = [...TRACK_EXPRESSIONS, MISSING_FIELD];
const NO_LIBRARY = failureText("kNoLibrary");
const STRUCTURE_MOVED = {
	error: "tracks were added or removed; read the state and ask again",
	detail: "",
};

const askRows = (
	state: FakeState,
	body: unknown,
	{
		client,
		headers,
	}: { client?: string; headers?: Record<string, string> } = {},
) => ask(state, ROWS, { method: "POST", body, client, headers });

const sendRows = (state: FakeState, body: unknown) =>
	send(state, ROWS, { method: "POST", body });

const structureOf = async (state: FakeState) =>
	String((await libraryOf(state)).structure);

const byOrdinals = async (
	state: FakeState,
	ordinals: number[],
	columns: string[] = DECLARED,
) => ({ columns, structure: await structureOf(state), ordinals });

const windowOf = (answer: Answer) => {
	assert.equal(answer.status, 200, rawOf(answer).toString("utf8", 0, 200));
	return readRows(rawOf(answer));
};

const cut = (path: string) => path.lastIndexOf("/") + 1;

const heldAt = (state: FakeState, ordinals: number[]) => {
	const entries = state.ordinalOrder();
	return {
		columns: new Map(
			DECLARED.map((expression) => [
				expression,
				ordinals.map((at) => String(evaluate(entries[at].track, expression))),
			]),
		),
		directory: ordinals.map((at) =>
			entries[at].path.slice(0, cut(entries[at].path)),
		),
		filename: ordinals.map((at) =>
			entries[at].path.slice(cut(entries[at].path)),
		),
		subsong: ordinals.map((at) => String(entries[at].subsong)),
	};
};

const factsOver = (values: string[]) => ({
	distinct: new Set(values).size,
	hasUnresolved: values.includes("?"),
	allUnresolved: values.length > 0 && values.every((value) => value === "?"),
});

const wholeLibraryFacts = (state: FakeState, expression: string) =>
	factsOver(
		state
			.ordinalOrder()
			.map((entry) => String(evaluate(entry.track, expression))),
	);

const usedInBytewiseOrder = (cells: string[]) =>
	[...new Set(cells)].sort(bytewise);

const NAMED = [41, 20, 7, 20, 0, 53];

test("a window named by ordinals holds each named row's cells in the order named, repeats kept", async (t) => {
	frozenAt(t);
	const state = declared();

	const answer = await askRows(state, await byOrdinals(state, NAMED));

	assert.equal(answer.status, 200);
	assert.equal(answer.headers["content-type"], "application/octet-stream");
	const window = windowOf(answer);
	const held = heldAt(state, NAMED);
	for (const expression of DECLARED)
		assert.deepEqual(
			window.columns.get(expression)?.cells,
			held.columns.get(expression),
			expression,
		);
	assert.deepEqual(window.spine.directory.cells, held.directory);
	assert.deepEqual(window.spine.filename.cells, held.filename);
	assert.deepEqual(window.spine.subsong.cells, held.subsong);
});

test("a window named by runs holds the rows of each run in turn", async (t) => {
	frozenAt(t);
	const state = declared();
	const runs: [number, number][] = [
		[10, 3],
		[28, 4],
	];

	const answer = await askRows(state, {
		columns: DECLARED,
		structure: await structureOf(state),
		runs,
	});

	assert.equal(answer.status, 200);
	const window = windowOf(answer);
	const held = heldAt(state, ordinalsOfRuns(runs));
	assert.equal(window.header.rows, 7);
	assert.deepEqual(
		window.columns.get("%title%")?.cells,
		held.columns.get("%title%"),
	);
	assert.deepEqual(window.spine.filename.cells, held.filename);
});

test("each column's dictionary holds only the values the window's rows use, in bytewise order", async (t) => {
	frozenAt(t);
	const state = declared();

	const window = windowOf(await askRows(state, await byOrdinals(state, NAMED)));

	const album = window.columns.get("%album%");
	assert.deepEqual(album?.dictionary, [
		"Deathconsciousness",
		"Jar Of Flies",
		"Jessico",
		"Lafcadio",
	]);
	for (const [expression, column] of window.columns)
		assert.deepEqual(
			column.dictionary,
			usedInBytewiseOrder(column.cells),
			expression,
		);
	for (const [name, column] of Object.entries(window.spine))
		assert.deepEqual(
			column.dictionary,
			usedInBytewiseOrder(column.cells),
			name,
		);
});

test("a window's header carries the pair, the library's track count, its own row count and the whole library's facts for every column", async (t) => {
	frozenAt(t);
	const state = declared();
	const held = await libraryOf(state);

	const { header, columns } = windowOf(
		await askRows(state, await byOrdinals(state, [0, 1])),
	);

	assert.equal(header.kind, "rows");
	assert.equal(header.structure, held.structure);
	assert.equal(header.revision, held.revision);
	assert.equal(header.trackCount, held.trackCount);
	assert.equal(header.rows, 2);
	assert.deepEqual(
		header.columns.map((column) => column.name),
		held.columns,
	);
	for (const expression of DECLARED)
		assert.deepEqual(
			columns.get(expression)?.facts,
			wholeLibraryFacts(state, expression),
			expression,
		);
	assert.deepEqual(columns.get(MISSING_FIELD)?.facts, {
		distinct: 1,
		hasUnresolved: true,
		allUnresolved: true,
	});
});

test("a window carries the pair the library holds once a play has moved its revision", async (t) => {
	frozenAt(t);
	const state = declared({ countsPlays: true });
	assert.equal(control(state, "play", { ordinal: 3 }).status, 204);
	const held = await libraryOf(state);

	const window = windowOf(await askRows(state, await byOrdinals(state, [3])));

	assert.equal(window.header.revision, held.revision);
	assert.deepEqual(
		window.columns.get("%lastfm_play_count%")?.cells,
		heldAt(state, [3]).columns.get("%lastfm_play_count%"),
	);
});

test("the held declaration listed in another order is answered from the snapshot, building nothing", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await libraryOf(state);

	const answer = await askRows(
		state,
		await byOrdinals(state, [5], [...DECLARED].reverse()),
	);

	assert.equal(answer.status, 200);
	assert.deepEqual(
		windowOf(answer).columns.get("%title%")?.cells,
		heldAt(state, [5]).columns.get("%title%"),
	);
	const after = await libraryOf(state);
	assert.equal(after.build, null);
	assert.equal(after.structure, before.structure);
});

test("a window answers private, no-cache, varying on the coding and with no ETag", async (t) => {
	frozenAt(t);
	const state = declared();

	const answer = await askRows(state, await byOrdinals(state, [0]));

	assert.equal(answer.headers["cache-control"], "private, no-cache");
	assert.match(answer.headers.vary ?? "", /Accept-Encoding/);
	assert.equal(answer.headers.etag, undefined);
	assert.equal(answer.headers["content-encoding"], undefined);
});

test("a window offering gzip is answered gzipped, holding the bytes it is sent as plain", async (t) => {
	frozenAt(t);
	const state = declared();
	const body = await byOrdinals(state, NAMED);

	const plain = await askRows(state, body);
	const zipped = await askRows(state, body, {
		headers: { "accept-encoding": "gzip" },
	});
	const declined = await askRows(state, body, {
		headers: { "accept-encoding": "gzip;q=0" },
	});

	assert.equal(zipped.status, 200);
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.deepEqual(gunzipSync(rawOf(zipped)), rawOf(plain));
	assert.equal(declined.headers["content-encoding"], undefined);
	assert.deepEqual(rawOf(declined), rawOf(plain));
});

test("as many rows as one answer carries are answered, by ordinal and by run", async (t) => {
	frozenAt(t);
	const state = declared({ mediaLibrary: libraryOfShape({ tracks: 5000 }) }, [
		"%title%",
	]);
	const structure = await structureOf(state);

	const byRun = await askRows(state, {
		columns: ["%title%"],
		structure,
		runs: [[100, 4096]],
	});
	const byOrdinal = await askRows(state, {
		columns: ["%title%"],
		structure,
		ordinals: Array.from({ length: 4096 }, (_, at) => 4999 - at),
	});

	assert.equal(byRun.status, 200);
	assert.equal(windowOf(byRun).header.rows, 4096);
	assert.equal(byOrdinal.status, 200);
	assert.equal(windowOf(byOrdinal).header.rows, 4096);
});

const UNACCEPTABLE_SET = {
	status: 400,
	body: { error: "unacceptable ordinal set", detail: "" },
};

test("a set naming both forms, neither, a bitset, or a row past the library is 400 unacceptable ordinal set", async (t) => {
	frozenAt(t);
	const state = declared();
	const structure = await structureOf(state);
	const trackCount = (await libraryOf(state)).trackCount;
	const refused: [string, object][] = [
		["both forms", { ordinals: [0], runs: [[0, 1]] }],
		["neither form", {}],
		["a bitset, which this route does not take", { bitset: "AwI=" }],
		["a bitset beside ordinals", { ordinals: [0], bitset: "AQ==" }],
		["an ordinal one past the last track", { ordinals: [0, trackCount] }],
		["a run ending one past the last track", { runs: [[trackCount - 2, 3]] }],
		["an ordinal that is not a whole number", { ordinals: ["1"] }],
	];

	for (const [what, set] of refused)
		assert.deepEqual(
			refusalOf(await askRows(state, { columns: DECLARED, structure, ...set })),
			UNACCEPTABLE_SET,
			what,
		);
});

test("a structure missing, empty, a JSON number or not decimal digits is 400 malformed request, and so is a body that is not JSON", async (t) => {
	frozenAt(t);
	const state = declared();
	const held = (await libraryOf(state)).structure;
	const malformed = {
		status: 400,
		body: { error: "malformed request", detail: "" },
	};
	const refused: [string, object | null][] = [
		["no structure", { columns: DECLARED, ordinals: [0] }],
		["an empty one", { columns: DECLARED, structure: "", ordinals: [0] }],
		[
			"one with a letter",
			{ columns: DECLARED, structure: "12a", ordinals: [0] },
		],
		["a negative one", { columns: DECLARED, structure: "-1", ordinals: [0] }],
		["a JSON number", { columns: DECLARED, structure: held, ordinals: [0] }],
		["a body that did not parse", null],
	];

	for (const [what, body] of refused)
		assert.deepEqual(refusalOf(await askRows(state, body)), malformed, what);
});

test("more than 4096 rows is 400 too many rows asked for, by one run, by runs summing past it, or by ordinals", async (t) => {
	frozenAt(t);
	const state = declared({ mediaLibrary: libraryOfShape({ tracks: 5000 }) }, [
		"%title%",
	]);
	const structure = await structureOf(state);
	const tooMany = {
		status: 400,
		body: {
			error: "too many rows asked for",
			detail: "a request names at most 4096 rows",
		},
	};
	const refused: [string, object][] = [
		["one run", { runs: [[0, 4097]] }],
		[
			"two runs summing past it",
			{
				runs: [
					[0, 4000],
					[4000, 97],
				],
			},
		],
		["ordinals", { ordinals: new Array(4097).fill(3) }],
	];

	for (const [what, set] of refused)
		assert.deepEqual(
			refusalOf(
				await askRows(state, { columns: ["%title%"], structure, ...set }),
			),
			tooMany,
			what,
		);
});

test("a declaration the column gate refuses is 400 in the component's words", async (t) => {
	frozenAt(t);
	const state = declared();
	const structure = await structureOf(state);
	const columnsRequired = {
		error: "unacceptable column",
		detail: "'columns' is required",
	};
	const refused: [string, unknown, object][] = [
		["no columns", undefined, columnsRequired],
		["an empty list", [], columnsRequired],
		[
			"a column named twice",
			["%title%", "%album%", "%title%"],
			{ error: "duplicate column", detail: "column 2 repeats an earlier one" },
		],
		[
			"an empty column",
			["%title%", ""],
			{
				error: "unacceptable column",
				detail: "column 1 must be printable text of 1 to 1024 characters",
			},
		],
		[
			"65 columns",
			Array.from({ length: 65 }, (_, at) => `%field ${at}%`),
			{
				error: "too many columns",
				detail: "at most 64 columns, and 65 were asked for",
			},
		],
	];

	for (const [what, columns, body] of refused)
		assert.deepEqual(
			refusalOf(await askRows(state, { columns, structure, ordinals: [0] })),
			{ status: 400, body },
			what,
		);
	assert.equal((await libraryOf(state)).build, null);
});

test("without the media library rows are 503 in foo_jean's words, after what the request says is judged", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ canReadLibrary: false }));
	const structure = await structureOf(state);

	assert.deepEqual(
		refusalOf(
			await askRows(state, { columns: DECLARED, structure, ordinals: [0] }),
		),
		{ status: 503, body: { error: NO_LIBRARY } },
	);
	assert.equal(
		(await askRows(state, { columns: DECLARED, structure })).status,
		400,
	);
});

test("a declaration other than the one held answers 202 with the state's library and starts building it, and the rows once built", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await libraryOf(state);
	const wanted = ["%title%", "%genre%"];

	const building = await askRows(state, {
		columns: wanted,
		structure: String(before.structure),
		ordinals: [0, 1],
	});

	assert.equal(building.status, 202);
	const answered = bodyOf(building);
	assert.equal(answered.ready, true);
	assert.equal(answered.structure, before.structure);
	assert.deepEqual(answered.columns, before.columns);

	const after = await libraryOf(state);
	assert.deepEqual([...after.columns].sort(), [...wanted].sort());
	const built = await askRows(state, {
		columns: wanted,
		structure: String(after.structure),
		ordinals: [0, 1],
	});
	assert.equal(built.status, 200);
	assert.deepEqual(
		windowOf(built).columns.get("%genre%")?.cells,
		[0, 1].map((at) =>
			String(evaluate(state.ordinalOrder()[at].track, "%genre%")),
		),
	);
});

test("a new declaration is answered 202 whatever structure the request names", async (t) => {
	frozenAt(t);
	const state = declared();
	const stale = String((await libraryOf(state)).structure + 1);

	const answer = await askRows(state, {
		columns: ["%genre%"],
		structure: stale,
		ordinals: [0],
	});

	assert.equal(answer.status, 202);
});

test("rows asked for before anything is built answer 202 and start building what they declare", async (t) => {
	frozenAt(t);
	const state = createState();

	const building = await askRows(state, {
		columns: ["%title%"],
		structure: "0",
		ordinals: [0],
	});

	assert.equal(building.status, 202);
	assert.equal(bodyOf(building).ready, false);
	const after = await libraryOf(state);
	assert.equal(after.ready, true);
	assert.deepEqual(after.columns, ["%title%"]);
	const built = await askRows(state, {
		columns: ["%title%"],
		structure: String(after.structure),
		ordinals: [0],
	});
	assert.equal(built.status, 200);
});

test("rows at a structure that is not the current one are 409, and the current one is answered", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await structureOf(state);
	state.changeLibrary({ add: 1, remove: 0 });
	state.finishLibraryBuild();
	const current = await structureOf(state);
	assert.notEqual(current, before);

	for (const structure of [before, String(Number(current) + 1)])
		assert.deepEqual(
			refusalOf(
				await askRows(state, { columns: DECLARED, structure, ordinals: [0] }),
			),
			{ status: 409, body: STRUCTURE_MOVED },
			structure,
		);
	assert.equal(
		(
			await askRows(state, {
				columns: DECLARED,
				structure: current,
				ordinals: [54],
			})
		).status,
		200,
	);
});

test("the fake's rows bucket is sized as foo_jean's", () => {
	const buckets: Record<string, unknown> = COMPONENT_RATE_LIMITS;
	assert.deepEqual(
		buckets.libraryRows,
		componentBucket("kRowsBurst", "kRowsRefill"),
	);
});

const TOO_MANY_ROWS = { error: "too many library row reads" };

test("the rows bucket answers one client its depth inside one refill and refuses the next 429, while another client reads on", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ rateLimits: COMPONENT_RATE_LIMITS }));
	const body = await byOrdinals(state, [0]);
	const { burst } = componentBucket("kRowsBurst", "kRowsRefill");

	for (let request = 1; request <= burst; request += 1)
		assert.equal(
			(await askRows(state, body, { client: "192.168.1.20" })).status,
			200,
			`request ${request}`,
		);

	const refused = await askRows(state, body, { client: "192.168.1.20" });
	assert.equal(refused.status, 429);
	assert.deepEqual(bodyOf(refused), TOO_MANY_ROWS);
	assert.match(refused.headers["retry-after"] ?? "", /^[1-9]\d*$/);

	assert.equal(
		(await askRows(state, body, { client: "192.168.1.21" })).status,
		200,
	);
});

test("a client refused by the rows bucket is answered again once a refill has passed, and refused after that one", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ rateLimits: COMPONENT_RATE_LIMITS }));
	const body = await byOrdinals(state, [0]);
	const { burst, refillMs } = componentBucket("kRowsBurst", "kRowsRefill");
	for (let request = 0; request < burst; request += 1)
		await askRows(state, body);
	assert.equal((await askRows(state, body)).status, 429);

	t.mock.timers.tick(refillMs);

	assert.equal((await askRows(state, body)).status, 200);
	assert.equal((await askRows(state, body)).status, 429);
});

const ONE_ROW_READ = withFake({
	rateLimits: { libraryRows: { burst: 1, refillMs: DAY } },
});

test("a rows request refused 400 for what it says spends nothing from the rows bucket", async (t) => {
	frozenAt(t);
	const state = declared(ONE_ROW_READ);
	const body = await byOrdinals(state, [0]);
	const malformed = { columns: DECLARED, ordinals: [0] };

	assert.equal((await askRows(state, malformed)).status, 400);
	assert.equal((await askRows(state, malformed)).status, 400);
	assert.equal((await askRows(state, body)).status, 200);
	assert.equal((await askRows(state, body)).status, 429);
	assert.equal((await askRows(state, malformed)).status, 400);
});

test("the rows bucket is its own: a spent question bucket refuses no rows", async (t) => {
	frozenAt(t);
	const state = declared(
		withFake({
			rateLimits: {
				libraryRows: { burst: 1, refillMs: DAY },
				libraryQuestions: { burst: 1, refillMs: DAY },
			},
		}),
	);
	const body = await byOrdinals(state, [0]);
	const genre = GRUNGE;
	await ask(state, "/api/library/genre", { query: genre });
	assert.equal(
		(await ask(state, "/api/library/genre", { query: genre })).status,
		429,
	);

	assert.equal((await askRows(state, body)).status, 200);
});

test("holdRows keeps every window unanswered until POST /__control/holdRows releases them", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ holdRows: true }));
	const body = await byOrdinals(state, [0]);

	const held = [sendRows(state, body), sendRows(state, body)];
	await settled();
	await settled();
	for (const { answer } of held) {
		assert.equal(answer.answered, false);
		assert.equal(answer.status, 0);
	}

	assert.equal(control(state, "holdRows", {}).status, 204);
	await settled();
	for (const { answer } of held) assert.equal(answer.status, 200);

	const next = sendRows(state, body);
	await settled();
	assert.equal(next.answer.status, 200);
});

test("POST /__control/holdRows with hold true holds the windows that follow", async (t) => {
	frozenAt(t);
	const state = declared();
	const body = await byOrdinals(state, [0]);
	assert.equal(control(state, "holdRows", { hold: true }).status, 204);

	const held = sendRows(state, body);
	await settled();
	await settled();
	assert.equal(held.answer.answered, false);

	control(state, "holdRows", {});
	await settled();
	assert.equal(held.answer.status, 200);
});

test("holdRows holds no question, and holdQuestions holds no window", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ holdRows: true }));
	const body = await byOrdinals(state, [0]);

	const genre = send(state, "/api/library/genre", {
		query: GRUNGE,
	});
	await settled();
	assert.equal(genre.answer.status, 200);

	control(state, "holdRows", {});
	control(state, "holdQuestions", { hold: true });
	const window = sendRows(state, body);
	await settled();
	assert.equal(window.answer.status, 200);
});

test("failRows refuses as many windows as it says with its status, then answers", async (t) => {
	frozenAt(t);
	for (const status of [500, 503]) {
		const state = declared(withFake({ failRows: { status, times: 2 } }));
		const body = await byOrdinals(state, [0]);
		assert.equal((await askRows(state, body)).status, status);
		assert.equal((await askRows(state, body)).status, status);
		assert.equal((await askRows(state, body)).status, 200);
	}
});

test("failRows with 429 refuses as the rows bucket does, Retry-After and all", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ failRows: { status: 429, times: 1 } }));
	const body = await byOrdinals(state, [0]);

	const refused = await askRows(state, body);

	assert.equal(refused.status, 429);
	assert.deepEqual(bodyOf(refused), TOO_MANY_ROWS);
	assert.match(refused.headers["retry-after"] ?? "", /^[1-9]\d*$/);
	assert.equal((await askRows(state, body)).status, 200);
});

test("failRows with a dropped connection destroys as many windows unanswered, then answers", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ failRows: { status: "drop", times: 1 } }));
	const body = await byOrdinals(state, [0]);

	const dropped = sendRows(state, body);
	await settled();
	assert.equal(dropped.answer.dropped, true);
	assert.equal(dropped.answer.answered, false);
	assert.equal((await askRows(state, body)).status, 200);
});

test("failRows refuses no question", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ failRows: { status: 500, times: 1 } }));

	const genre = await ask(state, "/api/library/genre", {
		query: GRUNGE,
	});

	assert.equal(genre.status, 200);
	assert.equal(
		(await askRows(state, await byOrdinals(state, [0]))).status,
		500,
	);
});
