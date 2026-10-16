import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { rowAt } from "../../src/domain/track/libraryColumns.ts";
import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import { playlistSnapshot } from "../../src/domain/track/playlistEntries.ts";
import {
	type Column,
	changedColumn,
	type Dictionary,
	dictionary,
	encodeJlib,
	wholeColumn,
} from "../fake-api/jlib.ts";
import { playLibrary, seeded } from "./playDeltaLibrary.ts";

const LATE_FIELDS = [
	FIELD.codec,
	FIELD.bitrate,
	FIELD.added,
	FIELD.artists,
	FIELD.artistIds,
	FIELD.albumArtists,
	FIELD.albumArtistIds,
];
const LATE = LATE_FIELDS.map((field) => TRACK_EXPRESSIONS[field]);
const EARLY = TRACK_EXPRESSIONS.filter((column) => !LATE.includes(column));

const sorted = (columns: readonly string[]) => [...columns].sort();

const cut = (path: string) => path.lastIndexOf("/") + 1;

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

interface Change {
	ordinal: number;
	field: number;
	value: string;
}

function partedLibrary(seed: number) {
	const { rows, paths, subsongs } = playLibrary(seeded(seed));
	const structure = 7;
	let revision = 40;
	const dictionaries = new Map<string, Dictionary>();
	const dictionaryFor = (name: string) => {
		let held = dictionaries.get(name);
		if (!held) {
			held = dictionary();
			dictionaries.set(name, held);
		}
		return held;
	};
	const sizes = () =>
		new Map(
			[...dictionaries].map(([name, dict]) => [name, dict.values.length]),
		);

	const bone = (name: string, values: string[]) =>
		wholeColumn(null, dictionaryFor(name), values);

	const exported = (only: readonly string[] | null, spine: boolean) =>
		bufferOf(
			encodeJlib({
				kind: "snapshot",
				structure,
				revision,
				trackCount: rows.length,
				columns: TRACK_EXPRESSIONS.map(
					(expression, field): Column =>
						wholeColumn(
							expression,
							dictionaryFor(expression),
							rows.map((row) => row[field]),
						),
				),
				spine: {
					directory: bone(
						"directory",
						paths.map((path) => path.slice(0, cut(path))),
					),
					filename: bone(
						"filename",
						paths.map((path) => path.slice(cut(path))),
					),
					subsong: bone("subsong", subsongs.map(String)),
				},
				...(only ? { carried: only } : null),
				spineCarried: spine,
			}),
		);

	exported(null, true);
	const history = [
		{ revision, changed: new Map<number, Set<number>>(), sizes: sizes() },
	];

	return {
		rows,
		structure,
		get revision() {
			return revision;
		},
		exported,
		change: (changes: readonly Change[]) => {
			const changed = new Map<number, Set<number>>();
			for (const { ordinal, field, value } of changes) {
				rows[ordinal][field] = value;
				dictionaryFor(TRACK_EXPRESSIONS[field]).id(value);
				const ordinals = changed.get(field) ?? new Set<number>();
				ordinals.add(ordinal);
				changed.set(field, ordinals);
			}
			revision += 1;
			history.push({ revision, changed, sizes: sizes() });
		},
		changesSince: (since: number) => {
			const at = history.findIndex((entry) => entry.revision === since);
			if (at < 0) throw new Error(`no revision ${since} is held`);
			const moved = new Map<number, Set<number>>();
			for (const entry of history.slice(at + 1))
				for (const [field, ordinals] of entry.changed) {
					const held = moved.get(field) ?? new Set<number>();
					for (const ordinal of ordinals) held.add(ordinal);
					moved.set(field, held);
				}
			return bufferOf(
				encodeJlib({
					kind: "delta",
					structure,
					revision,
					since,
					trackCount: rows.length,
					columns: [...moved].map(([field, ordinals]) => {
						const name = TRACK_EXPRESSIONS[field];
						return changedColumn(
							name,
							dictionaryFor(name),
							history[at].sizes.get(name) ?? 0,
							[...ordinals]
								.sort((a, b) => a - b)
								.map((ordinal) => ({ ordinal, value: rows[ordinal][field] })),
						);
					}),
					spine: {},
				}),
			);
		},
	};
}

type PartedLibrary = ReturnType<typeof partedLibrary>;

interface Asked {
	path: string;
	columns: string[];
	only: string[] | null;
	spine: string | null;
	since: number | null;
}

interface Gate {
	waiting: ((body: () => ArrayBuffer) => void)[];
	isClosed: boolean;
}

const gate = (): Gate => ({ waiting: [], isClosed: false });

const through = (held: Gate, body: () => ArrayBuffer) =>
	held.isClosed
		? new Promise<Response>((answer) =>
				held.waiting.push((chosen) => answer(new Response(chosen()))),
			)
		: Promise.resolve(new Response(body()));

const open = (held: Gate, body?: () => ArrayBuffer) => {
	held.isClosed = false;
	for (const answer of held.waiting.splice(0))
		answer(body ?? (() => new ArrayBuffer(0)));
};

let origins = 0;

function framesRunAtOnce(t: TestContext) {
	const real = globalThis.requestAnimationFrame;
	globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
		setTimeout(() => callback(performance.now()), 0)) as never;
	t.after(() => {
		globalThis.requestAnimationFrame = real;
	});
}

function partedPlayer(t: TestContext, library: PartedLibrary) {
	origins += 1;
	const origin = `http://library-parts-${origins}.invalid:8881`;
	const asked: Asked[] = [];
	const late = gate();
	const changes = gate();

	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
		open(late, () => library.exported(LATE, false));
		open(changes, () => library.changesSince(library.revision));
	});
	framesRunAtOnce(t);

	globalThis.fetch = ((request: Request) => {
		const url = new URL(request.url);
		const query = url.searchParams;
		const since = query.get("since");
		const entry: Asked = {
			path: url.pathname,
			columns: query.getAll("columns"),
			only: query.has("only") ? query.getAll("only") : null,
			spine: query.get("spine"),
			since: since === null ? null : Number(since),
		};
		asked.push(entry);

		if (url.pathname === "/api/library/export") {
			const answer = () =>
				library.exported(entry.only, entry.spine !== "false");
			const isLate = entry.only?.some((column) => LATE.includes(column));
			return isLate
				? through(late, answer)
				: Promise.resolve(new Response(answer()));
		}
		if (url.pathname === "/api/library/changes")
			return through(changes, () => library.changesSince(entry.since ?? 0));
		if (url.pathname === "/api/state")
			return Promise.resolve(
				Response.json({
					library: {
						ready: true,
						structure: library.structure,
						revision: library.revision,
						trackCount: library.rows.length,
						columns: TRACK_EXPRESSIONS,
						build: null,
					},
				}),
			);
		return Promise.reject(new Error(`unexpected request: ${url.pathname}`));
	}) as typeof fetch;

	const exports = () =>
		asked.filter((entry) => entry.path === "/api/library/export");
	const lateParts = () =>
		exports().filter((entry) =>
			entry.only?.some((column) => LATE.includes(column)),
		);
	const changesAsked = () =>
		asked.filter((entry) => entry.path === "/api/library/changes");

	return { origin, asked, late, changes, exports, lateParts, changesAsked };
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

const TURNS = 400;
async function until(condition: () => boolean) {
	for (let at = 0; at < TURNS && !condition(); at += 1) await turn();
	return condition();
}

async function settled() {
	for (let at = 0; at < 20; at += 1) await turn();
}

const valueAt = (key: string, ordinal: number, field: number) =>
	rowAt(playlistSnapshot(key).columns, ordinal)[field];

function expectHeldAsTheLibrary(key: string, library: PartedLibrary) {
	const { columns } = playlistSnapshot(key);
	assert.equal(columns.trackCount, library.rows.length);
	for (const [ordinal, row] of library.rows.entries()) {
		const held = rowAt(columns, ordinal);
		for (const [field, expression] of TRACK_EXPRESSIONS.entries())
			assert.equal(
				held[field],
				row[field],
				`${expression} at ordinal ${ordinal} is not the library's`,
			);
	}
}

async function firstPartIn(t: TestContext, library: PartedLibrary) {
	const player = partedPlayer(t, library);
	player.late.isClosed = true;
	const key = loadComponentLibrary(player.origin);

	assert.ok(
		await until(() => !playlistSnapshot(key).isLoading),
		"the first part never loaded",
	);
	const [first] = player.exports();
	assert.deepEqual(
		sorted(first.only ?? TRACK_EXPRESSIONS),
		sorted(EARLY),
		"the first export did not ask for every column but the late set",
	);
	assert.ok(
		await until(() => player.lateParts().length > 0),
		"Jean never asked for the late part",
	);
	return { player, key };
}

const NEW_CODEC = "Opus";
const NEW_PLAYS = "4321";
const PLAYED = 3;
const RECODED = 11;

const aPlayAndARecode = (library: PartedLibrary): Change[] => [
	{ ordinal: PLAYED, field: FIELD.playCount, value: NEW_PLAYS },
	{ ordinal: RECODED, field: FIELD.codec, value: NEW_CODEC },
];

test("a delta naming a column Jean has not loaded moves the columns it holds and leaves that one alone", async (t) => {
	const library = partedLibrary(5);
	const { player, key } = await firstPartIn(t, library);

	library.change(aPlayAndARecode(library));
	await recheckComponentLibrary(player.origin, {
		structure: library.structure,
		revision: library.revision,
	});
	await settled();

	assert.equal(
		valueAt(key, PLAYED, FIELD.playCount),
		NEW_PLAYS,
		"the play count the delta carried was not applied",
	);
	assert.notEqual(
		valueAt(key, RECODED, FIELD.codec),
		NEW_CODEC,
		"the codec was taken from a delta before the column was loaded",
	);
	assert.equal(player.exports().length, 2, "Jean exported the library again");

	open(player.late, () => library.exported(LATE, false));
	assert.ok(
		await until(() => valueAt(key, RECODED, FIELD.codec) === NEW_CODEC),
		"the late part never reached the store",
	);
	expectHeldAsTheLibrary(key, library);
});

test("a late part answered at an older revision is patched forward from its own revision before it is used", async (t) => {
	const library = partedLibrary(6);
	const { player, key } = await firstPartIn(t, library);
	const answeredAt = library.revision;
	const stale = library.exported(LATE, false);
	const staleCodec = library.rows[RECODED][FIELD.codec];

	library.change(aPlayAndARecode(library));
	await recheckComponentLibrary(player.origin, {
		structure: library.structure,
		revision: library.revision,
	});
	assert.ok(
		await until(() => valueAt(key, PLAYED, FIELD.playCount) === NEW_PLAYS),
		"the play never reached the store",
	);

	const before = player.changesAsked().length;
	player.changes.isClosed = true;
	open(player.late, () => stale);

	assert.ok(
		await until(() => player.changesAsked().length > before),
		"Jean used the late part without asking for what moved since it was answered",
	);
	assert.equal(
		player.changesAsked().at(-1)?.since,
		answeredAt,
		"the late part was not patched from the revision it was answered at",
	);
	await settled();
	assert.notEqual(
		valueAt(key, RECODED, FIELD.codec),
		staleCodec,
		"the late part's codec was shown before it was patched forward",
	);

	open(player.changes, () => library.changesSince(answeredAt));
	assert.ok(
		await until(() => valueAt(key, RECODED, FIELD.codec) === NEW_CODEC),
		"the late part was never patched forward",
	);
	await settled();
	expectHeldAsTheLibrary(key, library);
	assert.equal(player.exports().length, 2, "Jean exported the library again");
});

test("a late part answered at a newer revision waits until the columns Jean holds are patched up to it", async (t) => {
	const library = partedLibrary(7);
	const { player, key } = await firstPartIn(t, library);
	const held = library.revision;

	library.change(aPlayAndARecode(library));
	player.changes.isClosed = true;
	open(player.late, () => library.exported(LATE, false));

	assert.ok(
		await until(() => player.changesAsked().length > 0),
		"Jean never asked for what moved between the revision it holds and the late part's",
	);
	assert.equal(player.changesAsked()[0].since, held);
	await settled();
	for (const [ordinal, row] of library.rows.entries())
		assert.notEqual(
			valueAt(key, ordinal, FIELD.codec),
			row[FIELD.codec],
			`the late part was used at ordinal ${ordinal} before the rest caught up with it`,
		);

	open(player.changes, () => library.changesSince(held));
	assert.ok(
		await until(() => valueAt(key, RECODED, FIELD.codec) === NEW_CODEC),
		"the late part was never used",
	);
	await settled();
	expectHeldAsTheLibrary(key, library);
	assert.equal(
		player.lateParts().length,
		1,
		"the late part was asked for twice",
	);
	assert.equal(player.exports().length, 2, "Jean exported the library again");
});
