import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { libraryOfShape } from "../fake-api/libraryShapes.ts";
import { handleControl } from "../fake-api/routes.ts";
import { createState } from "../fake-api/state.ts";
import { summaryFile } from "./caseFiles.ts";

type FakeState = ReturnType<typeof createState>;
type LibrarySummary = components["schemas"]["LibrarySummary"];

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = resolve(HERE, "../..");
const REPOSITORY = resolve(UI, "..");
const SUMMARY_MODULE = join(UI, "test/fake-api/fooJean/librarySummary.ts");

const fakeSummary = (() => {
	let loaded: Promise<typeof import("../fake-api/fooJean/librarySummary.ts")>;
	return () => {
		loaded ??= import("../fake-api/fooJean/librarySummary.ts");
		return loaded;
	};
})();

const CONFORMANCE = summaryFile();

const UTC_PLUS_0530 = 330;

// A number crosses the wire as JSON, where -0 and 0 are one value and an absent field and an
// undefined one are the same absence.
const asSent = (document: unknown) => JSON.parse(JSON.stringify(document));

const asFrozen = (document: LibrarySummary) => ({
	...document,
	shelves: document.shelves.map(({ figures: _, ...shelf }) => shelf),
});

for (const summaryCase of CONFORMANCE.cases)
	test(`the fake summarises conformance case ${summaryCase.name} as foo_jean must`, async () => {
		const { summarise, fixedOffset } = await fakeSummary();
		const { structure, revision, directory, filename, columns, now } =
			summaryCase;
		const document = summarise(
			{ structure, revision, directory, filename, columns },
			now,
			fixedOffset(UTC_PLUS_0530),
		);
		assert.deepEqual(asFrozen(asSent(document)), summaryCase.expected);
	});

test("the fake's tag key matches every conformance key pair as recorded", async () => {
	const { tagKey } = await fakeSummary();
	assert.ok(CONFORMANCE.keys.length > 0);
	for (const { a, b, match } of CONFORMANCE.keys)
		assert.equal(
			tagKey(a) === tagKey(b),
			match,
			`${JSON.stringify(a)} against ${JSON.stringify(b)}`,
		);
});

const specifiersOf = (source: string) =>
	[
		...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
		...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
		...source.matchAll(/\bimport\(\s*["']([^"']+)["']/g),
	].map(([, specifier]) => specifier);

const fileOf = (from: string, specifier: string): string | null => {
	const base = specifier.startsWith("@/")
		? join(UI, "src", specifier.slice(2))
		: specifier.startsWith(".")
			? resolve(dirname(from), specifier)
			: null;
	if (base === null) return null;
	return (
		[base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(
			(candidate) => existsSync(candidate) && !candidate.endsWith("/"),
		) ?? base
	);
};

test("the fake's summary module reaches nothing under src/features/home, directly or through another file", () => {
	const home = join(UI, "src/features/home");
	const seen = new Set<string>();
	const reached: string[] = [];
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
			const target = fileOf(file, specifier);
			if (target === null) continue;
			if (target.startsWith(home) || specifier.includes("features/home"))
				reached.push(`${file} imports ${specifier}`);
			else if (existsSync(target)) walk(target);
		}
	};
	walk(SUMMARY_MODULE);
	assert.deepEqual(reached, []);
});

const routesLibrary = readFileSync(
	join(REPOSITORY, "plugins/fb2k/src/core/routes_library.cpp"),
	"utf8",
);

const componentConstant = (name: string): string => {
	const declared = new Map(
		[
			...routesLibrary.matchAll(
				/constexpr\s+(?:int|auto)\s+(\w+)\s*=\s*([^;]+);/g,
			),
		].map(([, constant, value]) => [constant, value.trim()]),
	);
	const value = declared.get(name);
	assert.ok(value !== undefined, `routes_library.cpp declares no ${name}`);
	return /^k\w+$/.test(value) ? componentConstant(value) : value;
};

const LIBRARY_READS = (() => {
	const burst = Number(componentConstant("kLibraryReadBurst"));
	const refill = /^std::chrono::milliseconds\((\d+)\)$/.exec(
		componentConstant("kLibraryReadRefill"),
	);
	assert.ok(Number.isSafeInteger(burst) && burst > 0);
	assert.ok(refill, "kLibraryReadRefill is not a count of milliseconds");
	return { burst, refillMs: Number(refill[1]) };
})();

const NO_LIBRARY = (() => {
	const said = /constexpr\s+char\s+kNoLibrary\[\]\s*=\s*"([^"]*)";/.exec(
		readFileSync(join(REPOSITORY, "plugins/fb2k/src/core/failures.h"), "utf8"),
	);
	assert.ok(said, "failures.h declares no kNoLibrary");
	return said[1];
})();

const SUMMARY_KEYS = (() => {
	const contract = readFileSync(
		join(REPOSITORY, "contract/openapi.yaml"),
		"utf8",
	);
	// Biome keeps a short flow sequence on the key's line and wraps a long one below it, an item
	// a line with a trailing comma.
	const required =
		/\n {4}LibrarySummary:\n(?: {6}.*\n)*? {6}required:\s*\[([^\]]*)\]/.exec(
			contract,
		);
	assert.ok(required, "contract/openapi.yaml declares no LibrarySummary");
	return required[1]
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key !== "");
})();

interface Answer {
	status: number;
	headers: Record<string, string>;
	text: string;
	answered: boolean;
}

const responderFor = (answer: Answer): Responder => {
	const take = (headers: Record<string, string> = {}) => {
		for (const [name, value] of Object.entries(headers))
			answer.headers[name.toLowerCase()] = String(value);
	};
	return {
		writeHead(code, headers) {
			answer.status = code;
			take(headers);
		},
		setHeader(name, value) {
			take({ [name]: value });
		},
		write(chunk) {
			answer.text +=
				typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		},
		end(chunk) {
			if (chunk !== undefined)
				answer.text +=
					typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			answer.answered = true;
		},
		on() {},
		destroy() {},
	};
};

const send = (
	state: FakeState,
	path: string,
	query: [string, string][] = [],
	headers: Record<string, string> = {},
) => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query) url.searchParams.append(name, value);
	const answer: Answer = { status: 0, headers: {}, text: "", answered: false };
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
	query: [string, string][] = [],
	headers: Record<string, string> = {},
) => send(state, path, query, headers).done;

const bodyOf = (answer: Answer) => JSON.parse(answer.text);

const control = (state: FakeState, action: string, body: object) => {
	const answer: Answer = { status: 0, headers: {}, text: "", answered: false };
	handleControl({
		state,
		method: "POST",
		path: `/__control/${action}`,
		body: body as never,
		response: responderFor(answer),
	});
	return answer;
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

const PLAY_COUNT = "%lastfm_play_count%";
const MISSING_FIELD = "%no such field%";
const DECLARED = [
	"%title%",
	"%album%",
	"%artist%",
	"%album artist%",
	"%length_seconds%",
	"%genre%",
	"%year%",
	PLAY_COUNT,
	MISSING_FIELD,
];

const ROLES: [string, string][] = [
	["title", "%title%"],
	["album", "%album%"],
	["artist", "%artist%"],
	["albumArtist", "%album artist%"],
	["duration", "%length_seconds%"],
	["genre", "%genre%"],
	["year", "%year%"],
	["playCount", PLAY_COUNT],
];

const withRole = (role: string, expression: string): [string, string][] => [
	...ROLES.filter(([name]) => name !== role),
	[role, expression],
];

const withoutRole = (role: string) => ROLES.filter(([name]) => name !== role);

const SUMMARY = "/api/library/summary";
const TRACKS = 40;

const fresh = (fooJean: FooJeanOptions = {}) =>
	createState({
		fooJean,
		countsPlays: true,
		mediaLibrary: libraryOfShape({ tracks: TRACKS, albums: 4, artists: 2 }),
	});

const declared = (fooJean: FooJeanOptions = {}) => {
	const state = fresh(fooJean);
	state.startLibraryBuild(DECLARED);
	state.finishLibraryBuild();
	return state;
};

const libraryOf = async (state: FakeState) =>
	bodyOf(await ask(state, "/api/state")).library;

const NOON = Date.UTC(2026, 9, 16, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const frozenAt = (t: TestContext, now = NOON) =>
	t.mock.timers.enable({ apis: ["Date"], now });

test("the harness answers an existing library route, so a red summary case is the summary's own", async (t) => {
	frozenAt(t);
	const runs = await ask(declared(), "/api/library/runs", ROLES);
	assert.equal(runs.status, 200);
	assert.ok(runs.headers.etag);
});

test("the fake's summary bucket is sized as foo_jean's library reads", () => {
	const buckets: Record<string, unknown> = COMPONENT_RATE_LIMITS;
	assert.deepEqual(buckets.librarySummaries, LIBRARY_READS);
});

test("a summary answers 200 JSON at the held pair with every key the contract requires, private and revalidated", async (t) => {
	frozenAt(t);
	const state = declared();
	const held = await libraryOf(state);

	const answer = await ask(state, SUMMARY, ROLES);

	assert.equal(answer.status, 200);
	assert.match(answer.headers["content-type"] ?? "", /^application\/json/);
	assert.equal(answer.headers["cache-control"], "private, no-cache");
	assert.ok(answer.headers.etag, "no ETag");
	const document = bodyOf(answer);
	assert.deepEqual(Object.keys(document).sort(), [...SUMMARY_KEYS].sort());
	assert.equal(document.structure, held.structure);
	assert.equal(document.revision, held.revision);
	assert.equal(document.trackCount, TRACKS);
});

test("a summary repeated with its ETag is 304, and a minute later on the same date still is", async (t) => {
	frozenAt(t);
	const state = declared();
	const first = await ask(state, SUMMARY, ROLES);
	const tag = first.headers.etag;

	const again = await ask(state, SUMMARY, ROLES);
	assert.equal(again.headers.etag, tag);

	const repeated = await ask(state, SUMMARY, ROLES, { "if-none-match": tag });
	assert.equal(repeated.status, 304);
	assert.equal(repeated.headers.etag, tag);

	t.mock.timers.setTime(NOON + MINUTE);
	const later = await ask(state, SUMMARY, ROLES, { "if-none-match": tag });
	assert.equal(later.status, 304);
});

test("a summary's ETag moves when the library's revision moves, and the document carries the new pair", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await ask(state, SUMMARY, ROLES);

	state.countPlay(state.libraryTracks[3]);
	const held = await libraryOf(state);
	assert.equal(held.revision, bodyOf(before).revision + 1);

	const after = await ask(state, SUMMARY, ROLES, {
		"if-none-match": before.headers.etag,
	});
	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	assert.equal(bodyOf(after).revision, held.revision);
});

test("a summary naming another role set at the same pair and date answers 200 with its own ETag", async (t) => {
	frozenAt(t);
	const state = declared();
	const named = await ask(state, SUMMARY, ROLES);

	const fewer = await ask(state, SUMMARY, withoutRole("genre"), {
		"if-none-match": named.headers.etag,
	});

	assert.equal(fewer.status, 200);
	assert.notEqual(fewer.headers.etag, named.headers.etag);
});

test("a summary's ETag moves when the local date moves at the same pair", async (t) => {
	frozenAt(t);
	const state = declared();
	const today = await ask(state, SUMMARY, ROLES);

	t.mock.timers.setTime(NOON + DAY);
	const tomorrow = await ask(state, SUMMARY, ROLES, {
		"if-none-match": today.headers.etag,
	});

	assert.equal(tomorrow.status, 200);
	assert.notEqual(tomorrow.headers.etag, today.headers.etag);
	assert.equal(bodyOf(tomorrow).revision, bodyOf(today).revision);
});

test("a role left out reads as unresolved on every track, as one naming an expression that resolves to nothing does", async (t) => {
	frozenAt(t);
	const state = declared();
	const named = bodyOf(await ask(state, SUMMARY, ROLES));
	const unresolved = bodyOf(
		await ask(state, SUMMARY, withRole("genre", MISSING_FIELD)),
	);
	const leftOut = bodyOf(await ask(state, SUMMARY, withoutRole("genre")));

	assert.notDeepEqual(unresolved, named);
	assert.deepEqual(leftOut, unresolved);
});

test("a summary naming an unknown role, an empty expression or a control character is 400 unacceptable role", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [what, query] of Object.entries({
		"an unknown role": [...ROLES, ["colour", "%genre%"]],
		"an empty expression": withRole("album", ""),
		"a control character": withRole("album", "%al\u0001bum%"),
	} satisfies Record<string, [string, string][]>)) {
		const answer = await ask(state, SUMMARY, query);
		assert.equal(answer.status, 400, what);
		assert.equal(bodyOf(answer).error, "unacceptable role", what);
	}
});

// cpp-httplib drops a query pair whose raw text repeats an earlier one before foo_jean reads
// it, so a role named twice reaches the component only in two spellings.
test("a summary naming one role twice in two spellings is 400 duplicate role", async (t) => {
	frozenAt(t);
	const state = declared();
	const answer = await ask(state, SUMMARY, [...ROLES, ["album", "%title%"]]);
	assert.equal(answer.status, 400);
	assert.equal(bodyOf(answer).error, "duplicate role");
});

test("a summary naming an expression the declaration does not hold is 409 naming it", async (t) => {
	frozenAt(t);
	const state = declared();
	const answer = await ask(state, SUMMARY, withRole("album", "%nothing%"));
	assert.equal(answer.status, 409);
	assert.equal(bodyOf(answer).error, "'%nothing%' is not a declared column");
});

test("a summary before any snapshot is built is 202 carrying the library GET /api/state carries, and starts no build", async (t) => {
	frozenAt(t);
	const state = fresh();
	const before = await libraryOf(state);

	const answer = await ask(state, SUMMARY, ROLES);

	assert.equal(answer.status, 202);
	const after = await libraryOf(state);
	assert.deepEqual(bodyOf(answer), after);
	assert.deepEqual(after, before);
});

test("a summary from a component serving no media library is 503 in foo_jean's words", async (t) => {
	frozenAt(t);
	const answer = await ask(declared({ canReadLibrary: false }), SUMMARY, ROLES);
	assert.equal(answer.status, 503);
	assert.equal(bodyOf(answer).error, NO_LIBRARY);
});

test("the summary bucket answers a burst of foo_jean's depth and refuses the next 429 with Retry-After", async (t) => {
	frozenAt(t);
	const state = declared({ rateLimits: COMPONENT_RATE_LIMITS });

	for (let request = 1; request <= LIBRARY_READS.burst; request += 1)
		assert.equal(
			(await ask(state, SUMMARY, ROLES)).status,
			200,
			`request ${request}`,
		);

	const refused = await ask(state, SUMMARY, ROLES);
	assert.equal(refused.status, 429);
	assert.deepEqual(bodyOf(refused), {
		error: "too many library summary reads",
	});
	assert.match(refused.headers["retry-after"] ?? "", /^[1-9]\d*$/);
});

const ONE_TOKEN = {
	rateLimits: { librarySummaries: { burst: 1, refillMs: DAY } },
} as FooJeanOptions;

test("a summary refused for what it asks is 400 whether or not the bucket is spent, and spends nothing", async (t) => {
	frozenAt(t);
	const state = declared(ONE_TOKEN);
	const unknownRole: [string, string][] = [...ROLES, ["colour", "%genre%"]];

	assert.equal((await ask(state, SUMMARY, unknownRole)).status, 400);
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 200);
	assert.equal((await ask(state, SUMMARY, unknownRole)).status, 400);
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 429);
});

test("a summary is refused 400 before 503, and 503 before 429", async (t) => {
	frozenAt(t);
	const state = declared({ ...ONE_TOKEN, canReadLibrary: false });
	assert.equal(
		(await ask(state, SUMMARY, [...ROLES, ["colour", "%genre%"]])).status,
		400,
	);

	state.fooJean.canReadLibrary = true;
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 200);
	state.fooJean.canReadLibrary = false;
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 503);
});

test("holdSummary keeps a summary unanswered until POST /__control/holdSummary releases it", async (t) => {
	frozenAt(t);
	const state = declared({ holdSummary: true } as FooJeanOptions);

	const held = send(state, SUMMARY, ROLES);
	await settled();
	await settled();
	assert.equal(held.answer.answered, false);
	assert.equal(held.answer.status, 0);

	assert.equal(control(state, "holdSummary", {}).status, 204);
	await settled();
	assert.equal(held.answer.status, 200);

	const next = send(state, SUMMARY, ROLES);
	await settled();
	assert.equal(next.answer.status, 200);
});

test("failSummary refuses as many summaries as it says with its status, then answers", async (t) => {
	frozenAt(t);
	const state = declared({
		failSummary: { status: 500, times: 1 },
	} as FooJeanOptions);
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 500);
	assert.equal((await ask(state, SUMMARY, ROLES)).status, 200);
});
