import assert from "node:assert/strict";
import test from "node:test";
import type { components } from "../../src/shared/api/fooJeanSchema";
import { decodeJlib, type JlibSnapshot } from "../../src/shared/api/jlib.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
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
const UNRESOLVED = "%nonexistent%";
const DECLARED = ["%album%", "%title%", UNRESOLVED, PLAY_COUNT];
const FIRST_PART = [PLAY_COUNT, "%title%"];
const LATE_PART = ["%album%", UNRESOLVED];
const SPINE = ["directory", "filename", "subsong"] as const;
const NO_SNAPSHOT = "0000000000000000";
const SNAPSHOT_ID = /^[0-9a-f]{16}$/;
const GZIP = { "accept-encoding": "gzip" };

const SMALL = () => libraryOfShape({ tracks: 12, albums: 3, artists: 2 });

interface Answer {
	status: number;
	headers: Record<string, string>;
	body: Uint8Array<ArrayBuffer>;
	answered: boolean;
}

const responderFor = (answer: Answer): Responder => {
	const chunks: Uint8Array[] = [];
	const write = (chunk: string | Uint8Array) => {
		chunks.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	};
	return {
		writeHead(code, headers) {
			answer.status = code;
			Object.assign(answer.headers, headers);
		},
		setHeader(name, value) {
			answer.headers[name] = value;
		},
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
			answer.answered = true;
		},
		on() {},
		destroy() {},
	};
};

const send = (
	state: FakeState,
	path: string,
	query: [string, string][] | string,
	headers: Record<string, string> = {},
) => {
	const url = new URL(path, "http://fake");
	if (typeof query === "string") url.search = query;
	else for (const [name, value] of query) url.searchParams.append(name, value);

	const answer: Answer = {
		status: 0,
		headers: {},
		body: new Uint8Array(),
		answered: false,
	};
	const done = handleFooJean({
		state,
		method: "GET",
		url,
		headers,
		body: null,
		response: responderFor(answer),
		artwork: () => false,
	}).then(() => answer);
	return { answer, done };
};

const ask = (
	state: FakeState,
	path: string,
	query: [string, string][] | string,
	headers?: Record<string, string>,
) => send(state, path, query, headers).done;

const exportQuery = (
	only: readonly string[] = [],
	spine?: boolean,
): [string, string][] => [
	...DECLARED.map((column): [string, string] => ["columns", column]),
	...only.map((column): [string, string] => ["only", column]),
	...(spine === undefined
		? []
		: [["spine", String(spine)] as [string, string]]),
];

const exportOf = (
	state: FakeState,
	only?: readonly string[],
	spine?: boolean,
	headers?: Record<string, string>,
) => ask(state, "/api/library/export", exportQuery(only, spine), headers);

const jsonOf = (answer: Answer) =>
	JSON.parse(new TextDecoder().decode(answer.body));

const libraryOf = async (state: FakeState) =>
	jsonOf(await ask(state, "/api/state", [])).library;

const changesOf = (state: FakeState, query: Record<string, number>) =>
	ask(
		state,
		"/api/library/changes",
		Object.entries(query).map(([name, value]) => [name, String(value)]),
	);

const fresh = (fooJean: FooJeanOptions = {}, tracks: Track[] = SMALL()) =>
	createState({ fooJean, mediaLibrary: tracks });

const built = async (fooJean: FooJeanOptions = {}, tracks?: Track[]) => {
	const state = fresh(fooJean, tracks);
	assert.equal((await exportOf(state)).status, 200);
	return state;
};

interface Part {
	header: Header;
	body: Uint8Array;
	blobAt: number;
	view: DataView;
}

const partOf = (body: Uint8Array): Part => {
	assert.equal(new TextDecoder().decode(body.subarray(0, 4)), "JLIB");
	const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
	const headerBytes = view.getUint32(4, true);
	const header = JSON.parse(
		new TextDecoder().decode(body.subarray(8, 8 + headerBytes)),
	) as Header;
	return { header, body, blobAt: 8 + headerBytes, view };
};

const integersOf = (part: Part, section: Section) =>
	Array.from({ length: section.count }, (_, index) => {
		const at = part.blobAt + section.offset + index * section.width;
		if (section.width === 1) return part.view.getUint8(at);
		if (section.width === 2) return part.view.getUint16(at, true);
		return part.view.getUint32(at, true);
	});

const rowsOf = (part: Part, entry: HeaderColumn | undefined, what: string) => {
	assert.ok(entry?.ids && entry.dict, `${what} is not carried`);
	const ends = integersOf(part, entry.dict.ends);
	const textAt = part.blobAt + entry.dict.text.offset;
	const text = part.body.subarray(textAt, textAt + entry.dict.text.length);
	const values = ends.map((end, at) =>
		new TextDecoder().decode(text.subarray(at === 0 ? 0 : ends[at - 1], end)),
	);
	return integersOf(part, entry.ids).map((id) => values[id]);
};

const wholeOf = (answer: Answer) => {
	assert.equal(answer.status, 200);
	const whole = decodeJlib(answer.body.slice().buffer);
	assert.equal(whole.kind, "snapshot");
	return { whole: whole as JlibSnapshot, part: partOf(answer.body) };
};

const columnRows = (whole: JlibSnapshot, name: string) => {
	const column = whole.columns.get(name);
	assert.ok(column, `the whole export has no ${name}`);
	return Array.from({ length: whole.trackCount }, (_, row) => column.at(row));
};

const factsOf = ({ distinct, hasUnresolved, allUnresolved }: HeaderColumn) => ({
	distinct,
	hasUnresolved,
	allUnresolved,
});

const entryNamed = (header: Header, name: string) => {
	const entry = header.columns.find((column) => column.name === name);
	assert.ok(entry, `the header describes no ${name}`);
	return entry;
};

const sorted = (names: readonly string[] | undefined) =>
	[...(names ?? [])].sort();

const gunzip = async (bytes: Uint8Array<ArrayBuffer>) =>
	new Uint8Array(
		await new Response(
			new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
		).arrayBuffer(),
	);

const settled = () => new Promise((resolve) => setImmediate(resolve));

const snapshotIdOf = async (state: FakeState) => {
	const { snapshotId } = partOf((await exportOf(state)).body).header;
	assert.match(snapshotId ?? "", SNAPSHOT_ID);
	return snapshotId;
};

test("a subset carries the columns it names row for row as the whole export does, and describes every declared column", async () => {
	const state = await built();
	const { whole, part: wholePart } = wholeOf(await exportOf(state));

	const answer = await exportOf(state, FIRST_PART);
	assert.equal(answer.status, 200);
	const { header } = partOf(answer.body);
	const part = partOf(answer.body);

	assert.deepEqual(
		header.columns.map((column) => column.name),
		DECLARED,
	);
	assert.deepEqual(sorted(header.carried), sorted(FIRST_PART));
	assert.equal(header.spineCarried, true);

	for (const name of FIRST_PART)
		assert.deepEqual(
			rowsOf(part, entryNamed(header, name), name),
			columnRows(whole, name),
			name,
		);
	for (const name of LATE_PART)
		assert.deepEqual(
			entryNamed(header, name),
			{ name, ...factsOf(entryNamed(wholePart.header, name)) },
			name,
		);
	for (const name of SPINE)
		assert.deepEqual(
			rowsOf(part, header.spine[name], name),
			Array.from({ length: whole.trackCount }, (_, row) =>
				whole.spine[name].at(row),
			),
			name,
		);

	for (const field of [
		"kind",
		"trackCount",
		"structure",
		"revision",
		"snapshotId",
	] as const)
		assert.equal(header[field], wholePart.header[field], field);
});

test("spine=false leaves the spine's rows out of the body and still describes all three", async () => {
	const state = await built();
	const { whole, part: wholePart } = wholeOf(await exportOf(state));

	const withSpine = await exportOf(state, LATE_PART);
	const answer = await exportOf(state, LATE_PART, false);
	assert.equal(answer.status, 200);
	const part = partOf(answer.body);

	assert.equal(part.header.spineCarried, false);
	assert.deepEqual(sorted(part.header.carried), sorted(LATE_PART));
	for (const name of SPINE)
		assert.deepEqual(
			part.header.spine[name],
			factsOf(wholePart.header.spine[name] as HeaderColumn),
			name,
		);
	for (const name of LATE_PART)
		assert.deepEqual(
			rowsOf(part, entryNamed(part.header, name), name),
			columnRows(whole, name),
			name,
		);
	assert.ok(
		answer.body.length < withSpine.body.length,
		`spine=false sent ${answer.body.length} bytes, the same subset with the spine ${withSpine.body.length}`,
	);
});

test("the whole export says it carries every declared column and the spine", async () => {
	const state = await built();
	const { header } = partOf((await exportOf(state)).body);

	assert.deepEqual(sorted(header.carried), sorted(DECLARED));
	assert.equal(header.spineCarried, true);
});

test("a subset of a built declaration answers 200 at once and starts no rebuild", async () => {
	const state = await built();
	const before = await libraryOf(state);
	state.fooJean.libraryBuilds = 3;

	const answer = await exportOf(state, LATE_PART, false);

	assert.equal(answer.status, 200);
	assert.deepEqual(
		sorted(partOf(answer.body).header.carried),
		sorted(LATE_PART),
	);
	const after = await libraryOf(state);
	assert.equal(after.build, null);
	assert.equal(after.structure, before.structure);
	assert.equal(after.revision, before.revision);
	assert.deepEqual(sorted(after.columns), sorted(DECLARED));
});

test("a subset of a declaration not yet built answers 202, builds the whole declaration, and is the subset once built", async () => {
	const state = fresh({ libraryBuilds: 1 });

	const waiting = await exportOf(state, FIRST_PART);
	assert.equal(waiting.status, 202);
	assert.equal(jsonOf(waiting).ready, false);

	await libraryOf(state);
	const library = await libraryOf(state);
	assert.equal(library.ready, true);
	assert.deepEqual(sorted(library.columns), sorted(DECLARED));

	const answer = await exportOf(state, FIRST_PART);
	assert.equal(answer.status, 200);
	assert.deepEqual(
		sorted(partOf(answer.body).header.carried),
		sorted(FIRST_PART),
	);
});

test("a subset is answered at the library's current revision", async () => {
	const state = await built();
	const { whole } = wholeOf(await exportOf(state));
	const ordinal = 4;
	assert.ok(state.countPlayAt(ordinal));
	const { revision } = await libraryOf(state);
	assert.notEqual(revision, whole.revision);

	const part = partOf((await exportOf(state, FIRST_PART)).body);

	assert.deepEqual(sorted(part.header.carried), sorted(FIRST_PART));
	assert.equal(part.header.revision, revision);
	assert.equal(
		Number(
			rowsOf(part, entryNamed(part.header, PLAY_COUNT), PLAY_COUNT)[ordinal],
		),
		Number(columnRows(whole, PLAY_COUNT)[ordinal]) + 1,
	);
});

test("the ETag names the subset and the spine flag, so neither revalidates against the whole export", async () => {
	const state = await built();
	const whole = await exportOf(state);
	const subset = await exportOf(state, FIRST_PART);
	const spineless = await exportOf(state, FIRST_PART, false);
	const tags = [whole, subset, spineless].map((answer) => answer.headers.ETag);

	for (const tag of tags) assert.match(tag ?? "", /^".+"$/);
	assert.equal(new Set(tags).size, 3, tags.join(" "));

	const query = exportQuery(FIRST_PART);
	const againstWhole = await ask(state, "/api/library/export", query, {
		"if-none-match": tags[0] as string,
	});
	assert.equal(againstWhole.status, 200);
	const againstItself = await ask(state, "/api/library/export", query, {
		"if-none-match": tags[1] as string,
	});
	assert.equal(againstItself.status, 304);
});

test("an only naming a column the declaration lacks, a spine column included, is 400 column not declared and starts no build", async () => {
	const state = fresh({ libraryBuilds: 5 });

	const undeclared = await exportOf(state, ["%title%", "%genre%"]);
	assert.equal(undeclared.status, 400);
	assert.deepEqual(jsonOf(undeclared), {
		error: "column not declared",
		detail: "'only' column 1 is not one of 'columns'",
	});

	const spine = await exportOf(state, ["directory"]);
	assert.equal(spine.status, 400);
	assert.equal(jsonOf(spine).error, "column not declared");

	const library = await libraryOf(state);
	assert.equal(library.build, null);
	assert.equal(library.ready, false);
});

// cpp-httplib collapses a query pair whose raw text repeats an earlier one before the
// component sees it, so the repeat that reaches `foo_jean` is one column in two spellings.
test("one column named twice in only, in two spellings, is 400 duplicate column", async () => {
	const state = await built();
	const declared = DECLARED.map(
		(column) => `columns=${encodeURIComponent(column)}`,
	).join("&");

	const answer = await ask(
		state,
		"/api/library/export",
		`?${declared}&only=%25title%25&only=%25t%69tle%25`,
	);

	assert.equal(answer.status, 400);
	assert.equal(jsonOf(answer).error, "duplicate column");
});

// The component never sees the second `only=%title%`: cpp-httplib drops a query pair whose raw text
// repeats an earlier one, so it counts the undeclared column as the second, not the third.
test("only naming a column twice in one spelling and then an undeclared one is refused for the undeclared one, counted without the repeat", async () => {
	const state = await built();
	const declared = DECLARED.map(
		(column) => `columns=${encodeURIComponent(column)}`,
	).join("&");

	const answer = await ask(
		state,
		"/api/library/export",
		`?${declared}&only=%25title%25&only=%25title%25&only=%25genre%25`,
	);

	assert.equal(answer.status, 400);
	assert.deepEqual(jsonOf(answer), {
		error: "column not declared",
		detail: "'only' column 1 is not one of 'columns'",
	});
});

test("a spine flag other than true or false is 400 unacceptable spine, after the only columns are checked, and starts no build", async () => {
	const state = fresh({ libraryBuilds: 5 });
	const declared = DECLARED.map(
		(column) => `columns=${encodeURIComponent(column)}`,
	).join("&");

	for (const flag of ["maybe", "1", "TRUE", ""]) {
		const answer = await ask(
			state,
			"/api/library/export",
			`?${declared}&spine=${flag}`,
		);
		assert.equal(answer.status, 400, `spine=${flag}`);
		assert.deepEqual(
			jsonOf(answer),
			{
				error: "unacceptable spine",
				detail: "'spine' must be true or false",
			},
			`spine=${flag}`,
		);
	}

	const both = await ask(
		state,
		"/api/library/export",
		`?${declared}&only=%25genre%25&spine=maybe`,
	);
	assert.deepEqual(jsonOf(both), {
		error: "column not declared",
		detail: "'only' column 0 is not one of 'columns'",
	});

	const library = await libraryOf(state);
	assert.equal(library.build, null);
	assert.equal(library.ready, false);
});

test("holdSubset keeps an export naming those columns pending while the first part answers, until it is switched off", async () => {
	const state = await built({ holdSubset: LATE_PART });

	const late = send(
		state,
		"/api/library/export",
		exportQuery(LATE_PART, false),
	);
	const first = send(state, "/api/library/export", exportQuery(FIRST_PART));
	await libraryOf(state);
	await settled();

	assert.equal(first.answer.status, 200);
	assert.equal(late.answer.answered, false);
	assert.equal(late.answer.status, 0);

	state.fooJean.holdSubset = null;
	await settled();

	assert.equal(late.answer.status, 200);
	assert.deepEqual(
		sorted(partOf(late.answer.body).header.carried),
		sorted(LATE_PART),
	);
});

test("POST /__control/holdSubset with no columns answers every held export", async () => {
	const state = await built({ holdSubset: LATE_PART });
	const late = send(
		state,
		"/api/library/export",
		exportQuery(LATE_PART, false),
	);
	await settled();
	assert.equal(late.answer.answered, false);

	const control = {
		status: 0,
		headers: {},
		body: new Uint8Array(),
		answered: false,
	};
	handleControl({
		state,
		method: "POST",
		path: "/__control/holdSubset",
		body: {},
		response: responderFor(control),
	});

	await settled();

	assert.equal(control.status, 204);
	assert.equal(late.answer.status, 200);
});

test("before the first build GET /state names no snapshot: sixteen zeros, at structure and revision 0", async () => {
	const library = await libraryOf(fresh());

	assert.equal(library.snapshotId, NO_SNAPSHOT);
	assert.equal(library.structure, 0);
	assert.equal(library.revision, 0);
});

test("once built, GET /state's snapshotId is sixteen lowercase hex digits and every export header names the same, whatever the subset or coding", async () => {
	const state = await built();
	const { snapshotId } = await libraryOf(state);

	assert.match(snapshotId, SNAPSHOT_ID);
	assert.notEqual(snapshotId, NO_SNAPSHOT);

	const zipped = await exportOf(state, undefined, undefined, GZIP);
	assert.equal(zipped.headers["Content-Encoding"], "gzip");
	const headers = [
		partOf((await exportOf(state)).body).header,
		partOf((await exportOf(state, FIRST_PART)).body).header,
		partOf((await exportOf(state, LATE_PART, false)).body).header,
		partOf(await gunzip(zipped.body)).header,
	];
	for (const header of headers) assert.equal(header.snapshotId, snapshotId);
});

test("an unchanged library has the same snapshotId in a fresh fake and after a rebuild that changes nothing", async () => {
	const first = await built();
	const second = await built();
	const id = await snapshotIdOf(first);
	assert.equal(await snapshotIdOf(second), id);

	const before = await libraryOf(second);
	second.startLibraryBuild(DECLARED);
	second.finishLibraryBuild();
	const after = await libraryOf(second);

	assert.notEqual(after.structure, before.structure);
	assert.equal(after.snapshotId, id);
});

test("a play moves snapshotId, and the delta's header names the one GET /state and the next export do", async () => {
	const state = await built();
	const held = partOf((await exportOf(state)).body).header;
	assert.ok(state.countPlayAt(2));

	const { snapshotId } = await libraryOf(state);
	const delta = await changesOf(state, {
		since: held.revision,
		structure: held.structure,
	});

	assert.notEqual(snapshotId, held.snapshotId);
	assert.equal(delta.status, 200);
	assert.equal(partOf(delta.body).header.kind, "delta");
	assert.equal(partOf(delta.body).header.snapshotId, snapshotId);
	assert.equal(await snapshotIdOf(state), snapshotId);
});

test("another declaration over the same tracks has another snapshotId", async () => {
	const state = await built();
	const id = await snapshotIdOf(state);

	state.startLibraryBuild([...DECLARED.slice(0, -1), "%artist%"]);
	state.finishLibraryBuild();

	assert.notEqual((await libraryOf(state)).snapshotId, id);
});

test("the same values on other rows have another snapshotId", async () => {
	const tracks = SMALL();
	const swapped = SMALL();
	[swapped[0]["%title%"], swapped[5]["%title%"]] = [
		swapped[5]["%title%"],
		swapped[0]["%title%"],
	];

	assert.notEqual(
		await snapshotIdOf(await built({}, swapped)),
		await snapshotIdOf(await built({}, tracks)),
	);
});

test("a renamed file has another snapshotId, since the spine is folded too", async () => {
	const renamed = SMALL();
	const last = renamed[renamed.length - 1];
	last["%path%"] = (last["%path%"] ?? "").replace(/\.mp3$/, " (renamed).mp3");

	assert.notEqual(
		await snapshotIdOf(await built({}, renamed)),
		await snapshotIdOf(await built()),
	);
});

const TRAP_DECLARED = ["%title%", "%genre%", PLAY_COUNT];

// U+FF5A sorts before U+1F600 bytewise in UTF-8; a comparison of UTF-16 code units orders them the other way.
const TRAPS = (): Track[] => {
	const cells: [string, string, string | null, string, string, string][] = [
		["b", "9.mp3", "2", "a", "Rock", "9"],
		["a", "10.mp3", "10", "Z", "", "10"],
		["B", "\u00e9.mp3", null, "\u00e9", "?", "2"],
		["b", "z.mp3", "2", "z", "Rock", "9"],
		["a", "\uff5a.mp3", null, "\u{1f600}", "Jazz", "10"],
		["\u00e9", "\u{1f600}.mp3", "1", "\uff5a", "", "1"],
	];
	const [template] = libraryOfShape({ tracks: 1 });
	return cells.map(([directory, file, subsong, title, genre, plays]) => {
		const track: Track = {
			...template,
			"%path%": `C:\\Music\\S\\${directory}\\${file}`,
			"%title%": title,
			"%genre%": genre,
			[PLAY_COUNT]: plays,
		};
		if (subsong !== null) track["%subsong%"] = subsong;
		return track;
	});
};

const bytewise = (left: string, right: string) =>
	Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const dictionariesOf = (answer: Answer) => {
	const { whole } = wholeOf(answer);
	const named = [
		...SPINE.map((name) => [name, whole.spine[name]] as const),
		...[...whole.columns],
	];
	return new Map(
		named.map(([name, column]) => [
			name,
			{
				values: Array.from({ length: column.distinct }, (_, id) =>
					column.value(id),
				),
				ids: Array.from(column.ids),
			},
		]),
	);
};

const assertCompactAndInOrder = (
	dictionaries: ReturnType<typeof dictionariesOf>,
) => {
	for (const [name, { values, ids }] of dictionaries) {
		for (let at = 1; at < values.length; at += 1)
			assert.ok(
				bytewise(values[at - 1], values[at]) < 0,
				`${name}: ${JSON.stringify(values[at - 1])} sits before ${JSON.stringify(values[at])} in ${JSON.stringify(values)}`,
			);
		const used = new Set(ids);
		for (const [id, value] of values.entries())
			assert.ok(used.has(id), `${name}: no row uses ${JSON.stringify(value)}`);
	}
};

const trapExport = (state: FakeState, declared = TRAP_DECLARED) =>
	ask(
		state,
		"/api/library/export",
		declared.map((column): [string, string] => ["columns", column]),
	);

test("a fresh fake's dictionaries hold each column's used values once each, in bytewise UTF-8 order, spine included", async () => {
	const state = fresh({}, TRAPS());

	assertCompactAndInOrder(dictionariesOf(await trapExport(state)));
});

test("a fake started again on tracks a play has moved builds the same dictionaries, in bytewise order, whatever order the tracks were handed over in", async () => {
	const played = fresh({}, TRAPS());
	assert.equal((await trapExport(played)).status, 200);
	assert.ok(played.countPlayAt(1), "the play was not counted");
	assert.ok(played.countPlayAt(1), "the play was not counted");

	const tracks = played.libraryTracks as Track[];
	const restarted = dictionariesOf(
		await trapExport(fresh({}, structuredClone(tracks))),
	);
	const handedOverBackwards = dictionariesOf(
		await trapExport(fresh({}, structuredClone(tracks).reverse())),
	);

	assertCompactAndInOrder(restarted);
	assert.deepEqual(handedOverBackwards, restarted);
});

test("another declaration over the same fake builds its dictionaries afresh, in bytewise order", async () => {
	const state = fresh({}, TRAPS());
	assert.equal((await trapExport(state)).status, 200);
	assert.ok(state.countPlayAt(1), "the play was not counted");
	assert.ok(state.countPlayAt(1), "the play was not counted");

	assertCompactAndInOrder(
		dictionariesOf(await trapExport(state, ["%title%", PLAY_COUNT])),
	);
});

test("structure is seeded per fake, so two built the same way never share one", async () => {
	const first = await libraryOf(await built());
	const second = await libraryOf(await built());

	for (const library of [first, second]) {
		assert.ok(
			Number.isSafeInteger(library.structure),
			String(library.structure),
		);
		assert.ok(library.structure > 0);
	}
	assert.notEqual(first.structure, second.structure);
});

test("/changes answers the pair a client holds with a delta, and a pair missing either half is 400", async () => {
	const state = await built();
	const held = await libraryOf(state);
	assert.ok(state.countPlayAt(1));

	const delta = await changesOf(state, {
		since: held.revision,
		structure: held.structure,
	});
	assert.equal(delta.status, 200);
	assert.equal(partOf(delta.body).header.since, held.revision);

	assert.equal((await changesOf(state, { since: held.revision })).status, 400);
	assert.equal(
		(await changesOf(state, { structure: held.structure })).status,
		400,
	);
	const notANumber = await ask(state, "/api/library/changes", [
		["since", String(held.revision)],
		["structure", "soon"],
	]);
	assert.equal(notANumber.status, 400);
});

test("/changes answers 409 for a pair this fake never held", async () => {
	const restarted = await built();
	const before = await libraryOf(await built());
	const held = await libraryOf(restarted);
	assert.ok(restarted.countPlayAt(1));

	const pairs = {
		"another fake's pair": {
			since: before.revision,
			structure: before.structure,
		},
		"another fake's structure with this fake's revision": {
			since: held.revision,
			structure: before.structure,
		},
	};
	for (const [named, pair] of Object.entries(pairs)) {
		const answer = await changesOf(restarted, pair);
		assert.equal(answer.status, 409, named);
		assert.deepEqual(
			jsonOf(answer),
			{
				error:
					"that structure and revision name no position this library held; export the library again",
				detail: "",
			},
			named,
		);
	}

	restarted.startLibraryBuild(DECLARED);
	restarted.finishLibraryBuild();
	const rebuilt = await libraryOf(restarted);
	const fromBefore = await changesOf(restarted, {
		since: held.revision,
		structure: rebuilt.structure,
	});
	assert.equal(fromBefore.status, 409, "a revision from before this structure");
});
