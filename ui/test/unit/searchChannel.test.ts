import assert from "node:assert/strict";
import test from "node:test";

import { FIELD } from "../../src/domain/track/fields.ts";
import type { StoredEvent } from "../../src/domain/track/libraryStore.ts";
import type { LibraryStore } from "../../src/domain/track/libraryStoreDb.ts";
import {
	type SearchPort,
	serveSearch,
} from "../../src/domain/track/searchChannel.ts";
import { searchClient } from "../../src/domain/track/searchClient.ts";
import type { SearchQuestion } from "../../src/domain/track/searchCore.ts";
import {
	type Change,
	columnsOf,
	freshKey,
	generatedLibrary,
	mainThreadAlbum,
	mainThreadArtist,
	mainThreadGenre,
	mainThreadSearch,
	patched,
	searchLibraryOf,
} from "./searchLibraries.ts";

// Clones and transfers as `postMessage` does: a transferred buffer is detached on the sending side.

type Listener = (event: MessageEvent) => void;

function fakeChannel() {
	const listeners = { page: new Set<Listener>(), worker: new Set<Listener>() };
	const sent = { page: [] as unknown[], worker: [] as unknown[] };
	const held: (() => void)[] = [];
	let holding = false;

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
				if (self === "worker" && holding) held.push(() => deliver(other, data));
				else deliver(other, data);
			},
			addEventListener: (type: string, listener: Listener) => {
				if (type === "message") listeners[self].add(listener);
			},
			removeEventListener: (type: string, listener: Listener) => {
				if (type === "message") listeners[self].delete(listener);
			},
		} as SearchPort;
	};

	return {
		page: end("page"),
		worker: end("worker"),
		sent,
		heldCount: () => held.length,
		hold: () => {
			holding = true;
		},
		release: () => {
			holding = false;
			for (const send of held.splice(0)) send();
		},
	};
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

const MOVED_TO = {
	title: "Zafiro",
	artist: "Nadie Más",
	album: "Ópalo Nuevo",
	genre: "Bossa",
};

function movedRecord(rows: string[][]) {
	const album = rows[0][FIELD.album];
	const albumArtist = rows[0][FIELD.albumArtist];
	const ordinals = rows.flatMap((row, ordinal) =>
		row[FIELD.album] === album && row[FIELD.albumArtist] === albumArtist
			? [ordinal]
			: [],
	);
	const changes: Change[] = ordinals.flatMap((ordinal) => [
		{ ordinal, field: FIELD.title, value: MOVED_TO.title },
		{ ordinal, field: FIELD.artist, value: MOVED_TO.artist },
		{ ordinal, field: FIELD.albumArtist, value: MOVED_TO.artist },
		{ ordinal, field: FIELD.album, value: MOVED_TO.album },
		{ ordinal, field: FIELD.genre, value: MOVED_TO.genre },
	]);
	return { changes, album, albumArtist };
}

type Answered = ReturnType<typeof normalised>;

const listed = (refs: ArrayLike<number> | null | undefined) =>
	refs == null ? null : Array.from(refs);

// biome-ignore lint/suspicious/noExplicitAny: an answer of whichever kind was asked
function normalised(question: SearchQuestion, answer: any) {
	switch (question.kind) {
		case "search":
			return {
				matched: listed(answer.matched),
				best: Array.from(answer.best as ArrayLike<number>),
				artists: answer.artists.map((entity: { key: string }) => entity.key),
				albums: answer.albums.map((entity: { key: string }) => entity.key),
				genres: answer.genres.map((entity: { key: string }) => entity.key),
				namesATrack: answer.namesATrack,
			};
		case "album":
			return {
				refs: listed(answer.refs),
				album: answer.album,
				artist: answer.artist,
			};
		case "artist":
			return {
				own: listed(answer.own),
				shared: listed(answer.shared),
				guest: listed(answer.guest),
				all: listed(answer.all),
			};
		case "genre":
			return listed(answer);
	}
}

function mainThreadAnswer(
	columns: ReturnType<typeof columnsOf>,
	question: SearchQuestion,
): Answered {
	switch (question.kind) {
		case "search":
			return mainThreadSearch(
				columns,
				freshKey(),
				question.query,
				question.limit,
				question.splitsCredits,
			);
		case "album":
			return mainThreadAlbum(columns, question.artist, question.album);
		case "artist":
			return mainThreadArtist(columns, question.artist, question.splitsCredits);
		case "genre":
			return mainThreadGenre(columns, question.genre);
	}
}

function questionsAbout(record: { album: string; albumArtist: string }) {
	const questions: { name: string; question: SearchQuestion }[] = [
		{
			name: "a search",
			question: {
				kind: "search",
				query: MOVED_TO.title.toLowerCase(),
				limit: 8,
				splitsCredits: true,
			},
		},
		{
			name: "an album page",
			question: {
				kind: "album",
				artist: record.albumArtist,
				album: record.album,
			},
		},
		{
			name: "an artist page",
			question: {
				kind: "artist",
				artist: MOVED_TO.artist,
				splitsCredits: true,
			},
		},
		{
			name: "a genre page",
			question: { kind: "genre", genre: MOVED_TO.genre },
		},
	];
	return questions;
}

for (const change of ["a delta", "a new export"] as const)
	test(`after ${change}, an answer asked before it is dropped and the next is the new library's`, async (t) => {
		for (const { name, question } of questionsAbout(
			movedRecord(library().rows),
		))
			await t.test(name, async () => {
				const held = library();
				const record = movedRecord(held.rows);
				const before = columnsOf(held.exported());
				const { channel, client } = connected();
				client.load(held.exported().slice(0));
				await client.ask(question);

				const delta = held.change(record.changes);
				const after = patched(before, delta);
				const old = mainThreadAnswer(before, question);
				const fresh = mainThreadAnswer(after, question);
				assert.notDeepEqual(old, fresh, "the change moves no answer");

				channel.hold();
				const asked = client.ask(question);
				await until(
					() => channel.heldCount() > 0,
					"the worker answered the question asked before the change",
				);

				if (change === "a delta") client.patch(delta);
				else
					client.load(
						searchLibraryOf(held.rows.map((row) => [...row]))
							.exported()
							.slice(0),
					);
				const next = client.ask(question);
				await until(
					() => channel.heldCount() > 1,
					"the worker answered the question asked after the change",
				);
				channel.release();

				assert.equal(
					await asked,
					null,
					"an answer from the old library was handed back",
				);
				assert.deepEqual(normalised(question, await next), fresh);
			});
	});

const PAST_ANY_BOUND_MS = 60_000;

function slowStore(events: () => StoredEvent[]) {
	let finish = () => {};
	const store: LibraryStore = {
		build: "build-a",
		keep: () => {},
		stored: async () => null,
		restore: () =>
			new Promise((resolve) => {
				finish = () => resolve(events());
			}),
		forget: async () => {},
	};
	return { store, finish: () => finish() };
}

test("a restore answered after the page gave up on it never replaces the library loaded since", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	const stale = generatedLibrary(1, 60);
	const fresh = generatedLibrary(2, 40);
	const question: SearchQuestion = {
		kind: "search",
		query: "a",
		limit: 8,
		splitsCredits: false,
	};
	const answerOfFresh = mainThreadAnswer(columnsOf(fresh.exported()), question);
	assert.notDeepEqual(
		mainThreadAnswer(columnsOf(stale.exported()), question),
		answerOfFresh,
		"the stored library and the player's answer the question alike",
	);

	const channel = fakeChannel();
	const { store, finish } = slowStore(() => [
		{ kind: "load", bytes: stale.exported().slice(0) },
	]);
	serveSearch(channel.worker, store);
	const client = searchClient(channel.page);

	const restoring = client.restore();
	await turn();
	t.mock.timers.tick(PAST_ANY_BOUND_MS);
	assert.equal(await restoring, null, "the page was handed the late copy");

	client.load(fresh.exported().slice(0));
	assert.deepEqual(
		normalised(question, await client.ask(question)),
		answerOfFresh,
	);

	finish();
	assert.deepEqual(
		normalised(question, await client.ask(question)),
		answerOfFresh,
		"the late restore replaced the library the page loaded",
	);
});

test("a question the worker never answers still settles", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	const silent: SearchPort = {
		postMessage: () => {},
		addEventListener: () => {},
	};
	const client = searchClient(silent);
	client.load(library().exported().slice(0));

	let isSettled = false;
	void client.ask({ kind: "genre", genre: "Bossa" }).finally(() => {
		isSettled = true;
	});

	await turn();
	t.mock.timers.tick(PAST_ANY_BOUND_MS);
	await turn();
	assert.equal(isSettled, true, "the question is still waiting");
});
