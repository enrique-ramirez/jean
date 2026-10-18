import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { handleControl } from "../fake-api/routes.ts";
import { createState } from "../fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;
type OrdinalSet = components["schemas"]["OrdinalSet"];
type Runs = components["schemas"]["Runs"];

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = resolve(HERE, "../..");
const REPOSITORY = resolve(UI, "..");

const fakeQuestions = (() => {
	let loaded: Promise<typeof import("../fake-api/fooJean/libraryQuestions.ts")>;
	return () => {
		loaded ??= import("../fake-api/fooJean/libraryQuestions.ts");
		return loaded;
	};
})();

type Question =
	| { kind: "album"; name: string; by?: string }
	| { kind: "artist"; name: string; splitsCredits: boolean }
	| { kind: "genre"; name: string }
	| {
			kind: "search";
			query: string;
			limit: number;
			entityLimit: number;
			splitsCredits: boolean;
	  };

type Kind = Question["kind"];

interface QuestionCase {
	name: string;
	structure: number;
	revision: number;
	directory: string[];
	filename: string[];
	subsong: string[];
	columns: Record<string, string[]>;
	question: Question;
	expected: Record<string, unknown>;
}

const CONFORMANCE: { cases: QuestionCase[] } = JSON.parse(
	readFileSync(
		join(
			REPOSITORY,
			"plugins/fb2k/tests/fixtures/library_questions_cases.json",
		),
		"utf8",
	),
);

const SETS: Record<Kind, readonly string[]> = {
	album: ["refs"],
	artist: ["own", "shared", "guest"],
	genre: ["refs"],
	search: ["matched"],
};

// A number crosses the wire as JSON, where an absent field and an undefined one are the same absence.
const asSent = (document: unknown) => JSON.parse(JSON.stringify(document));

const maximalRuns = (ordinals: readonly number[]): Runs => {
	const runs: Runs = [];
	for (const ordinal of ordinals) {
		const last = runs[runs.length - 1];
		if (last && ordinal === last[0] + last[1]) last[1] += 1;
		else runs.push([ordinal, 1]);
	}
	return runs;
};

const bitsetBudget = (trackCount: number) =>
	4 * Math.ceil(Math.ceil(trackCount / 8) / 3);

const ordinalsOf = (set: OrdinalSet, trackCount: number, what: string) => {
	const keys = Object.keys(set ?? {});
	if (keys.length === 1 && "runs" in set)
		return set.runs.flatMap(([start, count]) =>
			Array.from({ length: count }, (_, at) => start + at),
		);
	if (keys.length === 1 && "bitset" in set) {
		const bytes = Buffer.from(set.bitset, "base64");
		assert.equal(
			bytes.length,
			Math.ceil(trackCount / 8),
			`${what}'s bitset is not one bit a track`,
		);
		const ordinals: number[] = [];
		for (let ordinal = 0; ordinal < bytes.length * 8; ordinal += 1)
			if (bytes[ordinal >> 3] & (1 << (ordinal & 7))) ordinals.push(ordinal);
		return ordinals;
	}
	return assert.fail(
		`${what} is not exactly one of runs and bitset: ${JSON.stringify(set)}`,
	);
};

const shorterFormOf = (
	ordinals: readonly number[],
	trackCount: number,
): OrdinalSet => {
	const runs = maximalRuns(ordinals);
	if (runs.length === 0) return { runs };
	if (JSON.stringify(runs).length <= bitsetBudget(trackCount)) return { runs };
	const bytes = new Uint8Array(Math.ceil(trackCount / 8));
	for (const ordinal of ordinals) bytes[ordinal >> 3] |= 1 << (ordinal & 7);
	return { bitset: Buffer.from(bytes).toString("base64") };
};

const assertAnswers = (
	document: unknown,
	kind: Kind,
	trackCount: number,
	expected: Record<string, unknown>,
) => {
	const sent = asSent(document);
	const decoded = { ...sent };
	for (const key of SETS[kind])
		if (expected[key] !== null)
			decoded[key] = ordinalsOf(sent[key], trackCount, key);
	assert.deepEqual(decoded, expected);
	for (const key of SETS[kind])
		if (expected[key] !== null)
			assert.deepEqual(
				sent[key],
				shorterFormOf(expected[key] as number[], trackCount),
				`${key} is not sent in the shorter form`,
			);
};

for (const questionCase of CONFORMANCE.cases) {
	const { kind } = questionCase.question;
	test(`the fake answers conformance case ${questionCase.name} as foo_jean must`, async () => {
		const { answerQuestion } = await fakeQuestions();
		const {
			structure,
			revision,
			directory,
			filename,
			subsong,
			columns,
			question,
		} = questionCase;
		const document = answerQuestion(
			{ structure, revision, directory, filename, subsong, columns },
			question,
		);
		assertAnswers(document, kind, directory.length, questionCase.expected);
	});
}

test("the conformance file holds search, album, artist and genre cases for the fake to answer", () => {
	const kinds = new Set(CONFORMANCE.cases.map((one) => one.question.kind));
	for (const kind of Object.keys(SETS))
		assert.ok(kinds.has(kind as Kind), kind);
});

test("a set whose runs are exactly as long as its bitset is sent as runs", async () => {
	const { answerQuestion } = await fakeQuestions();
	const tracks = 40;
	const genre = Array.from({ length: tracks }, (_, at) =>
		at === 10 ? "Tie" : "Other",
	);
	assert.equal(JSON.stringify([[10, 1]]).length, bitsetBudget(tracks));

	const document = answerQuestion(
		{
			structure: 1,
			revision: 1,
			directory: genre.map(() => "Tie/"),
			filename: genre.map((_, at) => `${at}.flac`),
			subsong: genre.map(() => "0"),
			columns: { genre },
		},
		{ kind: "genre", name: "Tie" },
	);

	assert.deepEqual(asSent(document).refs, { runs: [[10, 1]] });
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

const questionReads = () => {
	const burst = Number(componentConstant("kLibraryQuestionBurst"));
	const refill = /^std::chrono::milliseconds\((\d+)\)$/.exec(
		componentConstant("kLibraryQuestionRefill"),
	);
	assert.ok(Number.isSafeInteger(burst) && burst > 0);
	assert.ok(refill, "kLibraryQuestionRefill is not a count of milliseconds");
	return { burst, refillMs: Number(refill[1]) };
};

const NO_LIBRARY = (() => {
	const said = /constexpr\s+char\s+kNoLibrary\[\]\s*=\s*"([^"]*)";/.exec(
		readFileSync(join(REPOSITORY, "plugins/fb2k/src/core/failures.h"), "utf8"),
	);
	assert.ok(said, "failures.h declares no kNoLibrary");
	return said[1];
})();

test("the fake's question bucket is sized as foo_jean's", () => {
	const buckets: Record<string, unknown> = COMPONENT_RATE_LIMITS;
	assert.deepEqual(buckets.libraryQuestions, questionReads());
});

interface Answer {
	status: number;
	headers: Record<string, string>;
	bytes: Uint8Array[];
	answered: boolean;
	dropped: boolean;
}

const responderFor = (answer: Answer): Responder => {
	const take = (headers: Record<string, string> = {}) => {
		for (const [name, value] of Object.entries(headers))
			answer.headers[name.toLowerCase()] = String(value);
	};
	const keep = (chunk: string | Uint8Array) =>
		answer.bytes.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	return {
		writeHead(code, headers) {
			answer.status = code;
			take(headers);
		},
		setHeader(name, value) {
			take({ [name]: value });
		},
		write(chunk) {
			keep(chunk);
		},
		end(chunk) {
			if (chunk !== undefined) keep(chunk);
			answer.answered = true;
		},
		on() {},
		destroy() {
			answer.dropped = true;
		},
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
	const answer: Answer = {
		status: 0,
		headers: {},
		bytes: [],
		answered: false,
		dropped: false,
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
	query: [string, string][] = [],
	headers: Record<string, string> = {},
) => send(state, path, query, headers).done;

const rawOf = (answer: Answer) => Buffer.concat(answer.bytes);

const bodyOf = (answer: Answer) => JSON.parse(rawOf(answer).toString("utf8"));

const control = (state: FakeState, action: string, body: object) => {
	const answer: Answer = {
		status: 0,
		headers: {},
		bytes: [],
		answered: false,
		dropped: false,
	};
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

const MISSING_FIELD = "%no such field%";

const QUESTION_ONLY_ROLES = [
	"artists",
	"artistIds",
	"albumArtists",
	"albumArtistIds",
	"artistSort",
];

const ROLES: [string, string][] = (
	Object.entries(FIELD) as [string, number][]
).map(([role, at]) => [role, TRACK_EXPRESSIONS[at]]);

const withRole = (role: string, expression: string): [string, string][] => [
	...ROLES.filter(([name]) => name !== role),
	[role, expression],
];

const withoutRole = (role: string) => ROLES.filter(([name]) => name !== role);

const ALBUM = "/api/library/album";
const ARTIST = "/api/library/artist";
const GENRE = "/api/library/genre";
const SEARCH = "/api/library/search";
const SUMMARY = "/api/library/summary";

const JESSICO: [string, string][] = [
	["name", "Jessico"],
	["by", "Babasónicos"],
	...ROLES,
];
const BABASONICOS: [string, string][] = [
	["name", "Babasónicos"],
	["splitsCredits", "true"],
	...ROLES,
];
const GRUNGE: [string, string][] = [["name", "Grunge"], ...ROLES];
const BABAS: [string, string][] = [
	["query", "babas"],
	["limit", "8"],
	["entityLimit", "3"],
	["splitsCredits", "true"],
	...ROLES,
];

const QUESTIONS: [string, [string, string][]][] = [
	[ALBUM, JESSICO],
	[ARTIST, BABASONICOS],
	[GENRE, GRUNGE],
	[SEARCH, BABAS],
];

const fresh = (fooJean: FooJeanOptions = {}) => createState({ fooJean });

const declared = (fooJean: FooJeanOptions = {}) => {
	const state = fresh(fooJean);
	state.startLibraryBuild([...TRACK_EXPRESSIONS, MISSING_FIELD]);
	state.finishLibraryBuild();
	return state;
};

const libraryOf = async (state: FakeState) =>
	bodyOf(await ask(state, "/api/state")).library;

const NOON = Date.UTC(2026, 9, 16, 12, 0, 0);
const DAY = 24 * 60 * 60_000;

const frozenAt = (t: TestContext) =>
	t.mock.timers.enable({ apis: ["Date"], now: NOON });

const ROUTE_OF: Record<Kind, string> = {
	album: ALBUM,
	artist: ARTIST,
	genre: GENRE,
	search: SEARCH,
};

const questionQuery = (question: Question): [string, string][] => {
	switch (question.kind) {
		case "album":
			return question.by === undefined
				? [["name", question.name]]
				: [
						["name", question.name],
						["by", question.by],
					];
		case "artist":
			return [
				["name", question.name],
				["splitsCredits", String(question.splitsCredits)],
			];
		case "genre":
			return [["name", question.name]];
		case "search":
			return [
				["query", question.query],
				["limit", String(question.limit)],
				["entityLimit", String(question.entityLimit)],
				["splitsCredits", String(question.splitsCredits)],
			];
	}
};

const tracksOfCase = (one: QuestionCase) =>
	one.directory.map((_, at) => ({
		"%path%": `C:\\Music\\Case\\${String(at).padStart(4, "0")}.flac`,
		...Object.fromEntries(
			ROLES.map(([role, expression]) => [
				expression,
				one.columns[role]?.[at] ?? "?",
			]),
		),
	}));

interface Covered {
	cover: string | null;
}

const coversAsHeld = (
	one: QuestionCase,
	state: FakeState,
): Record<string, unknown> => {
	if (one.question.kind !== "search") return one.expected;
	const named = one.directory.map(
		(directory, at) => directory + one.filename[at],
	);
	const held = state.ordinalOrder().map((entry) => entry.path);
	const asHeld = ({ cover }: Covered) => {
		if (cover === null) return null;
		const ordinal = named.indexOf(cover);
		assert.ok(ordinal >= 0, `the case names no track at ${cover}`);
		return held[ordinal];
	};
	const section = (key: "artists" | "albums") => {
		const { total, top } = one.expected[key] as {
			total: number;
			top: Covered[];
		};
		return {
			total,
			top: top.map((entity) => ({ ...entity, cover: asHeld(entity) })),
		};
	};
	return {
		...one.expected,
		artists: section("artists"),
		albums: section("albums"),
	};
};

for (const questionCase of CONFORMANCE.cases)
	test(`the fake's route answers conformance case ${questionCase.name} from a library holding its columns`, async (t) => {
		frozenAt(t);
		const state = createState({ mediaLibrary: tracksOfCase(questionCase) });
		state.startLibraryBuild([...TRACK_EXPRESSIONS]);
		state.finishLibraryBuild();
		const held = await libraryOf(state);
		const { question } = questionCase;

		const answer = await ask(state, ROUTE_OF[question.kind], [
			...questionQuery(question),
			...ROLES,
		]);

		assert.equal(answer.status, 200);
		assertAnswers(
			bodyOf(answer),
			question.kind,
			questionCase.directory.length,
			{
				...coversAsHeld(questionCase, state),
				structure: held.structure,
				revision: held.revision,
			},
		);
	});

// Built by hand, since the conformance file freezes what the page did before: an album no track
// credits is not the album whose only credit is blank.
const UNCREDITED: QuestionCase = {
	name: "an uncredited album beside a blank credit",
	structure: 1,
	revision: 1,
	directory: ["Demo/", "Demo/", "Other/"],
	filename: ["01.flac", "02.flac", "01.flac"],
	subsong: ["0", "0", "0"],
	columns: {
		title: ["One", "Two", "Three"],
		album: ["Untitled Demo", "Untitled Demo", "Other Record"],
		artist: ["?", "?", " "],
		albumArtist: ["?", "?", " "],
	},
	question: { kind: "album", name: "Untitled Demo" },
	expected: {},
};

const UNCREDITED_ALBUMS: [string, Question, Record<string, unknown>][] = [
	[
		"an album no track credits, asked with by absent, holds its uncredited tracks",
		{ kind: "album", name: "Untitled Demo" },
		{ refs: [0, 1], album: "Untitled Demo", artist: null },
	],
	[
		"an album credited only to blank text, asked by that blank, holds its track",
		{ kind: "album", name: "Other Record", by: " " },
		{ refs: [2] },
	],
];

const albumAnswerOf = (document: unknown, trackCount: number) => {
	const sent = asSent(document);
	return { ...sent, refs: ordinalsOf(sent.refs, trackCount, "refs") };
};

const matching = (answer: Record<string, unknown>, expected: object) =>
	Object.fromEntries(Object.keys(expected).map((key) => [key, answer[key]]));

for (const [title, question, expected] of UNCREDITED_ALBUMS) {
	test(`${title}, in the fake's module`, async () => {
		const { answerQuestion } = await fakeQuestions();
		const { structure, revision, directory, filename, subsong, columns } =
			UNCREDITED;
		const answer = albumAnswerOf(
			answerQuestion(
				{ structure, revision, directory, filename, subsong, columns },
				question,
			),
			directory.length,
		);
		assert.deepEqual(matching(answer, expected), expected);
	});

	test(`${title}, through the fake's route`, async (t) => {
		frozenAt(t);
		const state = createState({ mediaLibrary: tracksOfCase(UNCREDITED) });
		state.startLibraryBuild([...TRACK_EXPRESSIONS]);
		state.finishLibraryBuild();

		const response = await ask(state, ALBUM, [
			...questionQuery(question),
			...ROLES,
		]);

		assert.equal(response.status, 200);
		const answer = albumAnswerOf(bodyOf(response), UNCREDITED.directory.length);
		assert.deepEqual(matching(answer, expected), expected);
	});
}

test("a question carries the pair the fake holds once a play has moved its revision", async (t) => {
	frozenAt(t);
	const state = createState({ countsPlays: true });
	state.startLibraryBuild([...TRACK_EXPRESSIONS]);
	state.finishLibraryBuild();
	const before = await libraryOf(state);
	state.countPlay(state.libraryTracks[3]);
	const held = await libraryOf(state);
	assert.equal(held.revision, before.revision + 1);

	for (const [route, query] of QUESTIONS) {
		const document = bodyOf(await ask(state, route, query));
		assert.equal(document.structure, held.structure, route);
		assert.equal(document.revision, held.revision, route);
	}
});

test("each question answers 200 JSON, private, no-cache and with no ETag", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [route, query] of QUESTIONS) {
		const answer = await ask(state, route, query);
		assert.equal(answer.status, 200, route);
		assert.match(answer.headers["content-type"] ?? "", /^application\/json/);
		assert.equal(answer.headers["cache-control"], "private, no-cache", route);
		assert.equal(answer.headers.etag, undefined, route);
	}
});

test("a question offering gzip is answered gzipped, holding the same document", async (t) => {
	frozenAt(t);
	const state = declared();
	const plain = await ask(state, ALBUM, JESSICO);
	const zipped = await ask(state, ALBUM, JESSICO, {
		"accept-encoding": "gzip",
	});

	assert.equal(zipped.status, 200);
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.deepEqual(
		JSON.parse(gunzipSync(rawOf(zipped)).toString("utf8")),
		bodyOf(plain),
	);
});

test("a role left out reads as unresolved on every track, as one naming an expression that resolves to nothing does", async (t) => {
	frozenAt(t);
	const state = declared();
	const named = bodyOf(await ask(state, GENRE, GRUNGE));
	const unresolved = bodyOf(
		await ask(state, GENRE, [
			["name", "Grunge"],
			...withRole("genre", MISSING_FIELD),
		]),
	);
	const leftOut = bodyOf(
		await ask(state, GENRE, [["name", "Grunge"], ...withoutRole("genre")]),
	);

	assert.notDeepEqual(unresolved, named);
	assert.deepEqual(leftOut, unresolved);
});

const refusalOf = async (
	state: FakeState,
	route: string,
	query: [string, string][],
) => {
	const answer = await ask(state, route, query);
	return { status: answer.status, body: bodyOf(answer) };
};

const notARole = (name: string) => ({
	status: 400,
	body: { error: "unacceptable role", detail: `'${name}' is not a role` },
});

test("a question naming a parameter that is neither a role nor its own is 400 naming it", async (t) => {
	frozenAt(t);
	const state = declared();
	const cases: [string, string, [string, string][], string][] = [
		["an unknown role", ALBUM, [...JESSICO, ["colour", "%genre%"]], "colour"],
		["by on the artist route", ARTIST, [...BABASONICOS, ["by", "x"]], "by"],
		["by on the genre route", GENRE, [...GRUNGE, ["by", "x"]], "by"],
		[
			"splitsCredits on the genre route",
			GENRE,
			[...GRUNGE, ["splitsCredits", "true"]],
			"splitsCredits",
		],
		[
			"splitsCredits on the album route",
			ALBUM,
			[...JESSICO, ["splitsCredits", "true"]],
			"splitsCredits",
		],
		[
			"search's query on the album route",
			ALBUM,
			[...JESSICO, ["query", "a"]],
			"query",
		],
		["name on the search route", SEARCH, [...BABAS, ["name", "x"]], "name"],
		["by on the search route", SEARCH, [...BABAS, ["by", "x"]], "by"],
	];
	for (const [what, route, query, named] of cases)
		assert.deepEqual(
			await refusalOf(state, route, query),
			notARole(named),
			what,
		);
});

test("a question naming a role with an empty expression is 400 as the summary words it", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [route, query] of QUESTIONS)
		assert.deepEqual(
			await refusalOf(
				state,
				route,
				query.map(([name, value]) => [name, name === "album" ? "" : value]),
			),
			{
				status: 400,
				body: {
					error: "unacceptable role",
					detail: "role 'album' must be printable text of 1 to 1024 characters",
				},
			},
			route,
		);
});

// cpp-httplib drops a query pair whose raw text repeats an earlier one before foo_jean reads
// it, so a parameter named twice reaches the component only with two values.
test("a question naming one role twice in two spellings is 400 duplicate role", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [route, query] of QUESTIONS)
		assert.deepEqual(
			await refusalOf(state, route, [...query, ["album", "%title%"]]),
			{
				status: 400,
				body: {
					error: "duplicate role",
					detail: "role 'album' is named twice",
				},
			},
			route,
		);
});

test("a question missing a parameter it requires is 400 naming it", async (t) => {
	frozenAt(t);
	const state = declared();
	const cases: [string, [string, string][], string][] = [
		[ALBUM, [["by", "Babasónicos"], ...ROLES], "name"],
		[ARTIST, [["splitsCredits", "true"], ...ROLES], "name"],
		[ARTIST, [["name", "Babasónicos"], ...ROLES], "splitsCredits"],
		[GENRE, ROLES, "name"],
		...["query", "limit", "entityLimit", "splitsCredits"].map(
			(missing): [string, [string, string][], string] => [
				SEARCH,
				BABAS.filter(([name]) => name !== missing),
				missing,
			],
		),
	];
	for (const [route, query, missing] of cases)
		assert.deepEqual(
			await refusalOf(state, route, query),
			{
				status: 400,
				body: {
					error: "unacceptable question",
					detail: `'${missing}' is required`,
				},
			},
			`${route} without ${missing}`,
		);
});

test("an artist or a search asked with splitsCredits neither true nor false is 400", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [route, query] of [
		[ARTIST, BABASONICOS],
		[SEARCH, BABAS],
	] as const)
		for (const flag of ["yes", "TRUE", "1"])
			assert.deepEqual(
				await refusalOf(
					state,
					route,
					query.map(([name, value]) => [
						name,
						name === "splitsCredits" ? flag : value,
					]),
				),
				{
					status: 400,
					body: {
						error: "unacceptable question",
						detail: "'splitsCredits' must be true or false",
					},
				},
				`${route} ${flag}`,
			);
});

const withQuestion = (name: string, value: string): [string, string][] =>
	BABAS.map(([asked, held]) => [asked, asked === name ? value : held]);

// 512 two-byte characters: a limit counted in characters or UTF-16 units admits one more.
const KILOBYTE_OF_ACCENTS = "é".repeat(512);

test("a search's query is answered up to 1024 bytes of UTF-8 and refused 400 past them", async (t) => {
	frozenAt(t);
	const state = declared();
	assert.equal(new TextEncoder().encode(KILOBYTE_OF_ACCENTS).length, 1024);

	assert.equal(
		(await ask(state, SEARCH, withQuestion("query", KILOBYTE_OF_ACCENTS)))
			.status,
		200,
	);
	assert.deepEqual(
		await refusalOf(
			state,
			SEARCH,
			withQuestion("query", `${KILOBYTE_OF_ACCENTS}a`),
		),
		{
			status: 400,
			body: {
				error: "unacceptable question",
				detail: "'query' must be at most 1024 bytes",
			},
		},
	);
});

test("a search's limit or entityLimit that is not a whole number of 0 or more is 400 naming it", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const name of ["limit", "entityLimit"]) {
		assert.equal(
			(await ask(state, SEARCH, withQuestion(name, "0"))).status,
			200,
			`${name} 0`,
		);
		for (const count of ["-1", "1.5", "x"])
			assert.deepEqual(
				await refusalOf(state, SEARCH, withQuestion(name, count)),
				{
					status: 400,
					body: {
						error: "unacceptable question",
						detail: `'${name}' must be a whole number of 0 or more`,
					},
				},
				`${name} ${count}`,
			);
	}
});

test("a question naming one of its own parameters twice is 400 duplicate question", async (t) => {
	frozenAt(t);
	const state = declared();
	const cases: [string, [string, string][], string][] = [
		[ALBUM, [...JESSICO, ["name", "Other"]], "name"],
		[ALBUM, [...JESSICO, ["by", "Other"]], "by"],
		[ARTIST, [...BABASONICOS, ["splitsCredits", "false"]], "splitsCredits"],
		[GENRE, [...GRUNGE, ["name", "Other"]], "name"],
		[SEARCH, [...BABAS, ["query", "other"]], "query"],
		[SEARCH, [...BABAS, ["limit", "9"]], "limit"],
	];
	for (const [route, query, twice] of cases)
		assert.deepEqual(
			await refusalOf(state, route, query),
			{
				status: 400,
				body: {
					error: "duplicate question",
					detail: `'${twice}' is named twice`,
				},
			},
			`${route} with ${twice} twice`,
		);
});

test("the summary still refuses each credit role, which only the questions take", async (t) => {
	frozenAt(t);
	const state = declared();
	const summaryRoles = ROLES.filter(
		([role]) => !QUESTION_ONLY_ROLES.includes(role),
	);
	for (const credit of QUESTION_ONLY_ROLES)
		assert.deepEqual(
			await refusalOf(state, SUMMARY, [
				...summaryRoles,
				[credit, TRACK_EXPRESSIONS[FIELD[credit as keyof typeof FIELD]]],
			]),
			notARole(credit),
			credit,
		);
});

test("a question naming an expression the declaration does not hold is 409 naming it", async (t) => {
	frozenAt(t);
	const state = declared();
	for (const [route, query] of QUESTIONS) {
		const answer = await ask(
			state,
			route,
			query.map(([name, value]) => [
				name,
				name === "album" ? "%nothing%" : value,
			]),
		);
		assert.equal(answer.status, 409, route);
		assert.deepEqual(
			bodyOf(answer),
			{ error: "'%nothing%' is not a declared column" },
			route,
		);
	}
});

test("a question before any snapshot is built is 202 carrying the library GET /api/state carries, and starts no build", async (t) => {
	frozenAt(t);
	const state = fresh();
	const before = await libraryOf(state);

	for (const [route, query] of QUESTIONS) {
		const answer = await ask(state, route, query);
		assert.equal(answer.status, 202, route);
		assert.deepEqual(bodyOf(answer), before, route);
	}
	assert.deepEqual(await libraryOf(state), before);
});

test("a question from a component serving no media library is 503 in foo_jean's words", async (t) => {
	frozenAt(t);
	const state = declared({ canReadLibrary: false });
	for (const [route, query] of QUESTIONS) {
		const answer = await ask(state, route, query);
		assert.equal(answer.status, 503, route);
		assert.equal(bodyOf(answer).error, NO_LIBRARY, route);
	}
});

test("a library whose export is over the ceiling is still answered", async (t) => {
	frozenAt(t);
	const state = declared({ libraryCeiling: 1 });
	const exported = await ask(
		state,
		"/api/library/export",
		TRACK_EXPRESSIONS.map((column) => ["columns", column]),
	);
	assert.equal(exported.status, 413);

	for (const [route, query] of QUESTIONS)
		assert.equal((await ask(state, route, query)).status, 200, route);
});

test("the question bucket answers a burst of its depth across the four routes and refuses the next 429 with Retry-After", async (t) => {
	frozenAt(t);
	const buckets: Record<string, { burst: number } | undefined> =
		COMPONENT_RATE_LIMITS;
	const depth = buckets.libraryQuestions?.burst;
	assert.ok(
		depth !== undefined,
		"COMPONENT_RATE_LIMITS has no libraryQuestions",
	);
	const state = declared({ rateLimits: COMPONENT_RATE_LIMITS });

	for (let request = 0; request < depth; request += 1) {
		const [route, query] = QUESTIONS[request % QUESTIONS.length];
		assert.equal(
			(await ask(state, route, query)).status,
			200,
			`request ${request + 1}, ${route}`,
		);
	}

	for (const [route, query] of QUESTIONS) {
		const refused = await ask(state, route, query);
		assert.equal(refused.status, 429, route);
		assert.deepEqual(bodyOf(refused), { error: "too many library questions" });
		assert.match(refused.headers["retry-after"] ?? "", /^[1-9]\d*$/);
	}
});

const ONE_QUESTION = {
	rateLimits: { libraryQuestions: { burst: 1, refillMs: DAY } },
} as FooJeanOptions;

test("the question bucket is the summary's no more than the summary's is its", async (t) => {
	frozenAt(t);
	const state = declared({
		rateLimits: {
			libraryQuestions: { burst: 1, refillMs: DAY },
			librarySummaries: { burst: 1, refillMs: DAY },
		},
	} as FooJeanOptions);
	const summaryRoles = ROLES.filter(
		([role]) => !QUESTION_ONLY_ROLES.includes(role),
	);

	assert.equal((await ask(state, GENRE, GRUNGE)).status, 200);
	assert.equal((await ask(state, SUMMARY, summaryRoles)).status, 200);
	assert.equal((await ask(state, GENRE, GRUNGE)).status, 429);
});

test("a question refused for what it asks is 400 whether or not the bucket is spent, and spends nothing", async (t) => {
	frozenAt(t);
	const state = declared(ONE_QUESTION);
	const unknownRole: [string, string][] = [...GRUNGE, ["colour", "%genre%"]];

	assert.equal((await ask(state, GENRE, unknownRole)).status, 400);
	assert.equal((await ask(state, ALBUM, JESSICO)).status, 200);
	assert.equal((await ask(state, GENRE, unknownRole)).status, 400);
	assert.equal((await ask(state, ARTIST, BABASONICOS)).status, 429);
});

test("a question is refused 400 before 503, 503 before 429, and 429 before 202", async (t) => {
	frozenAt(t);
	const state = declared({ ...ONE_QUESTION, canReadLibrary: false });
	assert.equal(
		(await ask(state, GENRE, [...GRUNGE, ["colour", "%genre%"]])).status,
		400,
	);

	state.fooJean.canReadLibrary = true;
	assert.equal((await ask(state, GENRE, GRUNGE)).status, 200);
	state.fooJean.canReadLibrary = false;
	assert.equal((await ask(state, GENRE, GRUNGE)).status, 503);

	const unbuilt = fresh(ONE_QUESTION);
	assert.equal((await ask(unbuilt, GENRE, GRUNGE)).status, 202);
	assert.equal((await ask(unbuilt, GENRE, GRUNGE)).status, 429);
});

test("holdQuestions keeps every question unanswered until POST /__control/holdQuestions releases them", async (t) => {
	frozenAt(t);
	const state = declared({ holdQuestions: true } as FooJeanOptions);

	const held = QUESTIONS.map(([route, query]) => send(state, route, query));
	await settled();
	await settled();
	for (const { answer } of held) {
		assert.equal(answer.answered, false);
		assert.equal(answer.status, 0);
	}

	assert.equal(control(state, "holdQuestions", {}).status, 204);
	await settled();
	for (const { answer } of held) assert.equal(answer.status, 200);

	const next = send(state, GENRE, GRUNGE);
	await settled();
	assert.equal(next.answer.status, 200);
});

test("POST /__control/holdQuestions with hold true holds the questions that follow", async (t) => {
	frozenAt(t);
	const state = declared();
	assert.equal(control(state, "holdQuestions", { hold: true }).status, 204);

	const held = send(state, ALBUM, JESSICO);
	await settled();
	await settled();
	assert.equal(held.answer.answered, false);

	control(state, "holdQuestions", {});
	await settled();
	assert.equal(held.answer.status, 200);
});

test("failQuestions refuses as many questions as it says with its status, then answers", async (t) => {
	frozenAt(t);
	const state = declared({
		failQuestions: { status: 503, times: 2 },
	} as FooJeanOptions);
	assert.equal((await ask(state, ALBUM, JESSICO)).status, 503);
	assert.equal((await ask(state, ALBUM, JESSICO)).status, 503);
	assert.equal((await ask(state, ALBUM, JESSICO)).status, 200);
});

test("failQuestions refuses a search as it refuses a page", async (t) => {
	frozenAt(t);
	const state = declared({
		failQuestions: { status: 500, times: 1 },
	} as FooJeanOptions);
	assert.equal((await ask(state, SEARCH, BABAS)).status, 500);
	assert.equal((await ask(state, SEARCH, BABAS)).status, 200);
});

test("failQuestions with a dropped connection destroys as many questions unanswered, then answers", async (t) => {
	frozenAt(t);
	const state = declared({
		failQuestions: { status: "drop", times: 1 },
	} as FooJeanOptions);

	const dropped = send(state, ARTIST, BABASONICOS);
	await settled();
	assert.equal(dropped.answer.dropped, true);
	assert.equal(dropped.answer.answered, false);

	assert.equal((await ask(state, ARTIST, BABASONICOS)).status, 200);
});

test("a question waits out the latency its route is given before it is answered", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOON });
	const state = declared({
		routeLatency: { [`GET ${GENRE}`]: { ms: 500 } },
	});

	const late = send(state, GENRE, GRUNGE);
	await settled();
	t.mock.timers.tick(499);
	await settled();
	assert.equal(late.answer.answered, false);

	t.mock.timers.tick(1);
	await late.done;
	await settled();
	assert.equal(late.answer.status, 200);
	assert.equal(late.answer.answered, true);
});
