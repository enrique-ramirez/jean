import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as libraryRoutes from "../fake-api/fooJean/library.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { createState, type Track } from "../fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;

const CORE = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../plugins/fb2k/src/core",
);

const headerOf = (name: string) => readFileSync(join(CORE, name), "utf8");

const sizeConstant = (header: string, name: string): number => {
	const declared = new Map(
		[...header.matchAll(/constexpr\s+size_t\s+(\w+)\s*=\s*([^;]+);/g)].map(
			([, constant, value]) => [constant, value],
		),
	);
	const evaluated = (constant: string): number => {
		const value = declared.get(constant);
		assert.ok(value !== undefined, `no constexpr size_t ${constant}`);
		return value
			.split("*")
			.map((term) => term.trim())
			.reduce((product, term) => {
				const literal = /^(?:size_t\{(\d+)\}|(\d+))$/.exec(term);
				if (literal) return product * Number(literal[1] ?? literal[2]);
				assert.ok(/^\w+$/.test(term), `cannot read ${constant}: ${value}`);
				return product * evaluated(term);
			}, 1);
	};
	return evaluated(name);
};

const LIBRARY_TOO_LARGE = (() => {
	const said = /constexpr\s+char\s+kLibraryTooLarge\[\]\s*=\s*"([^"]*)";/.exec(
		headerOf("failures.h"),
	);
	assert.ok(said, "failures.h declares no kLibraryTooLarge");
	return { error: said[1] };
})();

const COMPONENT_CEILING = sizeConstant(
	headerOf("http_server.h"),
	"kMaxLibraryBytes",
);
const COMPONENT_RETAINED = sizeConstant(
	headerOf("library.h"),
	"kRetainedRevisions",
);

const PLAY_COUNT = "%lastfm_play_count%";
const COUNTED = ["%title%", PLAY_COUNT];
const GZIP = { "accept-encoding": "gzip" };
const IDENTITY = {};

interface Answer {
	status: number;
	body: Uint8Array<ArrayBuffer>;
}

const ask = async (
	state: FakeState,
	path: string,
	query: [string, string][],
	headers: Record<string, string>,
): Promise<Answer> => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query) url.searchParams.append(name, value);

	let status = 0;
	const chunks: Uint8Array[] = [];
	const write = (chunk: string | Uint8Array) => {
		chunks.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	};
	const response: Responder = {
		writeHead(code) {
			status = code;
		},
		setHeader() {},
		write,
		end(chunk) {
			if (chunk !== undefined) write(chunk);
		},
		on() {},
		destroy() {},
	};

	await handleFooJean({
		state,
		method: "GET",
		url,
		headers,
		body: null,
		response,
		artwork: () => false,
	});

	const body = new Uint8Array(
		chunks.reduce((total, chunk) => total + chunk.length, 0),
	);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.length;
	}
	return { status, body };
};

const jsonOf = (answer: Answer) =>
	JSON.parse(new TextDecoder().decode(answer.body));

const exportOf = (
	state: FakeState,
	columns: readonly string[],
	headers: Record<string, string> = IDENTITY,
) =>
	ask(
		state,
		"/api/library/export",
		columns.map((column) => ["columns", column]),
		headers,
	);

interface Held {
	structure: number;
	revision: number;
}

const heldOf = async (state: FakeState): Promise<Held> => {
	const { structure, revision } = jsonOf(
		await ask(state, "/api/state", [], IDENTITY),
	).library;
	return { structure, revision };
};

const changesOf = (
	state: FakeState,
	{ structure, revision }: Held,
	headers: Record<string, string> = IDENTITY,
) =>
	ask(
		state,
		"/api/library/changes",
		[
			["since", String(revision)],
			["structure", String(structure)],
		],
		headers,
	);

const counting = (fooJean: FooJeanOptions, tracks: Track[]) =>
	createState({ fooJean, countsPlays: true, mediaLibrary: tracks });

const SMALL = () => libraryOfShape({ tracks: 40, albums: 4, artists: 2 });

const declared = (fooJean: FooJeanOptions) => {
	const state = counting(fooJean, SMALL());
	state.startLibraryBuild(COUNTED);
	state.finishLibraryBuild();
	return state;
};

test("the fake's library ceiling is the component's kMaxLibraryBytes", () => {
	assert.ok(Number.isSafeInteger(COMPONENT_CEILING) && COMPONENT_CEILING > 0);
	assert.equal(libraryRoutes.MAX_LIBRARY_BYTES, COMPONENT_CEILING);
});

// `http_responses.cpp` bounds the serialised body, before any content coding, and refuses only
// what is larger than the ceiling.
test("an export larger than the ceiling answers 413 in the component's words, and one at it answers 200", async () => {
	const unbounded = await exportOf(
		counting({ libraryCeiling: null }, SMALL()),
		COUNTED,
	);
	assert.equal(unbounded.status, 200);
	const size = unbounded.body.length;

	const at = await exportOf(
		counting({ libraryCeiling: size }, SMALL()),
		COUNTED,
	);
	assert.equal(at.status, 200);

	for (const [coding, headers] of Object.entries({
		identity: IDENTITY,
		gzip: GZIP,
	})) {
		const over = await exportOf(
			counting({ libraryCeiling: size - 1 }, SMALL()),
			COUNTED,
			headers,
		);
		assert.equal(over.status, 413, `offered ${coding}`);
		assert.deepEqual(jsonOf(over), LIBRARY_TOO_LARGE);
	}
});

test("a delta larger than the ceiling answers 413 in the component's words, and one at it answers 200", async () => {
	const playedAt = async (libraryCeiling: number | null) => {
		const state = declared({ libraryCeiling });
		const held = await heldOf(state);
		state.countPlay(state.libraryTracks[3]);
		return changesOf(state, held);
	};

	const unbounded = await playedAt(null);
	assert.equal(unbounded.status, 200);
	const size = unbounded.body.length;

	assert.equal((await playedAt(size)).status, 200);

	const over = await playedAt(size - 1);
	assert.equal(over.status, 413);
	assert.deepEqual(jsonOf(over), LIBRARY_TOO_LARGE);
});

test("by default the fake refuses above the component's ceiling", () => {
	assert.equal(
		createState({ fooJean: {} }).fooJean.libraryCeiling,
		COMPONENT_CEILING,
	);
});

// `library.cpp` answers a client as long as the oldest revision it retains is the one right
// after the client's, so a client exactly the window behind still gets a delta.
test("a client as many revisions behind as the component retains gets a delta, and one more is 410", async () => {
	assert.ok(Number.isSafeInteger(COMPONENT_RETAINED) && COMPONENT_RETAINED > 0);
	const state = declared({});
	const held = await heldOf(state);
	const played = state.libraryTracks[3];

	for (let play = 0; play < COMPONENT_RETAINED; play += 1)
		state.countPlay(played);
	assert.equal(
		(await heldOf(state)).revision,
		held.revision + COMPONENT_RETAINED,
	);
	assert.equal((await changesOf(state, held)).status, 200);

	state.countPlay(played);
	assert.equal((await changesOf(state, held)).status, 410);
	const oneLater = { ...held, revision: held.revision + 1 };
	assert.equal((await changesOf(state, oneLater)).status, 200);
});
