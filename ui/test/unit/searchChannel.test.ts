import assert from "node:assert/strict";
import test from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	type KeepNote,
	LIBRARY_FORMAT,
	type StoredEvent,
} from "../../src/domain/track/libraryStore.ts";
import type { LibraryStore } from "../../src/domain/track/libraryStoreDb.ts";
import {
	type SearchPort,
	serveSearch,
} from "../../src/domain/track/searchChannel.ts";
import { searchClient } from "../../src/domain/track/searchClient.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import { generatedLibrary } from "./searchLibraries.ts";

// Clones and transfers as `postMessage` does: a transferred buffer is detached on the sending side.

type Listener = (event: MessageEvent) => void;

function fakeChannel() {
	const listeners = { page: new Set<Listener>(), worker: new Set<Listener>() };
	const sent = { page: [] as unknown[], worker: [] as unknown[] };

	const deliver = (to: "page" | "worker", data: unknown) =>
		setImmediate(() => {
			for (const listener of listeners[to])
				listener(new MessageEvent("message", { data }));
		});

	const end = (self: "page" | "worker"): SearchPort => {
		const other = self === "page" ? "worker" : "page";
		return {
			postMessage: (
				message: unknown,
				options?: Transferable[] | StructuredSerializeOptions,
			) => {
				const transfer = Array.isArray(options)
					? options
					: (options?.transfer ?? []);
				const data = structuredClone(message, { transfer });
				sent[self].push(data);
				deliver(other, data);
			},
			addEventListener: (type: string, listener: Listener) => {
				if (type === "message") listeners[self].add(listener);
			},
			removeEventListener: (type: string, listener: Listener) => {
				if (type === "message") listeners[self].delete(listener);
			},
		} as SearchPort;
	};

	return { page: end("page"), worker: end("worker"), sent };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, what: string) {
	for (let turns = 0; turns < 1_000; turns += 1) {
		if (condition()) return;
		await turn();
	}
	assert.fail(`never happened: ${what}`);
}

function connected() {
	const channel = fakeChannel();
	serveSearch(channel.worker);
	return { channel, client: searchClient(channel.page) };
}

const library = () => generatedLibrary(13, 300);

const strings = (value: unknown, into: string[] = []): string[] => {
	if (typeof value === "string") into.push(value);
	else if (Array.isArray(value)) for (const item of value) strings(item, into);
	else if (value && typeof value === "object" && !ArrayBuffer.isView(value))
		for (const item of Object.values(value)) strings(item, into);
	return into;
};

const buffers = (value: unknown, into: ArrayBuffer[] = []): ArrayBuffer[] => {
	if (value instanceof ArrayBuffer) into.push(value);
	else if (ArrayBuffer.isView(value)) into.push(value.buffer as ArrayBuffer);
	else if (Array.isArray(value)) for (const item of value) buffers(item, into);
	else if (value && typeof value === "object")
		for (const item of Object.values(value)) buffers(item, into);
	return into;
};

const typesOf = (messages: unknown[]) =>
	messages.map((message) => (message as { type: string }).type);

test("the export reaches the worker as its own bytes, by transfer, and no value of it as a string", () => {
	const held = library();
	const { channel, client } = connected();

	const bytes = held.exported().slice(0);
	const length = bytes.byteLength;
	client.load(bytes);

	assert.equal(bytes.byteLength, 0, "the page kept the bytes it handed over");
	assert.ok(
		channel.sent.page.some((message) =>
			buffers(message).some((buffer) => buffer.byteLength === length),
		),
		"no message carried the export's bytes",
	);

	const values = new Set(
		held.rows.flatMap((row) => [
			row[FIELD.title],
			row[FIELD.artist],
			row[FIELD.album],
		]),
	);
	const posted = channel.sent.page.flatMap((message) => strings(message));
	assert.deepEqual(
		posted.filter((text) => values.has(text)),
		[],
		"the library's values crossed as strings",
	);
});

test("a delta reaches the worker as its own bytes, by transfer", async () => {
	const held = library();
	const { channel, client } = connected();
	client.load(held.exported().slice(0));

	const delta = held.change([
		{ ordinal: 0, field: FIELD.title, value: "Zafiro Relámpago" },
	]);
	const length = delta.byteLength;
	const before = channel.sent.page.length;
	client.patch(delta);

	assert.equal(delta.byteLength, 0, "the page kept the delta it handed over");
	assert.ok(
		channel.sent.page
			.slice(before)
			.some((message) =>
				buffers(message).some((buffer) => buffer.byteLength === length),
			),
		"no message carried the delta's bytes",
	);
	assert.deepEqual(
		channel.sent.page
			.slice(before)
			.flatMap((message) => strings(message))
			.filter((text) => text === "Zafiro Relámpago"),
		[],
		"the delta's values crossed as strings",
	);
});

test("the worker answers no question: a search posted to it after a load gets no reply", async () => {
	const { channel, client } = connected();
	client.load(library().exported().slice(0));

	channel.page.postMessage(
		{
			type: "ask",
			id: 1,
			question: { kind: "search", query: "a", limit: 8, splitsCredits: false },
		},
		[],
	);
	await client.stored();

	assert.deepEqual(typesOf(channel.sent.worker), ["stored"]);
});

const PAST_ANY_BOUND_MS = 60_000;

const noteFor = (structure: number, revision: number): KeepNote => ({
	snapshotId: "00000000000000a1",
	trackCount: 300,
	structure,
	revision,
	declaration: TRACK_EXPRESSIONS,
	format: LIBRARY_FORMAT,
	apiVersion: 1,
	isWhole: true,
});

function recordingStore(restore: () => Promise<StoredEvent[] | null>) {
	const keeps: { note: KeepNote; events: StoredEvent[] }[] = [];
	const store: LibraryStore = {
		build: "build-a",
		keep: (events, note) => {
			keeps.push({ note, events });
		},
		stored: async () => null,
		restore,
		forget: async () => {},
	};
	return { store, keeps };
}

const pairOf = (bytes: ArrayBuffer) => {
	const decoded = decodeJlib(bytes);
	return { structure: decoded.structure, revision: decoded.revision };
};

test("a restore under a new pair hands the page one copy re-keyed to that pair, and stores it under that pair", async () => {
	const held = library();
	const exported = held.exported().slice(0);
	const delta = held.change([
		{ ordinal: 3, field: FIELD.playCount, value: "61" },
	]);
	const note = noteFor(21, 1);
	assert.notDeepEqual(
		pairOf(exported),
		{ structure: note.structure, revision: note.revision },
		"the stored copy is already under the new pair",
	);

	const channel = fakeChannel();
	const { store, keeps } = recordingStore(async () => [
		{ kind: "load", bytes: exported.slice(0) },
		{ kind: "delta", bytes: delta.slice(0) },
	]);
	serveSearch(channel.worker, store);
	const client = searchClient(channel.page);

	const events = await client.restore(note);
	assert.ok(events, "the page was handed nothing");
	assert.deepEqual(
		events.map(({ kind }) => kind),
		["load"],
	);
	assert.deepEqual(pairOf(events[0].bytes), {
		structure: note.structure,
		revision: note.revision,
	});

	assert.equal(keeps.length, 1, "stores kept");
	assert.deepEqual(keeps[0].note, note);
	assert.deepEqual(
		keeps[0].events.map(({ kind, bytes }) => ({ kind, ...pairOf(bytes) })),
		[{ kind: "load", structure: note.structure, revision: note.revision }],
	);
});

test("a restore answered after the page gave up on it never replaces the library stored since", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	const stale = generatedLibrary(1, 60).exported();
	const fresh = generatedLibrary(2, 40).exported();
	const freshNote = noteFor(30, 0);

	let finish = () => {};
	const channel = fakeChannel();
	const { store, keeps } = recordingStore(
		() =>
			new Promise((resolve) => {
				finish = () => resolve([{ kind: "load", bytes: stale.slice(0) }]);
			}),
	);
	serveSearch(channel.worker, store);
	const client = searchClient(channel.page);

	const restoring = client.restore(noteFor(21, 1));
	await turn();
	t.mock.timers.tick(PAST_ANY_BOUND_MS);
	assert.equal(await restoring, null, "the page was handed the late copy");

	client.load(fresh.slice(0), freshNote);
	await until(() => keeps.length > 0, "the new library was stored");

	finish();
	await client.stored();

	assert.deepEqual(
		keeps.map(({ note, events }) => ({
			note,
			events: events.map(({ kind, bytes }) => ({
				kind,
				byteLength: bytes.byteLength,
			})),
		})),
		[
			{
				note: freshNote,
				events: [{ kind: "load", byteLength: fresh.byteLength }],
			},
		],
		"the late restore stored over the library the page loaded",
	);
});

test("a stored copy that does not replay is restored as nothing, and nothing is stored in its place", async () => {
	const channel = fakeChannel();
	const { store, keeps } = recordingStore(async () => [
		{ kind: "load", bytes: new Uint8Array([1, 2, 3, 4]).buffer },
	]);
	serveSearch(channel.worker, store);
	const client = searchClient(channel.page);

	assert.equal(await client.restore(), null, "restored as it was stored");
	assert.equal(await client.restore(noteFor(21, 1)), null, "restored re-keyed");
	assert.deepEqual(keeps, []);
});

test("a stored copy and a restore the worker never answers still settle, as nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	const silent: SearchPort = {
		postMessage: () => {},
		addEventListener: () => {},
	};
	const client = searchClient(silent);
	client.load(library().exported().slice(0));

	const settled: unknown[] = [];
	void client.stored().then((copy) => settled.push(copy));
	void client.restore().then((events) => settled.push(events));

	await turn();
	t.mock.timers.tick(PAST_ANY_BOUND_MS);
	await turn();
	assert.deepEqual(settled, [null, null]);
});
