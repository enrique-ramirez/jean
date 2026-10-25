import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { createState } from "../fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "../../..");
const FIXTURES = join(REPOSITORY, "plugins/fb2k/tests/fixtures");

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

interface QuestionCase {
	name: string;
	directory: string[];
	columns: Record<string, string[]>;
	question: Question;
	expected: Record<string, unknown>;
}

interface Figures {
	albumCount: number;
	trackCount: number;
	seconds: number;
	earliestYear: number | null;
	latestYear: number | null;
}

interface Genre {
	name: string;
	count: number;
	share: number;
}

interface FrozenCards {
	playedShare: number;
	plays: number;
	neverPlayed: number;
	lastPlayed: number | null;
	mostPlayed: { position: number; ordinal: number; plays: number } | null;
	topGenres: Genre[];
}

interface FrozenRecord {
	album: string;
	artist: string | null;
	year: number | null;
	cover: number;
	trackCount: number;
}

type Part = "refs" | "own" | "shared" | "guest" | "all" | "matched";

interface FrozenSet {
	kind: Question["kind"];
	question: Question;
	part: Part;
	figures: Figures;
	cards?: FrozenCards;
	records?: FrozenRecord[];
}

type Measure = "duration" | "year" | "playCount" | "lastPlayed";

interface SetsCase {
	name: string;
	source: string;
	measures: Record<Measure, string[]>;
	genres: {
		name: string;
		count: number;
		albumCount: number;
		artistCount: number;
		covers: number[];
	}[];
	sets: FrozenSet[];
}

const SETS: { zone: string; cases: SetsCase[] } = JSON.parse(
	readFileSync(join(FIXTURES, "library_sets_cases.json"), "utf8"),
);

const QUESTION_CASES = new Map(
	(
		JSON.parse(
			readFileSync(join(FIXTURES, "library_questions_cases.json"), "utf8"),
		) as { cases: QuestionCase[] }
	).cases.map((one) => [one.name, one]),
);

// Node reads `TZ` again whenever it is assigned, so the zone the fixture's play stamps were written
// in holds for every `Date` after this line.
process.env.TZ = SETS.zone;

const ROLES: [string, string][] = (
	Object.entries(FIELD) as [string, number][]
).map(([role, at]) => [role, TRACK_EXPRESSIONS[at]]);

const QUESTION_ONLY_ROLES = [
	"artists",
	"artistIds",
	"albumArtists",
	"albumArtistIds",
	"artistSort",
];

const SUMMARY_ROLES = ROLES.filter(
	([role]) => !QUESTION_ONLY_ROLES.includes(role),
);

const ROUTE_OF: Record<Question["kind"], string> = {
	album: "/api/library/album",
	artist: "/api/library/artist",
	genre: "/api/library/genre",
	search: "/api/library/search",
};

const SUMMARY = "/api/library/summary";

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

interface Answer {
	status: number;
	text: string;
}

const responderFor = (answer: Answer): Responder => {
	const keep = (chunk: string | Uint8Array) => {
		answer.text +=
			typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
	};
	return {
		writeHead(code) {
			answer.status = code;
		},
		setHeader() {},
		write(chunk) {
			keep(chunk);
		},
		end(chunk) {
			if (chunk !== undefined) keep(chunk);
		},
		on() {},
		destroy() {},
	};
};

const ask = async (
	state: FakeState,
	path: string,
	query: [string, string][],
) => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query) url.searchParams.append(name, value);
	const answer: Answer = { status: 0, text: "" };
	await handleFooJean({
		state,
		method: "GET",
		url,
		headers: {},
		body: null,
		response: responderFor(answer),
		artwork: () => false,
	});
	return { status: answer.status, body: JSON.parse(answer.text) };
};

const NOON = Date.UTC(2026, 9, 16, 12, 0, 0);

const frozenAt = (t: TestContext) =>
	t.mock.timers.enable({ apis: ["Date"], now: NOON });

const questionCaseOf = (one: SetsCase) => {
	const source = QUESTION_CASES.get(one.name);
	assert.ok(
		source,
		`${one.name}: ${one.source} holds no case of that name to ask`,
	);
	return source;
};

const columnsOf = (one: SetsCase): Record<string, string[]> => ({
	...questionCaseOf(one).columns,
	...one.measures,
});

const libraryOf = (one: SetsCase) => {
	const columns = columnsOf(one);
	const state = createState({
		mediaLibrary: questionCaseOf(one).directory.map((_, at) => ({
			"%path%": `C:\\Music\\Case\\${String(at).padStart(4, "0")}.flac`,
			...Object.fromEntries(
				ROLES.map(([role, expression]) => [
					expression,
					columns[role]?.[at] ?? "?",
				]),
			),
		})),
	});
	state.startLibraryBuild([...TRACK_EXPRESSIONS]);
	state.finishLibraryBuild();
	const held = state.ordinalOrder().map((entry) => entry.path);
	return { state, columns, pathOf: (ordinal: number) => held[ordinal] };
};

const NO_FIGURES: Figures = {
	albumCount: 0,
	trackCount: 0,
	seconds: 0,
	earliestYear: null,
	latestYear: null,
};

const partsOf = (one: SetsCase) => {
	const parts = new Map<Part, FrozenSet>();
	for (const set of one.sets) {
		assert.ok(
			!parts.has(set.part),
			`${one.name}: the fixture holds ${set.part} twice`,
		);
		assert.deepEqual(
			set.question,
			questionCaseOf(one).question,
			`${one.name}: a set asks another question than its source case`,
		);
		parts.set(set.part, set);
	}
	return parts;
};

const partOf = (one: SetsCase, parts: Map<Part, FrozenSet>, part: Part) => {
	const set = parts.get(part);
	assert.ok(set, `${one.name}: the fixture holds no ${part} set`);
	return set;
};

const wireCards = (cards: FrozenCards | undefined, title: string[]) => {
	assert.ok(cards, "an artist set carries no cards in the fixture");
	const { mostPlayed, ...rest } = cards;
	return {
		...rest,
		mostPlayed: mostPlayed && {
			ordinal: mostPlayed.ordinal,
			title: title[mostPlayed.ordinal],
			plays: mostPlayed.plays,
		},
	};
};

const wireRecords = (
	records: FrozenRecord[] | undefined,
	pathOf: (ordinal: number) => string,
) => {
	assert.ok(records, "an artist set carries no records in the fixture");
	return records.map((record) => ({ ...record, cover: pathOf(record.cover) }));
};

const expectedAnswer = (
	one: SetsCase,
	pathOf: (ordinal: number) => string,
	columns: Record<string, string[]>,
) => {
	const { question } = questionCaseOf(one);
	const parts = partsOf(one);
	if (question.kind !== "artist") {
		const part = question.kind === "search" ? "matched" : "refs";
		assert.deepEqual(
			[...parts.keys()].filter((key) => key !== part),
			[],
			`${one.name}: a ${question.kind} case holds a part this file does not compare`,
		);
		// The fixture holds no set where a search matches nothing; the contract says its figures are
		// all zero and null then.
		if (
			question.kind === "search" &&
			questionCaseOf(one).expected.matched === null
		)
			return { figures: NO_FIGURES };
		return { figures: partOf(one, parts, part).figures };
	}
	// `own`, `shared` and `guest` have no figures or cards of their own on the wire: an artist
	// answer carries those once, over `all`, and records for `own` and `shared` alone.
	const all = partOf(one, parts, "all");
	partOf(one, parts, "guest");
	return {
		figures: all.figures,
		cards: wireCards(all.cards, columns.title ?? []),
		records: {
			own: wireRecords(partOf(one, parts, "own").records, pathOf),
			shared: wireRecords(partOf(one, parts, "shared").records, pathOf),
		},
	};
};

const picked = (body: Record<string, unknown>, expected: object) =>
	Object.fromEntries(Object.keys(expected).map((key) => [key, body[key]]));

for (const setsCase of SETS.cases)
	test(`the fake's ${questionCaseOf(setsCase).question.kind} answer carries the figures foo_jean computes over its set, case ${setsCase.name}`, async (t) => {
		frozenAt(t);
		const { state, columns, pathOf } = libraryOf(setsCase);
		const { question } = questionCaseOf(setsCase);
		const expected = expectedAnswer(setsCase, pathOf, columns);

		const { status, body } = await ask(state, ROUTE_OF[question.kind], [
			...questionQuery(question),
			...ROLES,
		]);

		assert.deepEqual(
			{ status, ...picked(body, expected) },
			{ status: 200, ...expected },
			setsCase.name,
		);
	});

// Every artist in the fixture holds one genre at most, so it cannot see the cut at four or the
// order. The counts run against the names' alphabetical order.
const GENRE_COUNTS: [string, number][] = [
	["Zydeco", 5],
	["Reggae", 4],
	["Metal", 3],
	["Folk", 2],
	["Blues", 1],
];

test("an artist's cards name its four largest genres, largest first, each with its share of the artist's tracks", async (t) => {
	frozenAt(t);
	const genres = GENRE_COUNTS.flatMap(([name, count]) =>
		Array.from({ length: count }, () => name),
	);
	const expression = (role: string) =>
		TRACK_EXPRESSIONS[FIELD[role as keyof typeof FIELD]];
	const state = createState({
		mediaLibrary: genres.map((genre, at) => ({
			"%path%": `C:\\Music\\Case\\${String(at).padStart(4, "0")}.flac`,
			[expression("title")]: `Track ${at + 1}`,
			[expression("artist")]: "Solo",
			[expression("album")]: "Every Genre",
			[expression("genre")]: genre,
		})),
	});
	state.startLibraryBuild([...TRACK_EXPRESSIONS]);
	state.finishLibraryBuild();

	const { status, body } = await ask(state, ROUTE_OF.artist, [
		["name", "Solo"],
		["splitsCredits", "true"],
		...ROLES,
	]);

	assert.deepEqual(
		{ status, topGenres: body.cards?.topGenres },
		{
			status: 200,
			topGenres: GENRE_COUNTS.slice(0, 4).map(([name, count]) => ({
				name,
				count,
				share: Math.round((count / genres.length) * 100),
			})),
		},
	);
});

for (const setsCase of SETS.cases)
	test(`the fake's summary asked for genres draws every genre with its tracks, albums and artists counted and its tile's covers, case ${setsCase.name}`, async (t) => {
		frozenAt(t);
		const { state, pathOf } = libraryOf(setsCase);

		const { status, body } = await ask(state, SUMMARY, [
			["genres", "true"],
			...SUMMARY_ROLES,
		]);

		assert.deepEqual(
			{ status, genres: body.genres },
			{
				status: 200,
				genres: setsCase.genres.map(
					({ name, count, albumCount, artistCount, covers }) => ({
						name,
						count,
						albumCount,
						artistCount,
						covers: covers.map(pathOf),
					}),
				),
			},
			setsCase.name,
		);
	});

test("the fake's summary carries no genres unless asked for them", async (t) => {
	frozenAt(t);
	for (const setsCase of SETS.cases) {
		const { state } = libraryOf(setsCase);
		for (const asked of [[], [["genres", "false"]]] as [string, string][][]) {
			const { status, body } = await ask(state, SUMMARY, [
				...asked,
				...SUMMARY_ROLES,
			]);
			assert.deepEqual(
				{ status, carriesGenres: "genres" in body },
				{ status: 200, carriesGenres: false },
				`${setsCase.name}, asked ${JSON.stringify(asked)}`,
			);
		}
	}
});

const ABSENT = new Set(["?", "", "N/A"]);

const measured = (raw: string | undefined) => {
	if (raw === undefined || ABSENT.has(raw)) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
};

const figuresByCounting = (
	ordinals: readonly number[],
	albumCount: number,
	columns: Record<string, string[]>,
): Figures => {
	const years = ordinals
		.map((at) => measured(columns.year?.[at]))
		.filter((year): year is number => year !== null && year > 0);
	return {
		albumCount,
		trackCount: ordinals.length,
		seconds: ordinals.reduce(
			(sum, at) => sum + (measured(columns.duration?.[at]) ?? 0),
			0,
		),
		earliestYear: years.length > 0 ? Math.min(...years) : null,
		latestYear: years.length > 0 ? Math.max(...years) : null,
	};
};

test("figures counted over an album's tracks reproduce every album set the fixture froze", () => {
	const albums = SETS.cases.flatMap((one) =>
		one.sets.filter((set) => set.kind === "album").map((set) => ({ one, set })),
	);
	assert.ok(albums.length > 0);
	for (const { one, set } of albums) {
		const refs = questionCaseOf(one).expected.refs as number[];
		assert.deepEqual(
			figuresByCounting(refs, refs.length > 0 ? 1 : 0, columnsOf(one)),
			set.figures,
			one.name,
		);
	}
});

interface Shelf {
	id: string;
	albums: { ordinals: number[] }[];
	figures?: Figures;
}

test("every shelf of the fake's summary carries figures over its own albums' tracks", async (t) => {
	frozenAt(t);
	let narrowerThanTheLibrary = 0;
	for (const setsCase of SETS.cases) {
		const { state, columns } = libraryOf(setsCase);
		const { status, body } = await ask(state, SUMMARY, SUMMARY_ROLES);
		assert.equal(status, 200, setsCase.name);
		const shelves = body.shelves as Shelf[];
		const expected = shelves.map(({ id, albums }) => ({
			id,
			figures: figuresByCounting(
				albums.flatMap((album) => album.ordinals).sort((a, b) => a - b),
				albums.length,
				columns,
			),
		}));
		narrowerThanTheLibrary += expected.filter(
			({ figures }) => figures.trackCount < body.trackCount,
		).length;

		assert.deepEqual(
			shelves.map(({ id, figures }) => ({ id, figures })),
			expected,
			setsCase.name,
		);
	}
	// A shelf holding every album would pass on the whole library's figures.
	assert.ok(
		narrowerThanTheLibrary > 0,
		"no case's summary holds a shelf narrower than its library",
	);
});
