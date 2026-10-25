import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { LIBRARY_ROLES } from "../../src/domain/track/libraryAsker.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import { decodeRows } from "../../src/shared/api/jlib.ts";
import { readRows, readRuns } from "../../src/shared/api/libraryRows.ts";
import { LIBRARY_ROLE_NAMES } from "../fake-api/fooJean/librarySummary.ts";
import {
	type Column,
	encodeJlib,
	sortedDictionary,
	wholeColumn,
} from "../fake-api/jlib.ts";

type Library = components["schemas"]["Library"];
type LibraryRuns = components["schemas"]["LibraryRuns"];

const ORIGIN = "http://rows.invalid:8881";
const TITLE = "%title%";
const ARTIST = "%artist%";
const MISSING = "%no_such_field%";
const COLUMNS = [TITLE, ARTIST, MISSING];
const STRUCTURE = 41;
const REVISION = 903;
const TRACK_COUNT = 12;
const LIBRARY_TITLES = 40;

const UTF8 = new TextDecoder();
const ENCODE = new TextEncoder();

interface Sent {
	url: URL;
	method: string;
	headers: Headers;
	body: unknown;
}

type Answer = Response | "unreachable";

const fakeFetch = (t: TestContext, answer: (sent: Sent) => Answer) => {
	const sent: Sent[] = [];
	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
	globalThis.fetch = (async (
		input: Request | URL | string,
		init?: RequestInit,
	) => {
		const request = new Request(input, init);
		const text = await request.text();
		const one: Sent = {
			url: new URL(request.url),
			method: request.method,
			headers: request.headers,
			body: text ? JSON.parse(text) : null,
		};
		sent.push(one);
		const answered = answer(one);
		if (answered === "unreachable") throw new TypeError("fetch failed");
		return answered;
	}) as typeof fetch;
	return sent;
};

const titleOf = (ordinal: number) => `title ${ordinal}`;
const artistOf = (ordinal: number) => `artist ${ordinal % 3}`;
const directoryOf = (ordinal: number) => `Music/${ordinal % 2}/`;

const column = (
	name: string | null,
	values: string[],
	library: Partial<Column> = {},
): Column => ({
	...wholeColumn(name, sortedDictionary(values), values),
	...library,
});

const asRowsBody = (delta: Uint8Array, rows: number, kind = "rows") => {
	const framing = new DataView(delta.buffer, delta.byteOffset);
	const headerBytes = framing.getUint32(4, true);
	const header = JSON.parse(UTF8.decode(delta.subarray(8, 8 + headerBytes)));
	const json = ENCODE.encode(JSON.stringify({ ...header, kind, rows }));
	const padded = (json.length + 3) & ~3;
	const blob = delta.subarray(8 + headerBytes);
	const out = new Uint8Array(8 + padded + blob.length);
	out.set(ENCODE.encode("JLIB"), 0);
	new DataView(out.buffer).setUint32(4, padded, true);
	out.set(json, 8);
	out.fill(0x20, 8 + json.length, 8 + padded);
	out.set(blob, 8 + padded);
	return out;
};

const rowsBody = (ordinals: number[], kind = "rows") =>
	asRowsBody(
		encodeJlib({
			kind: "delta",
			structure: STRUCTURE,
			revision: REVISION,
			trackCount: TRACK_COUNT,
			columns: [
				column(TITLE, ordinals.map(titleOf), {
					distinct: LIBRARY_TITLES,
					hasUnresolved: true,
				}),
				column(ARTIST, ordinals.map(artistOf)),
				column(
					MISSING,
					ordinals.map(() => "?"),
				),
			],
			spine: {
				directory: column(null, ordinals.map(directoryOf)),
				filename: column(
					null,
					ordinals.map((ordinal) => `${ordinal}.flac`),
				),
				subsong: column(
					null,
					ordinals.map(() => "0"),
				),
			},
		}),
		ordinals.length,
		kind,
	);

const binary = (bytes: Uint8Array<ArrayBuffer>) =>
	new Response(bytes, {
		headers: { "Content-Type": "application/octet-stream" },
	});

const answeringRows = (sent: Sent) => {
	const body = sent.body as { ordinals?: number[]; runs?: [number, number][] };
	const ordinals =
		body.ordinals ??
		(body.runs ?? []).flatMap(([start, length]) =>
			Array.from({ length }, (_, step) => start + step),
		);
	return binary(rowsBody(ordinals));
};

const LIBRARY_BUILDING: Library = {
	ready: true,
	structure: STRUCTURE,
	revision: REVISION,
	trackCount: TRACK_COUNT,
	columns: [TITLE],
	changeCounts: [0],
	build: { phase: "formatting", formatted: 0, total: TRACK_COUNT },
	halted: false,
};

const cellsOf = (
	window: { columns: ReadonlyMap<string, { at: (row: number) => string }> },
	name: string,
	rows: number,
) => {
	const cells = window.columns.get(name);
	assert.ok(cells, `the window carries no ${name}`);
	return Array.from({ length: rows }, (_, row) => cells.at(row));
};

test("rows named by ordinals are posted as the declaration, the structure as its digits and the ordinals in the order given, and come back as those rows' cells in that order", async (t) => {
	const sent = fakeFetch(t, answeringRows);
	const result = await readRows(ORIGIN, {
		columns: COLUMNS,
		structure: STRUCTURE,
		set: { ordinals: [9, 0, 1] },
	});

	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, "POST");
	assert.equal(sent[0].url.pathname, "/api/library/rows");
	assert.match(sent[0].headers.get("Content-Type") ?? "", /^application\/json/);
	assert.deepEqual(sent[0].body, {
		columns: COLUMNS,
		structure: String(STRUCTURE),
		ordinals: [9, 0, 1],
	});

	assert.ok(result.ok, "a rows answer was read as a failure");
	const { window } = result;
	assert.deepEqual([...window.ordinals], [9, 0, 1]);
	assert.equal(window.rows, 3);
	assert.deepEqual(cellsOf(window, TITLE, 3), [9, 0, 1].map(titleOf));
	assert.deepEqual(cellsOf(window, ARTIST, 3), [9, 0, 1].map(artistOf));
	assert.deepEqual(
		Array.from({ length: 3 }, (_, row) => window.spine.directory.at(row)),
		[9, 0, 1].map(directoryOf),
	);
});

test("rows named by runs are posted as those runs, and the window names the ordinals they cover in ascending order", async (t) => {
	const sent = fakeFetch(t, answeringRows);
	const result = await readRows(ORIGIN, {
		columns: COLUMNS,
		structure: STRUCTURE,
		set: {
			runs: [
				[4, 3],
				[10, 2],
			],
		},
	});

	assert.deepEqual(sent[0].body, {
		columns: COLUMNS,
		structure: String(STRUCTURE),
		runs: [
			[4, 3],
			[10, 2],
		],
	});
	assert.ok(result.ok, "a rows answer was read as a failure");
	assert.deepEqual([...result.window.ordinals], [4, 5, 6, 10, 11]);
	assert.deepEqual(
		cellsOf(result.window, TITLE, 5),
		[4, 5, 6, 10, 11].map(titleOf),
	);
});

test("a rows window carries the header's pair, the whole library's track count and each column's library-wide facts rather than ones counted over its own rows", async (t) => {
	fakeFetch(t, answeringRows);
	const result = await readRows(ORIGIN, {
		columns: COLUMNS,
		structure: STRUCTURE,
		set: { ordinals: [2, 3] },
	});

	assert.ok(result.ok, "a rows answer was read as a failure");
	const { window } = result;
	assert.equal(window.structure, STRUCTURE);
	assert.equal(window.revision, REVISION);
	assert.equal(window.trackCount, TRACK_COUNT);

	const title = window.columns.get(TITLE);
	assert.equal(title?.distinct, LIBRARY_TITLES);
	assert.equal(title?.hasUnresolved, true);
	assert.equal(title?.allUnresolved, false);
	assert.equal(window.columns.get(MISSING)?.allUnresolved, true);
	assert.equal(window.columns.get(ARTIST)?.hasUnresolved, false);
});

test("a body whose header names another kind than rows is a failure, whatever route answered it", async (t) => {
	fakeFetch(t, (sent) => {
		const body = sent.body as { ordinals: number[] };
		return binary(rowsBody(body.ordinals, "delta"));
	});
	const result = await readRows(ORIGIN, {
		columns: COLUMNS,
		structure: STRUCTURE,
		set: { ordinals: [0] },
	});

	assert.equal(result.ok, false);
	assert.ok(!result.ok);
	assert.equal(result.reason, "failed");
});

const refused = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) => Response.json(body, { status, headers });

const failureOf = async (t: TestContext, answer: Answer) => {
	fakeFetch(t, () => answer);
	const result = await readRows(ORIGIN, {
		columns: COLUMNS,
		structure: STRUCTURE,
		set: { ordinals: [0] },
	});
	assert.ok(!result.ok, "a refusal was read as rows");
	return result;
};

test("a 429 is too fast, carrying the Retry-After it was sent in milliseconds", async (t) => {
	const failure = await failureOf(
		t,
		refused(
			429,
			{ error: "too many library row reads" },
			{ "Retry-After": "2" },
		),
	);
	assert.equal(failure.reason, "tooFast");
	assert.equal(failure.retryAfterMs, 2_000);
	assert.equal(failure.structureMoved, false);
});

test("a 409 says the structure moved, so the caller reads the state again rather than declaring", async (t) => {
	const failure = await failureOf(
		t,
		refused(409, {
			error: "tracks were added or removed; read the state and ask again",
			detail: "",
		}),
	);
	assert.equal(failure.structureMoved, true);
	assert.equal(failure.building, null);
});

test("a 202 is not ready and carries the library document it answered, which names the build under way", async (t) => {
	const failure = await failureOf(t, refused(202, LIBRARY_BUILDING));
	assert.equal(failure.reason, "notReady");
	assert.deepEqual(failure.building, LIBRARY_BUILDING);
	assert.equal(failure.structureMoved, false);
});

test("the other refusals each map to their own reason and none of them says the structure moved", async (t) => {
	const cases: [string, Answer, string][] = [
		["400", refused(400, { error: "malformed request" }), "refused"],
		["503", refused(503, { error: "library unavailable" }), "unavailable"],
		["500", new Response("", { status: 500 }), "failed"],
		["no answer", "unreachable", "unreachable"],
	];
	for (const [name, answer, reason] of cases) {
		await t.test(name, async (each) => {
			const failure = await failureOf(each, answer);
			assert.equal(failure.reason, reason);
			assert.equal(failure.structureMoved, false);
			assert.equal(failure.building, null);
			assert.equal(failure.retryAfterMs, null);
		});
	}
});

const RUNS: LibraryRuns = {
	structure: STRUCTURE,
	revision: REVISION,
	lengths: [3, 1, 8],
	covers: [1, 3, 4],
	untagged: [],
};
const RUNS_TAG = '"runs-s41-r903"';

const answeringRuns = (sent: Sent) =>
	sent.headers.get("If-None-Match") === RUNS_TAG
		? new Response(null, { status: 304, headers: { ETag: RUNS_TAG } })
		: Response.json(RUNS, { headers: { ETag: RUNS_TAG } });

test("the runs are asked with every role named once by its expression, and come back with the ETag that names them", async (t) => {
	const sent = fakeFetch(t, answeringRuns);
	const result = await readRuns(ORIGIN, LIBRARY_ROLES);

	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, "GET");
	assert.equal(sent[0].url.pathname, "/api/library/runs");
	assert.equal(sent[0].headers.get("If-None-Match"), null);
	for (const role of LIBRARY_ROLE_NAMES)
		assert.deepEqual(
			sent[0].url.searchParams.getAll(role),
			[LIBRARY_ROLES[role]],
			`${role} is not named once by its expression`,
		);

	assert.ok(result.ok && !result.unchanged, "the runs were not read");
	assert.deepEqual(result.runs, RUNS);
	assert.equal(result.etag, RUNS_TAG);
});

test("runs asked again with the ETag held send it as If-None-Match, and a 304 reads as unchanged", async (t) => {
	const sent = fakeFetch(t, answeringRuns);
	const result = await readRuns(ORIGIN, LIBRARY_ROLES, RUNS_TAG);

	assert.equal(sent[0].headers.get("If-None-Match"), RUNS_TAG);
	assert.deepEqual(result, { ok: true, unchanged: true });
});

test("runs refused 429 are too fast, carrying the Retry-After in milliseconds", async (t) => {
	fakeFetch(t, () =>
		refused(
			429,
			{ error: "too many library run reads" },
			{ "Retry-After": "3" },
		),
	);
	const result = await readRuns(ORIGIN, LIBRARY_ROLES, RUNS_TAG);

	assert.ok(!result.ok, "a refusal was read as runs");
	assert.equal(result.reason, "tooFast");
	assert.equal(result.retryAfterMs, 3_000);
});

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

const titlesWindow = (values: string[]) =>
	decodeRows(
		bufferOf(
			asRowsBody(
				encodeJlib({
					kind: "delta",
					structure: STRUCTURE,
					revision: REVISION,
					trackCount: values.length,
					columns: [column(TITLE, values)],
					spine: {
						directory: column(
							null,
							values.map(() => "Music/"),
						),
						filename: column(
							null,
							values.map((_, row) => `${row}.flac`),
						),
						subsong: column(
							null,
							values.map(() => "0"),
						),
					},
				}),
				values.length,
			),
		),
	);

const titlesReadBack = (values: string[]) =>
	cellsOf(titlesWindow(values), TITLE, values.length);

test("every value in a window comes back exactly as it went in, and the three ways a field can be blank stay three different answers", () => {
	const values = [
		"Los Calientes",
		"Fizz",
		"Los Calientes",
		"",
		"N/A",
		"?",
		"0",
	];
	assert.deepEqual(titlesReadBack(values), values);
});

test("a value with characters outside ASCII comes back whole", () => {
	const values = [
		"Babasónicos",
		"椎名林檎",
		"Sigur Rós",
		"🎵 mixtape 🎧",
		"plain",
		"Babasónicos",
	];
	assert.deepEqual(titlesReadBack(values), values);
});

// A browser's `TextDecoder` drops a byte order mark that opens what it decodes unless told not to,
// and a tag can begin with one. The player hashes and sorts the value with it, so a value read
// without it is a different value from the one the player holds.
const BOM = "﻿";

test("a value that begins with a byte order mark comes back with it", () => {
	const values = [`${BOM}Ágata`, "plain", BOM, `${BOM}${BOM}twice`, "plain"];
	assert.deepEqual(titlesReadBack(values), values);
});

test("a dictionary wider than a byte and one wider than two read back at every id", () => {
	const wide = Array.from({ length: 300 }, (_, at) => `value ${at}`);
	const wider = Array.from({ length: 70_000 }, (_, at) => `value ${at}`);

	assert.deepEqual(titlesReadBack(wide), wide);

	const column = titlesWindow(wider).columns.get(TITLE);
	assert.ok(column);
	assert.equal(column.ids.BYTES_PER_ELEMENT, 4);
	assert.equal(column.at(0), "value 0");
	assert.equal(column.at(69_999), "value 69999");
});

test("bytes that are not a JLIB body are refused as malformed", () => {
	assert.throws(
		() => decodeRows(new TextEncoder().encode("not a library at all").buffer),
		/malformed JLIB/,
	);
	assert.throws(() => decodeRows(new ArrayBuffer(4)), /malformed JLIB/);
});
