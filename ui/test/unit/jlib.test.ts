import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	decodeJlib,
	type Jlib,
	patchColumn,
} from "../../src/shared/api/jlib.ts";
import {
	type Body,
	changedColumn,
	dictionary,
	encodeJlib,
	wholeColumn,
} from "../fake-api/jlib.ts";
import { createState } from "../fake-api/state.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

const roundTrip = (body: Body) => decodeJlib(bufferOf(encodeJlib(body)));

const columnOf = (values: string[], name: string | null = "%title%") =>
	wholeColumn(name, dictionary(), values);

const spineOf = (count: number) => ({
	directory: columnOf(
		Array.from({ length: count }, (_, at) => `d${at % 3}/`),
		null,
	),
	filename: columnOf(
		Array.from({ length: count }, (_, at) => `${at}.mp3`),
		null,
	),
	subsong: columnOf(
		Array.from({ length: count }, () => "0"),
		null,
	),
});

const snapshotOf = (values: string[]): Body => ({
	kind: "snapshot",
	structure: 4,
	revision: 191,
	trackCount: values.length,
	columns: [columnOf(values)],
	spine: spineOf(values.length),
});

const readBack = (library: Jlib, name: string) => {
	const column = library.columns.get(name);
	assert.ok(column, `no ${name} column`);
	return Array.from({ length: library.trackCount }, (_, at) => column.at(at));
};

test("every value comes back exactly as it went in", () => {
	const values = [
		"Los Calientes",
		"Fizz",
		"Los Calientes",
		"",
		"N/A",
		"?",
		"0",
	];
	assert.deepEqual(readBack(roundTrip(snapshotOf(values)), "%title%"), values);
});

test("the three ways a field can be blank stay three different answers", () => {
	const library = roundTrip(snapshotOf(["?", "", "N/A", "value"]));
	const column = library.columns.get("%title%");
	assert.ok(column);

	assert.equal(column.at(0), "?");
	assert.equal(column.at(1), "");
	assert.equal(column.at(2), "N/A");
	assert.equal(column.distinct, 4);
	assert.equal(column.hasUnresolved, true);
	assert.equal(column.allUnresolved, false);
});

test("a column the player resolves for nothing says so", () => {
	const column = roundTrip(snapshotOf(["?", "?", "?"])).columns.get("%title%");
	assert.ok(column);
	assert.equal(column.hasUnresolved, true);
	assert.equal(column.allUnresolved, true);
	assert.equal(column.distinct, 1);
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
	assert.deepEqual(readBack(roundTrip(snapshotOf(values)), "%title%"), values);
});

test("a dictionary wider than a byte and one wider than two", () => {
	const wide = Array.from({ length: 300 }, (_, at) => `value ${at}`);
	const wider = Array.from({ length: 70_000 }, (_, at) => `value ${at}`);

	assert.deepEqual(readBack(roundTrip(snapshotOf(wide)), "%title%"), wide);

	const library = roundTrip(snapshotOf(wider));
	const column = library.columns.get("%title%");
	assert.ok(column);
	assert.equal(column.ids.BYTES_PER_ELEMENT, 4);
	assert.equal(column.at(0), "value 0");
	assert.equal(column.at(69_999), "value 69999");
});

test("the spine reads back as a library-relative path", () => {
	const library = roundTrip(snapshotOf(["a", "b", "c", "d"]));
	assert.equal(library.kind, "snapshot");
	if (library.kind !== "snapshot") return;
	const { directory, filename } = library.spine;
	assert.deepEqual(
		Array.from({ length: 4 }, (_, at) => directory.at(at) + filename.at(at)),
		["d0/0.mp3", "d1/1.mp3", "d2/2.mp3", "d0/3.mp3"],
	);
});

test("an empty library decodes to nothing rather than throwing", () => {
	const library = roundTrip(snapshotOf([]));
	assert.equal(library.trackCount, 0);
	assert.equal(library.columns.get("%title%")?.distinct, 0);
});

test("every section starts where a typed array can be taken over it", () => {
	const bytes = encodeJlib(snapshotOf(["one", "two", "three"]));
	const headerBytes = new DataView(bufferOf(bytes)).getUint32(4, true);
	const blobAt = 8 + headerBytes;
	assert.equal(blobAt % 4, 0);

	const header = JSON.parse(
		new TextDecoder().decode(bytes.subarray(8, blobAt)),
	) as {
		columns: { ids: { offset: number }; dict: { ends: { offset: number } } }[];
	};
	for (const column of header.columns) {
		assert.equal(column.ids.offset % 4, 0);
		assert.equal(column.dict.ends.offset % 4, 0);
	}
});

test("bytes that are not a snapshot are refused by name", () => {
	assert.throws(
		() => decodeJlib(new TextEncoder().encode("not a library at all").buffer),
		/magic number/,
	);
	assert.throws(() => decodeJlib(new ArrayBuffer(4)), /framing/);
});

const FIXTURE = join(HERE, "fixtures/library.jlib");

const committedFixture = () => new Uint8Array(readFileSync(FIXTURE));

const encodedFixture = () => {
	const state = createState();
	state.libraryFeed.columns = [...TRACK_EXPRESSIONS];
	return state.libraryExport();
};

const firstDifference = (a: Uint8Array, b: Uint8Array) => {
	const shared = Math.min(a.length, b.length);
	for (let at = 0; at < shared; at += 1) if (a[at] !== b[at]) return at;
	return a.length === b.length ? -1 : shared;
};

test("the fake still encodes the committed fixture byte for byte", () => {
	assert.equal(firstDifference(encodedFixture(), committedFixture()), -1);
});

test("the committed fixture decodes to the library it was made from", () => {
	const library = decodeJlib(bufferOf(committedFixture()));

	assert.equal(library.kind, "snapshot");
	assert.equal(library.trackCount, 54);
	assert.equal(library.columns.size, TRACK_EXPRESSIONS.length);

	const first = library.spine.directory.at(0) + library.spine.filename.at(0);
	assert.match(first, /\.(mp3|flac)$/);
	assert.equal(
		library.columns.get("%artist%")?.at(0),
		library.columns
			.get("%artist%")
			?.value(library.columns.get("%artist%")!.ids[0]),
	);
	assert.equal(library.spine.subsong.at(0), "0");
});

const REAL_EXPORT = process.env.JEAN_LIBRARY_EXPORT;

test("a real export decodes to the counts the player reported", {
	skip: REAL_EXPORT
		? false
		: "set JEAN_LIBRARY_EXPORT to a .jlib captured from a player",
}, () => {
	const bytes = new Uint8Array(readFileSync(REAL_EXPORT as string));
	const library = decodeJlib(bufferOf(bytes));

	assert.equal(library.kind, "snapshot");
	assert.equal(library.trackCount, 30_441);

	const distinct: Record<string, number> = {
		"%title%": 26_474,
		"%artist%": 1829,
		"%album%": 2340,
		"%album artist%": 743,
		"%genre%": 145,
		"%codec%": 8,
		"%bitrate%": 1003,
		"%play_count%": 1,
	};

	for (const [name, count] of Object.entries(distinct))
		assert.equal(library.columns.get(name)?.distinct, count, name);

	assert.equal(library.columns.get("%play_count%")?.allUnresolved, true);
	assert.equal(library.columns.get("%title%")?.hasUnresolved, false);

	// Every id addresses a value, and every row a path: the whole snapshot is read rather than
	// sampled, since a bad offset shows up on one row in thirty thousand.
	for (const [, column] of library.columns)
		for (let row = 0; row < library.trackCount; row += 1)
			assert.equal(typeof column.at(row), "string");

	for (let row = 0; row < library.trackCount; row += 1)
		assert.ok(
			(library.spine.directory.at(row) + library.spine.filename.at(row))
				.length > 0,
		);
});

// 378 bytes off a real player, carrying one column, one ordinal and nothing appended. An encoder and
// a decoder written together agree with each other and can still disagree with the component.
const DELTA = join(HERE, "fixtures/delta.jlib");

const PLAY_COUNT = "%lastfm_play_count%";

const heldFor = (trackCount: number, distinct: number) => {
	const values = Array.from({ length: trackCount }, (_, at) =>
		String(at % distinct),
	);
	const library = roundTrip({
		kind: "snapshot",
		structure: 4,
		revision: 220,
		trackCount,
		columns: [columnOf(values, PLAY_COUNT)],
		spine: spineOf(trackCount),
	});
	const column = library.columns.get(PLAY_COUNT);
	assert.ok(column && "at" in column);
	return column;
};

test("a delta the component wrote reads back as one column and one ordinal", () => {
	const delta = decodeJlib(bufferOf(new Uint8Array(readFileSync(DELTA))));

	assert.equal(delta.kind, "delta");
	if (delta.kind !== "delta") return;

	assert.equal(delta.structure, 4);
	assert.equal(delta.since, 220);
	assert.equal(delta.revision, 221);
	assert.deepEqual(delta.spine, []);
	assert.deepEqual([...delta.columns.keys()], [PLAY_COUNT]);

	const patch = delta.columns.get(PLAY_COUNT);
	assert.ok(patch);
	assert.equal(patch.ordinals.length, 1);
	assert.equal(patch.ids.length, 1);
	assert.equal(patch.base, 159);
	assert.equal(patch.distinct, 159);
	assert.deepEqual(patch.appended, []);
});

test("that delta moves the row it names and no other", () => {
	const delta = decodeJlib(bufferOf(new Uint8Array(readFileSync(DELTA))));
	if (delta.kind !== "delta") return assert.fail("not a delta");

	const patch = delta.columns.get(PLAY_COUNT);
	assert.ok(patch);

	// `base` is the dictionary the component expects the client to hold, so the snapshot it patches
	// has to carry exactly that many values over exactly that many rows.
	const held = heldFor(delta.trackCount, patch.base);
	const patched = patchColumn(held, patch);
	assert.ok(patched);

	const ordinal = patch.ordinals[0];
	assert.equal(patched.at(ordinal), String(patch.ids[0]));
	assert.notEqual(patched.at(ordinal), held.at(ordinal));

	let differences = 0;
	for (let row = 0; row < delta.trackCount; row += 1)
		if (patched.at(row) !== held.at(row)) differences += 1;
	assert.equal(differences, 1);
});

test("a patched column owns its ids rather than viewing the bytes it arrived in", () => {
	const delta = decodeJlib(bufferOf(new Uint8Array(readFileSync(DELTA))));
	if (delta.kind !== "delta") return assert.fail("not a delta");

	const patch = delta.columns.get(PLAY_COUNT);
	assert.ok(patch);

	const held = heldFor(delta.trackCount, patch.base);
	const patched = patchColumn(held, patch);
	assert.ok(patched);
	assert.notEqual(patched.ids.buffer, held.ids.buffer);
	assert.equal(held.at(patch.ordinals[0]), String(patch.ordinals[0] % 159));
});

test("a dictionary the client is not holding the whole of is refused", () => {
	const delta = decodeJlib(bufferOf(new Uint8Array(readFileSync(DELTA))));
	if (delta.kind !== "delta") return assert.fail("not a delta");

	const patch = delta.columns.get(PLAY_COUNT);
	assert.ok(patch);
	assert.equal(
		patchColumn(heldFor(delta.trackCount, patch.base - 1), patch),
		null,
	);
});

test("appended dictionary entries are readable at the ids that address them", () => {
	const dict = dictionary();
	const held = roundTrip({
		kind: "snapshot",
		structure: 4,
		revision: 1,
		trackCount: 3,
		columns: [wholeColumn("%title%", dict, ["one", "two", "one"])],
		spine: spineOf(3),
	}).columns.get("%title%");
	assert.ok(held && "at" in held);

	const delta = roundTrip({
		kind: "delta",
		structure: 4,
		revision: 2,
		since: 1,
		trackCount: 3,
		columns: [
			changedColumn("%title%", dict, 2, [{ ordinal: 2, value: "Sigur Rós" }]),
		],
		spine: {},
	});
	if (delta.kind !== "delta") return assert.fail("not a delta");

	const patch = delta.columns.get("%title%");
	assert.ok(patch);
	assert.deepEqual(patch.appended, ["Sigur Rós"]);

	const patched = patchColumn(held, patch);
	assert.ok(patched);
	assert.deepEqual(
		[patched.at(0), patched.at(1), patched.at(2)],
		["one", "two", "Sigur Rós"],
	);
	assert.equal(patched.distinct, 3);
});

test("a dictionary that outgrew its width is widened rather than wrapped", () => {
	const dict = dictionary();
	const values = Array.from({ length: 300 }, (_, at) => `value ${at % 256}`);
	const held = roundTrip({
		kind: "snapshot",
		structure: 4,
		revision: 1,
		trackCount: 300,
		columns: [wholeColumn("%title%", dict, values)],
		spine: spineOf(300),
	}).columns.get("%title%");
	assert.ok(held && "at" in held);
	assert.equal(held.ids.BYTES_PER_ELEMENT, 1);

	const delta = roundTrip({
		kind: "delta",
		structure: 4,
		revision: 2,
		since: 1,
		trackCount: 300,
		columns: [
			changedColumn("%title%", dict, 256, [{ ordinal: 9, value: "new" }]),
		],
		spine: {},
	});
	if (delta.kind !== "delta") return assert.fail("not a delta");

	const patch = delta.columns.get("%title%");
	assert.ok(patch);

	const patched = patchColumn(held, patch);
	assert.ok(patched);
	assert.equal(patched.ids.BYTES_PER_ELEMENT, 2);
	assert.equal(patched.at(9), "new");
	assert.equal(patched.at(10), "value 10");
});
