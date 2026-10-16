import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { components } from "../../src/shared/api/fooJeanSchema";
import { decodeJlib, type JlibColumn } from "../../src/shared/api/jlib.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { handleControl } from "../fake-api/routes.ts";
import { createState, type Track } from "../fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;
type Header = components["schemas"]["LibraryHeader"];
type HeaderColumn = components["schemas"]["LibraryColumn"];
type Section = components["schemas"]["LibrarySection"];

const PLAY_COUNT = "%lastfm_play_count%";
const DECLARED = ["%title%", "%album%", "%artist%", PLAY_COUNT];
const SPINE = ["directory", "filename", "subsong"] as const;

const RETAINED_REVISIONS = (() => {
	const header = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../../../plugins/fb2k/src/core/library.h",
		),
		"utf8",
	);
	const declared = new Map(
		[...header.matchAll(/constexpr\s+size_t\s+(\w+)\s*=\s*([^;]+);/g)].map(
			([, constant, value]) => [constant, value],
		),
	);
	const evaluated = (constant: string): number => {
		const value = declared.get(constant);
		assert.ok(value !== undefined, `library.h declares no ${constant}`);
		return value
			.split("*")
			.map((term) => term.trim())
			.reduce(
				(product, term) =>
					product * (/^\d+$/.test(term) ? Number(term) : evaluated(term)),
				1,
			);
	};
	return evaluated("kRetainedRevisions");
})();

const LIBRARY = () => libraryOfShape({ tracks: 600, albums: 40, artists: 8 });

const CUE_SHEETS = () => libraryOfShape({ tracks: 600, subsongsPerFile: 3 });

interface Answer {
	status: number;
	body: Uint8Array<ArrayBuffer>;
}

const responderFor = (answer: Answer): Responder => {
	const chunks: Uint8Array[] = [];
	const write = (chunk: string | Uint8Array) => {
		chunks.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	};
	return {
		writeHead(code) {
			answer.status = code;
		},
		setHeader() {},
		write,
		end(chunk) {
			if (chunk !== undefined) write(chunk);
			const body = new Uint8Array(
				chunks.reduce((total, one) => total + one.length, 0),
			);
			let at = 0;
			for (const one of chunks) {
				body.set(one, at);
				at += one.length;
			}
			answer.body = body;
		},
		on() {},
		destroy() {},
	};
};

const ask = async (
	state: FakeState,
	path: string,
	query: [string, string | number][] = [],
	method = "GET",
) => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query)
		url.searchParams.append(name, String(value));
	const answer: Answer = { status: 0, body: new Uint8Array() };
	await handleFooJean({
		state,
		method,
		url,
		headers: {},
		body: null,
		response: responderFor(answer),
		artwork: () => false,
	});
	return answer;
};

const control = (state: FakeState, action: string, body: object) => {
	const answer: Answer = { status: 0, body: new Uint8Array() };
	handleControl({
		state,
		method: "POST",
		path: `/__control/${action}`,
		body: body as never,
		response: responderFor(answer),
	});
	assert.ok(
		answer.status < 300,
		`POST /__control/${action} answered ${answer.status}`,
	);
};

const textOf = (answer: Answer) => new TextDecoder().decode(answer.body);

const why = (answer: Answer) =>
	answer.status === 200 ? "a body, not a refusal" : textOf(answer);

// `describe(DeltaOutcome)` in `plugins/fb2k/src/core/failures.cpp`, which answers every refusal of
// `GET /api/library/changes` with an empty `detail`.
const PAIR_NOT_HELD =
	"that structure and revision name no position this library held; export the library again";
const REVISION_TOO_OLD =
	"that revision is older than the retained window; export the library again";
const REVISION_UNKNOWN = "no such revision";
const SPLICE_TOO_LARGE =
	"the tracks added or removed since then are too many to send; export the library again";
const REARRANGED =
	"the library was rebuilt with other columns or in another order; export the library again";
const COMPACTED =
	"the library was rebuilt with its dictionaries compacted; export the library again";

const assertRefused = (answer: Answer, status: number, error: string) => {
	assert.equal(answer.status, status, why(answer));
	assert.deepEqual(JSON.parse(textOf(answer)), { error, detail: "" });
};

interface Pair {
	structure: number;
	revision: number;
}

const pairOf = async (state: FakeState): Promise<Pair> => {
	const answer = await ask(state, "/api/state");
	assert.equal(answer.status, 200);
	const { structure, revision } = JSON.parse(textOf(answer)).library;
	return { structure, revision };
};

const snapshotIdOf = async (state: FakeState): Promise<string> =>
	JSON.parse(textOf(await ask(state, "/api/state"))).library.snapshotId;

const exportOf = (state: FakeState, declared = DECLARED) =>
	ask(
		state,
		"/api/library/export",
		declared.map((column): [string, string] => ["columns", column]),
	);

const changesFrom = (state: FakeState, held: Pair) =>
	ask(state, "/api/library/changes", [
		["since", held.revision],
		["structure", held.structure],
	]);

const atThePlayer = async (
	state: FakeState,
	change: { add?: number; remove?: number },
) => {
	control(state, "library", change);
	return pairOf(state);
};

const playAt = (state: FakeState, ordinal: number) =>
	control(state, "play", { ordinal });

interface HeldColumn {
	values: string[];
	ids: number[];
}

type Table = Map<string, HeldColumn>;

const heldColumn = (column: JlibColumn): HeldColumn => ({
	values: Array.from({ length: column.distinct }, (_, id) => column.value(id)),
	ids: Array.from(column.ids),
});

const tableOf = (answer: Answer): { table: Table; trackCount: number } => {
	assert.equal(answer.status, 200, `the export answered ${answer.status}`);
	const library = decodeJlib(answer.body.slice().buffer);
	assert.equal(library.kind, "snapshot");
	if (library.kind !== "snapshot") throw new Error("not a snapshot");
	const table: Table = new Map();
	for (const name of SPINE) table.set(name, heldColumn(library.spine[name]));
	for (const [name, column] of library.columns)
		table.set(name, heldColumn(column));
	return { table, trackCount: library.trackCount };
};

const rowKey = (table: Table, row: number) =>
	SPINE.map((name) => {
		const column = table.get(name) as HeldColumn;
		return column.values[column.ids[row]];
	}).join("\u0000");

const rowsOf = (table: Table, trackCount: number) =>
	Array.from({ length: trackCount }, (_, row) => rowKey(table, row));

function rowsChanged(
	before: { table: Table; trackCount: number },
	after: { table: Table; trackCount: number },
) {
	const was = rowsOf(before.table, before.trackCount);
	const now = rowsOf(after.table, after.trackCount);
	const wasSet = new Set(was);
	const nowSet = new Set(now);
	return {
		removed: was.flatMap((key, row) => (nowSet.has(key) ? [] : [row])),
		inserted: now.flatMap((key, row) => (wasSet.has(key) ? [] : [row])),
	};
}

interface SpliceColumn {
	ordinals: number[];
	ids: number[];
	base: number;
	appended: string[];
}

interface Splice {
	header: Header;
	removed: number[];
	inserted: number[];
	spine: Map<string, SpliceColumn>;
	columns: Map<string, SpliceColumn>;
}

function spliceOf(answer: Answer): Splice {
	assert.equal(
		answer.status,
		200,
		`GET /api/library/changes answered ${answer.status} ${textOf(answer)}`,
	);
	const { body } = answer;
	assert.equal(new TextDecoder().decode(body.subarray(0, 4)), "JLIB");
	const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
	const headerBytes = view.getUint32(4, true);
	const header = JSON.parse(
		new TextDecoder().decode(body.subarray(8, 8 + headerBytes)),
	) as Header;
	const blobAt = 8 + headerBytes;
	assert.equal(
		blobAt % 4,
		0,
		"the blob does not start on a four-byte boundary",
	);

	const integers = (section: Section | undefined, what: string) => {
		assert.ok(section, `the splice carries no ${what}`);
		assert.equal(
			section.offset % 4,
			0,
			`${what} is not on a four-byte boundary`,
		);
		return Array.from({ length: section.count }, (_, index) => {
			const at = blobAt + section.offset + index * section.width;
			if (section.width === 1) return view.getUint8(at);
			if (section.width === 2) return view.getUint16(at, true);
			return view.getUint32(at, true);
		});
	};

	const columnOf = (column: HeaderColumn, what: string): SpliceColumn => {
		assert.ok(column.dict, `${what} carries no dictionary`);
		assert.notEqual(
			column.dict.base,
			undefined,
			`${what} carries no dict.base`,
		);
		const ends = integers(column.dict.ends, `${what} dict.ends`);
		const textAt = blobAt + column.dict.text.offset;
		const text = body.subarray(textAt, textAt + column.dict.text.length);
		return {
			ordinals: integers(column.ordinals, `${what} ordinals`),
			ids: integers(column.ids, `${what} ids`),
			base: column.dict.base as number,
			appended: ends.map((end, at) =>
				new TextDecoder().decode(
					text.subarray(at === 0 ? 0 : ends[at - 1], end),
				),
			),
		};
	};

	return {
		header,
		removed: integers(header.removed, "removed"),
		inserted: integers(header.inserted, "inserted"),
		spine: new Map(
			Object.entries(header.spine).map(([name, column]) => [
				name,
				columnOf(column as HeaderColumn, name),
			]),
		),
		columns: new Map(
			header.columns.map((column) => [
				column.name as string,
				columnOf(column, column.name as string),
			]),
		),
	};
}

function spliced(held: Table, splice: Splice): Table {
	const after: Table = new Map();
	const removed = new Set(splice.removed);
	for (const [name, column] of held) {
		const carried = splice.spine.get(name) ?? splice.columns.get(name);
		if (carried)
			assert.equal(
				carried.base,
				column.values.length,
				`${name}'s dict.base is not the number of entries the client holds`,
			);
		const ids = column.ids.filter((_, row) => !removed.has(row));
		for (const ordinal of splice.inserted) ids.splice(ordinal, 0, -1);
		if (carried)
			carried.ordinals.forEach((ordinal, at) => {
				ids[ordinal] = carried.ids[at];
			});
		after.set(name, {
			values: [...column.values, ...(carried?.appended ?? [])],
			ids,
		});
	}
	return after;
}

function expectSameTable(actual: Table, expected: Table, trackCount: number) {
	for (const [name, column] of expected) {
		const held = actual.get(name) as HeldColumn;
		assert.equal(
			held.ids.length,
			trackCount,
			`${name} has the wrong row count`,
		);
		for (let row = 0; row < trackCount; row += 1)
			assert.equal(
				held.values[held.ids[row]],
				column.values[column.ids[row]],
				`${name} at ordinal ${row} differs from the export at the new structure`,
			);
		assert.deepEqual(
			held.values,
			column.values,
			`${name}'s dictionary differs from the export at the new structure`,
		);
		assert.deepEqual(held.ids, column.ids, `${name}'s ids differ`);
	}
}

const held = async (state: FakeState) => {
	const library = tableOf(await exportOf(state));
	return { ...library, pair: await pairOf(state) };
};

const builtFrom = async (tracks: Track[]) => {
	const state = createState({ fooJean: {}, mediaLibrary: tracks });
	return { state, before: await held(state) };
};

async function splicedFrom(
	state: FakeState,
	before: Awaited<ReturnType<typeof held>>,
) {
	const splice = spliceOf(await changesFrom(state, before.pair));
	const after = tableOf(await exportOf(state));
	expectSameTable(spliced(before.table, splice), after.table, after.trackCount);
	return { splice, after, ...rowsChanged(before, after) };
}

const sorted = (values: Iterable<string>) => [...values].sort();

test("a splice's header names the pair it patches from, the pair it reaches, the row count and the snapshot it brings a client to", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	const now = await atThePlayer(state, { add: 3, remove: 2 });
	const { header } = spliceOf(await changesFrom(state, before.pair));

	assert.equal(header.kind, "splice");
	assert.equal(header.sinceStructure, before.pair.structure);
	assert.equal(header.since, before.pair.revision);
	assert.equal(header.structure, now.structure);
	assert.equal(header.revision, now.revision);
	assert.notEqual(
		now.structure,
		before.pair.structure,
		"the structure did not move",
	);
	assert.equal(header.trackCount, before.trackCount + 1);
	assert.equal(header.snapshotId, await snapshotIdOf(state));
});

test("an album added is a splice whose inserted rows are the new tracks, with an id in every declared column and in all three of the spine", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { add: 5 });
	const { splice, removed, inserted } = await splicedFrom(state, before);

	assert.deepEqual(removed, []);
	assert.equal(inserted.length, 5);
	assert.ok(
		inserted.at(-1)! < before.trackCount,
		"the new tracks were not inserted mid-library",
	);
	assert.deepEqual(splice.removed, []);
	assert.deepEqual(splice.inserted, inserted);
	assert.deepEqual(sorted(splice.columns.keys()), sorted(DECLARED));
	assert.deepEqual(sorted(splice.spine.keys()), sorted(SPINE));
	for (const [name, column] of splice.spine)
		assert.deepEqual(
			column.ordinals,
			inserted,
			`${name}'s ordinals are not the inserted rows`,
		);
	for (const [name, column] of splice.columns)
		for (const ordinal of inserted)
			assert.ok(
				column.ordinals.includes(ordinal),
				`${name} leaves inserted row ${ordinal} without an id`,
			);
});

test("tracks only removed are a splice of removed ordinals in the old numbering, with no spine and no column", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { remove: 4 });
	const { splice, removed, inserted } = await splicedFrom(state, before);

	assert.equal(removed.length, 4);
	assert.deepEqual(inserted, []);
	assert.deepEqual(splice.removed, removed);
	assert.deepEqual(splice.inserted, []);
	assert.deepEqual([...splice.columns.keys()], []);
	assert.deepEqual([...splice.spine.keys()], []);
});

test("a removal after a play the client never fetched carries the play count alone, at the survivor's ordinal", async () => {
	const { state, before } = await builtFrom(LIBRARY());
	const PLAYED = 10;

	playAt(state, PLAYED);
	await atThePlayer(state, { remove: 3 });
	const { splice } = await splicedFrom(state, before);

	assert.deepEqual([...splice.columns.keys()], [PLAY_COUNT]);
	assert.deepEqual(splice.columns.get(PLAY_COUNT)?.ordinals, [PLAYED]);
});

test("tracks added and removed in one rebuild, after a play the client never fetched, are one splice that brings every row up to date", async () => {
	const { state, before } = await builtFrom(LIBRARY());
	const PLAYED = 500;

	playAt(state, PLAYED);
	await atThePlayer(state, { add: 4, remove: 2 });
	const { splice, inserted } = await splicedFrom(state, before);

	assert.equal(splice.removed.length, 2);
	assert.deepEqual(splice.inserted, inserted);
	const plays = splice.columns.get(PLAY_COUNT)?.ordinals ?? [];
	assert.ok(
		plays.includes(PLAYED + inserted.length),
		"the play moved with its row",
	);
});

test("tracks only removed, one of them played to a value no other track has, carry that column with no ordinals and its new entry", async () => {
	const { state, before } = await builtFrom(LIBRARY());
	const last = before.trackCount - 1;
	const counts = before.table.get(PLAY_COUNT) as HeldColumn;
	const highest = Math.max(...counts.values.map(Number));
	const playing = Number(counts.values[counts.ids[last]]);

	for (let play = playing; play <= highest; play += 1) playAt(state, last);
	await atThePlayer(state, { remove: 1 });
	const { splice, after, removed, inserted } = await splicedFrom(state, before);

	assert.deepEqual(removed, [last]);
	assert.deepEqual(inserted, []);
	assert.ok(
		(after.table.get(PLAY_COUNT) as HeldColumn).values.length >
			counts.values.length,
		"the play gave the removed track no value the export did not already hold",
	);
	assert.deepEqual([...splice.columns.keys()], [PLAY_COUNT]);
	assert.deepEqual(splice.columns.get(PLAY_COUNT)?.ordinals, []);
	assert.deepEqual([...splice.spine.keys()], []);
});

test("a track added and removed again between the client's pair and now leaves a splice of removals carrying every column whose dictionary grew, spine included, with no ordinals", async () => {
	const { state, before } = await builtFrom(libraryOfShape({ tracks: 600 }));

	await atThePlayer(state, { add: 1 });
	const between = tableOf(await exportOf(state));
	assert.deepEqual(
		rowsChanged(before, between).inserted,
		[between.trackCount - 1],
		"the added track is not the last row, so removing from the end leaves it",
	);
	await atThePlayer(state, { remove: 2 });
	const { splice, after, removed, inserted } = await splicedFrom(state, before);

	assert.deepEqual(removed, [before.trackCount - 1]);
	assert.deepEqual(inserted, []);
	const grown = (names: readonly string[]) =>
		names.filter(
			(name) =>
				(after.table.get(name) as HeldColumn).values.length >
				(before.table.get(name) as HeldColumn).values.length,
		);
	assert.ok(
		grown(SPINE).includes("filename"),
		"the added track's file left no entry behind",
	);
	assert.deepEqual(sorted(splice.columns.keys()), sorted(grown(DECLARED)));
	assert.deepEqual(sorted(splice.spine.keys()), sorted(grown(SPINE)));
	for (const [name, column] of [...splice.columns, ...splice.spine])
		assert.deepEqual(column.ordinals, [], `${name} names a row`);
});

test("rebuilds one after another are merged into one splice from the pair the client held", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { add: 2 });
	await atThePlayer(state, { remove: 3 });
	const now = await atThePlayer(state, { add: 1, remove: 1 });
	const { splice } = await splicedFrom(state, before);

	assert.equal(splice.header.structure, now.structure);
	assert.equal(splice.header.sinceStructure, before.pair.structure);
	assert.equal(splice.header.trackCount, before.trackCount - 1);
});

test("a cue sheet's subsongs are removed one row at a time, leaving the rest of the file", async () => {
	const { state, before } = await builtFrom(CUE_SHEETS());

	await atThePlayer(state, { remove: 2 });
	const { splice, after } = await splicedFrom(state, before);

	assert.deepEqual(splice.removed, [
		before.trackCount - 2,
		before.trackCount - 1,
	]);
	const filename = after.table.get("filename") as HeldColumn;
	const last = after.trackCount - 1;
	assert.equal(
		filename.values[filename.ids[last]],
		(before.table.get("filename") as HeldColumn).values[
			(before.table.get("filename") as HeldColumn).ids[before.trackCount - 1]
		],
		"the whole file left, where only two of its subsongs did",
	);
});

test("removed ordinals are as wide as the old numbering needs where the new one is narrower", async () => {
	const { state, before } = await builtFrom(
		libraryOfShape({ tracks: 257, albums: 40, artists: 8 }),
	);

	await atThePlayer(state, { remove: 2 });
	const { splice } = await splicedFrom(state, before);

	assert.equal(splice.header.removed?.width, 2);
	assert.equal(splice.header.inserted?.width, 1);
	assert.deepEqual(splice.removed, [255, 256]);
});

test("a splice is laid out in the contract's order, every column's ordinals as wide as inserted", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { add: 3, remove: 2 });
	const { header } = spliceOf(await changesFrom(state, before.pair));
	const removed = header.removed as Section;
	const inserted = header.inserted as Section;

	const bones = SPINE.map((name) => header.spine[name] as HeaderColumn);
	const offsets = [removed.offset, inserted.offset];
	for (const column of [...bones, ...header.columns]) {
		assert.equal(
			column.ordinals?.width,
			inserted.width,
			`${column.name ?? "a spine column"}'s ordinals are not inserted's width`,
		);
		offsets.push(
			column.ids?.offset as number,
			column.dict?.text.offset as number,
			column.dict?.ends.offset as number,
			column.ordinals?.offset as number,
		);
	}
	assert.deepEqual(
		offsets,
		[...offsets].sort((a, b) => a - b),
		"the sections are not in the order removed, inserted, then ids, text, ends and ordinals of each column",
	);
});

test("a splice of half the export's bytes or more is a 410", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { add: before.trackCount * 3 });
	const answer = await changesFrom(state, before.pair);

	assertRefused(answer, 410, SPLICE_TOO_LARGE);
});

test("a structure moved by another declaration is a 410, since no splice describes a different column set", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	assert.equal((await exportOf(state, [...DECLARED, "%genre%"])).status, 200);
	const now = await pairOf(state);
	assert.notEqual(
		now.structure,
		before.pair.structure,
		"the declaration did not move the structure",
	);
	const answer = await changesFrom(state, before.pair);

	assertRefused(answer, 410, REARRANGED);
});

test("a pair whose revision fell out of the retained window before the tracks moved is a 410", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	// Every play of one track would be a new play count left unused, and the rebuild would then
	// compact, which `foo_jean` reports ahead of the window.
	for (let play = 0; play <= RETAINED_REVISIONS; play += 1)
		playAt(state, play % before.trackCount);
	assertRefused(await changesFrom(state, before.pair), 410, REVISION_TOO_OLD);
	await atThePlayer(state, { add: 1 });
	const answer = await changesFrom(state, before.pair);

	assertRefused(answer, 410, REVISION_TOO_OLD);
});

test("a structure this run never held is a 409", async () => {
	const { state, before } = await builtFrom(LIBRARY());

	await atThePlayer(state, { add: 1 });
	const answer = await changesFrom(state, {
		structure: before.pair.structure + 1000,
		revision: before.pair.revision,
	});

	assertRefused(answer, 409, PAIR_NOT_HELD);
});

test("a revision past the current one, at the current structure, is a 410 naming no such revision", async () => {
	const { state } = await builtFrom(LIBRARY());
	playAt(state, 0);
	const now = await pairOf(state);

	const answer = await changesFrom(state, {
		structure: now.structure,
		revision: now.revision + 1,
	});

	assertRefused(answer, 410, REVISION_UNKNOWN);
});

const bytewise = (a: string, b: string) =>
	Buffer.compare(Buffer.from(a), Buffer.from(b));

const usedBy = (column: HeldColumn) =>
	new Set(column.ids.map((id) => column.values[id]));

// What `worthKeeping` in `plugins/fb2k/src/core/library_splice.cpp` weighs, summed over every
// column and the spine: entries the rows after the rebuild use, and those kept that none does.
function entriesAfterRemoval(before: Table, after: Table) {
	let live = 0;
	let dead = 0;
	for (const [name, column] of before) {
		const used = usedBy(after.get(name) as HeldColumn);
		live += used.size;
		dead += new Set([...column.values, ...used]).size - used.size;
	}
	return { live, dead };
}

// Twelve of twenty-one tracks removed leaves one unused entry more than used ones. A play count
// set on a surviving track first is one more used entry and lands exactly on the line, so a fake
// that compacts at `>=`, or only well past it, answers one of the two wrongly.
const TRACKS = 21;

// Bytewise ahead of every play count the fixture holds, so appending it leaves that dictionary
// out of order until something rebuilds it.
const FIRST_IN_ORDER = "1";

const removedAfter = async ({
	playCount,
	remove,
}: {
	playCount?: string;
	remove: number;
}) => {
	const { state, before: unplayed } = await builtFrom(
		libraryOfShape({ tracks: TRACKS }),
	);
	if (playCount !== undefined)
		control(state, "play", { ordinal: 0, count: playCount });
	const before = playCount === undefined ? unplayed : await held(state);
	await atThePlayer(state, { remove });
	return { state, before };
};

const ONE_DEAD_PAST_LIVE = () => removedAfter({ remove: 12 });
const AS_MANY_DEAD_AS_LIVE = () =>
	removedAfter({ playCount: FIRST_IN_ORDER, remove: 12 });
const OUT_OF_ORDER_THEN_COMPACTED = () =>
	removedAfter({ playCount: FIRST_IN_ORDER, remove: 13 });

test("a removal leaving more dictionary entries unused than used, spine included, is a 410 saying the dictionaries were compacted", async () => {
	const { state, before } = await ONE_DEAD_PAST_LIVE();

	const answer = await changesFrom(state, before.pair);
	const after = tableOf(await exportOf(state));

	const { live, dead } = entriesAfterRemoval(before.table, after.table);
	assert.equal(dead, live + 1, "the removal no longer lands one past the line");
	assertRefused(answer, 410, COMPACTED);
});

test("the export after a compacting rebuild holds in every column, spine included, exactly the values its rows use, in bytewise order", async () => {
	const { state, before } = await OUT_OF_ORDER_THEN_COMPACTED();
	const counts = (before.table.get(PLAY_COUNT) as HeldColumn).values;
	assert.notDeepEqual(
		counts,
		[...counts].sort(bytewise),
		"the play count dictionary was in bytewise order before the rebuild",
	);

	const after = tableOf(await exportOf(state));

	const { live, dead } = entriesAfterRemoval(before.table, after.table);
	assert.ok(dead > live, "the removal no longer compacts");
	for (const [name, column] of after.table)
		assert.deepEqual(
			column.values,
			[...usedBy(column)].sort(bytewise),
			`${name}'s dictionary is not the values its rows use, in bytewise order`,
		);
});

test("a removal leaving as many dictionary entries unused as used keeps them, and is a splice", async () => {
	const { state, before } = await AS_MANY_DEAD_AS_LIVE();

	const { after } = await splicedFrom(state, before);

	const { live, dead } = entriesAfterRemoval(before.table, after.table);
	assert.equal(dead, live, "the removal no longer lands on the line");
});

test("a pair held across one rebuild after another, all inside the component's retained window, is answered a splice after each that brings the client to a fresh export", async () => {
	const REBUILDS = 20;
	assert.ok(REBUILDS < RETAINED_REVISIONS);
	const { state, before } = await builtFrom(LIBRARY());

	for (let rebuild = 1; rebuild <= REBUILDS; rebuild += 1) {
		await atThePlayer(state, { add: 1 });
		const answer = await changesFrom(state, before.pair);
		assert.equal(
			answer.status,
			200,
			`after rebuild ${rebuild}: ${why(answer)}`,
		);
		const splice = spliceOf(answer);
		const after = tableOf(await exportOf(state));
		expectSameTable(
			spliced(before.table, splice),
			after.table,
			after.trackCount,
		);
		assert.equal(splice.inserted.length, rebuild);
	}
});
