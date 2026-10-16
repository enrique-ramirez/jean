import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
	LATE_EXPRESSIONS,
	LATE_FIELDS,
	TRACK_EXPRESSIONS,
} from "../../src/domain/track/fields.ts";
import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import {
	type PlaylistSnapshot,
	playlistSnapshot,
} from "../../src/domain/track/playlistEntries.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { handleControl } from "../fake-api/routes.ts";
import { createState, type Track } from "../fake-api/state.ts";
import { decodedSnapshot, type Random, seeded } from "./playDeltaLibrary.ts";

type FakeState = ReturnType<typeof createState>;

interface Answer {
	status: number;
	headers: Record<string, string>;
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
		writeHead(code, headers) {
			answer.status = code;
			Object.assign(answer.headers, headers);
		},
		setHeader(name, value) {
			answer.headers[name] = String(value);
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
		},
		on() {},
		destroy() {},
	};
};

const answerOf = async (
	state: FakeState,
	method: string,
	url: URL,
	headers: Record<string, string> = {},
) => {
	const answer: Answer = { status: 0, headers: {}, body: new Uint8Array() };
	await handleFooJean({
		state,
		method,
		url,
		headers,
		body: null,
		response: responderFor(answer),
		artwork: () => false,
	});
	return answer;
};

const ask = (state: FakeState, path: string) =>
	answerOf(state, "GET", new URL(path, "http://fake"));

const post = (state: FakeState, path: string) =>
	answerOf(state, "POST", new URL(path, "http://fake"), {
		"content-type": "application/json",
	});

const freshExport = async (state: FakeState) => {
	const url = new URL("/api/library/export", "http://fake");
	for (const column of TRACK_EXPRESSIONS)
		url.searchParams.append("columns", column);
	const answer = await answerOf(state, "GET", url);
	assert.equal(answer.status, 200);
	return decodedSnapshot(answer.body.slice().buffer);
};

interface Pair {
	structure: number;
	revision: number;
}

const pairOf = async (state: FakeState): Promise<Pair> => {
	const answer = await ask(state, "/api/state");
	const { structure, revision } = JSON.parse(
		new TextDecoder().decode(answer.body),
	).library;
	return { structure, revision };
};

interface Asked {
	path: string;
	query: URLSearchParams;
}

let origins = 0;

function framesRunAtOnce(t: TestContext) {
	const real = globalThis.requestAnimationFrame;
	globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
		setTimeout(() => callback(performance.now()), 0)) as never;
	t.after(() => {
		globalThis.requestAnimationFrame = real;
	});
}

const aborted = (signal: AbortSignal) =>
	new Promise<never>((_, reject) => {
		const refuse = () =>
			reject(new DOMException("The operation was aborted.", "AbortError"));
		if (signal.aborted) refuse();
		else signal.addEventListener("abort", refuse, { once: true });
	});

function jeanAgainst(t: TestContext, state: FakeState) {
	origins += 1;
	const origin = `http://splice-apply-${origins}.invalid:8881`;
	const asked: Asked[] = [];

	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
		state.fooJean.holdSubset = null;
	});
	framesRunAtOnce(t);

	globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		asked.push({ path: url.pathname, query: url.searchParams });
		const headers: Record<string, string> = {};
		request.headers.forEach((value, name) => {
			headers[name] = value;
		});
		const answer = await Promise.race([
			answerOf(state, request.method, url, headers),
			aborted(request.signal),
		]);
		const empty = answer.status === 204 || answer.status === 304;
		return new Response(empty ? null : answer.body, {
			status: answer.status,
			headers: answer.headers,
		});
	}) as typeof fetch;

	const exports = () =>
		asked.filter((entry) => entry.path === "/api/library/export");
	const changesAsked = () =>
		asked.filter((entry) => entry.path === "/api/library/changes");

	return { origin, exports, changesAsked };
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

const lateLoaded = (snapshot: PlaylistSnapshot) =>
	LATE_FIELDS.every((field) => snapshot.columns.fields[field].isLoaded);

const below = (random: Random, count: number) => Math.floor(random() * count);

const directoryOf = (track: Track) =>
	(track["%path%"] ?? "").replace(/[^\\]*$/, "");

let inserted = 0;

// A file named to sort between two of the ones already in its directory: the player orders file
// names by their numbers, and these carry one from the same range.
function newFile(random: Random, tracks: Track[], subsongs: number): Track[] {
	inserted += 1;
	const neighbour = tracks[below(random, tracks.length)];
	const path = `${directoryOf(neighbour)}${1 + below(random, 300)}x ${inserted}.flac`;
	const album =
		random() < 0.5 ? `Inserted album ${inserted}` : neighbour["%album%"];
	return Array.from({ length: subsongs }, (_, at) => {
		const track: Track = {
			...neighbour,
			"%title%": `Inserted ${inserted}.${at + 1}`,
			"%album%": album,
			"%path%": path,
		};
		if (subsongs > 1) track["%subsong%"] = String(at + 1);
		else delete track["%subsong%"];
		return track;
	});
}

type Change = "add" | "remove" | "both";

function changeTracks(random: Random, tracks: Track[], change: Change) {
	if (change !== "add") {
		const count = 1 + below(random, 6);
		for (let at = 0; at < count; at += 1)
			tracks.splice(below(random, tracks.length), 1);
	}
	if (change !== "remove") {
		const files = 1 + below(random, 3);
		for (let at = 0; at < files; at += 1)
			tracks.push(
				...newFile(random, tracks, random() < 0.4 ? 2 + below(random, 3) : 1),
			);
	}
}

async function rebuiltAfter(
	random: Random,
	state: FakeState,
	change: Change,
): Promise<Pair> {
	const plays = below(random, 3);
	for (let play = 0; play < plays; play += 1)
		handleControl({
			state,
			method: "POST",
			path: "/__control/play",
			body: { ordinal: below(random, state.libraryTracks.length) } as never,
			response: responderFor({
				status: 0,
				headers: {},
				body: new Uint8Array(),
			}),
		});

	changeTracks(random, state.libraryTracks, change);
	const refreshed = await post(state, "/api/library/refresh");
	assert.equal(refreshed.status, 202);
	return pairOf(state);
}

function expectHeldAsExported(
	snapshot: PlaylistSnapshot,
	state: Awaited<ReturnType<typeof freshExport>>,
	fields: readonly number[],
) {
	const { columns, paths, subsongs } = snapshot;
	assert.equal(
		columns.trackCount,
		state.columns.trackCount,
		"the row count differs",
	);

	for (const field of fields) {
		const expression = TRACK_EXPRESSIONS[field];
		const held = columns.fields[field];
		const fresh = state.columns.fields[field];
		assert.ok(held.isLoaded, `${expression} is not loaded`);
		for (let row = 0; row < fresh.ids.length; row += 1)
			assert.equal(
				held.at(row),
				fresh.at(row),
				`${expression} at ordinal ${row}`,
			);
		assert.deepEqual(
			Array.from(held.ids),
			Array.from(fresh.ids),
			`${expression}'s ids`,
		);
		assert.deepEqual(
			Array.from({ length: held.distinct }, (_, id) => held.value(id)),
			Array.from({ length: fresh.distinct }, (_, id) => fresh.value(id)),
			`${expression}'s dictionary`,
		);
		assert.equal(
			held.hasUnresolved,
			fresh.hasUnresolved,
			`${expression}'s hasUnresolved`,
		);
		assert.equal(
			held.allUnresolved,
			fresh.allUnresolved,
			`${expression}'s allUnresolved`,
		);
	}

	assert.ok(paths && subsongs, "the spine is not held");
	assert.equal(paths.length, state.paths.length, "the path table's length");
	for (let row = 0; row < state.paths.length; row += 1)
		assert.equal(
			paths.at(row),
			state.paths.at(row),
			`the path at ordinal ${row}`,
		);
	assert.deepEqual(
		Array.from(subsongs),
		Array.from(state.subsongs),
		"the subsongs",
	);
}

const EVERY_FIELD = TRACK_EXPRESSIONS.map((_, field) => field);
const EARLY_FIELDS = EVERY_FIELD.filter(
	(field) => !LATE_FIELDS.includes(field),
);

const SHAPES = {
	"a library of ordinary files": () =>
		libraryOfShape({ tracks: 1000, albums: 40, artists: 8 }),
	"a library of cue sheets": () =>
		libraryOfShape({ tracks: 999, subsongsPerFile: 3 }),
};

const CHANGES: Record<Change, string> = {
	add: "tracks added",
	remove: "tracks removed",
	both: "tracks added and removed in one rebuild",
};

let seed = 0;

for (const [shape, tracksOf] of Object.entries(SHAPES))
	for (const [change, said] of Object.entries(CHANGES) as [Change, string][]) {
		seed += 1;
		const caseSeed = seed;

		test(`after ${said} in ${shape}, Jean holds what a fresh export gives, twice over, and exports nothing`, async (t) => {
			const random = seeded(caseSeed);
			const state = createState({ fooJean: {}, mediaLibrary: tracksOf() });
			const jean = jeanAgainst(t, state);
			const key = loadComponentLibrary(jean.origin);
			assert.ok(
				await until(() => lateLoaded(playlistSnapshot(key))),
				"the library never loaded",
			);
			await settled();

			for (const round of [1, 2]) {
				const held = await pairOf(state);
				const exported = jean.exports().length;
				const now = await rebuiltAfter(random, state, change);
				assert.notEqual(
					now.structure,
					held.structure,
					"the structure did not move",
				);

				await recheckComponentLibrary(jean.origin, now);
				await settled();

				assert.deepEqual(
					jean
						.exports()
						.slice(exported)
						.map((entry) => entry.query.toString()),
					[],
					`splice ${round} was answered by exporting the library again`,
				);
				const asked = jean.changesAsked().at(-1)?.query;
				assert.equal(
					asked?.get("structure"),
					String(held.structure),
					`splice ${round} was not asked from the structure Jean held`,
				);
				assert.equal(
					asked?.get("since"),
					String(held.revision),
					`splice ${round} was not asked from the revision Jean held`,
				);
				assert.equal(
					playlistSnapshot(key).structure,
					now.structure,
					`Jean does not hold structure ${now.structure} after splice ${round}`,
				);
				expectHeldAsExported(
					playlistSnapshot(key),
					await freshExport(state),
					EVERY_FIELD,
				);
			}
		});
	}

test("a splice that lands while the late part is still held is applied to the columns loaded, and the late part arrives at the new structure", async (t) => {
	const random = seeded(101);
	const state = createState({
		fooJean: { holdSubset: [...LATE_EXPRESSIONS] },
		mediaLibrary: SHAPES["a library of cue sheets"](),
	});
	const jean = jeanAgainst(t, state);
	const key = loadComponentLibrary(jean.origin);
	assert.ok(
		await until(() => !playlistSnapshot(key).isLoading),
		"the first part never loaded",
	);
	assert.ok(
		await until(() =>
			jean
				.exports()
				.some(
					(entry) =>
						entry.query.has("only") && entry.query.get("spine") === "false",
				),
		),
		"Jean never asked for the late part",
	);
	const exported = jean.exports().length;

	const held = await pairOf(state);
	const now = await rebuiltAfter(random, state, "both");
	await recheckComponentLibrary(jean.origin, now);
	await settled();

	assert.equal(
		jean.exports().length,
		exported,
		"the splice was answered by exporting the library again",
	);
	assert.equal(
		jean.changesAsked().at(-1)?.query.get("structure"),
		String(held.structure),
	);
	assert.equal(playlistSnapshot(key).structure, now.structure);
	assert.ok(
		!lateLoaded(playlistSnapshot(key)),
		"the late part landed while the fake still held it",
	);
	expectHeldAsExported(
		playlistSnapshot(key),
		await freshExport(state),
		EARLY_FIELDS,
	);

	state.fooJean.holdSubset = null;
	assert.ok(
		await until(() => lateLoaded(playlistSnapshot(key))),
		"the late part never landed",
	);
	await settled();

	assert.equal(
		jean.exports().length,
		exported,
		"the late part was asked for again",
	);
	expectHeldAsExported(
		playlistSnapshot(key),
		await freshExport(state),
		EVERY_FIELD,
	);
});
