import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { createState } from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	type CaseLibrary,
	caseState,
	DAY,
	declared,
	type FakeState,
	failureText,
	fixture,
	frozenAt,
	libraryOf,
	ROLES,
	rawOf,
	refusalOf,
	withFake,
	withRole,
} from "./fakeLibraryHarness.ts";

const VALUES = "/api/library/values";

interface QuestionCase extends CaseLibrary {
	name: string;
}

const QUESTION_CASES = fixture<{ cases: QuestionCase[] }>(
	"library_questions_cases.json",
).cases;

const caseNamed = (name: string) => {
	const found = QUESTION_CASES.find((one) => one.name === name);
	assert.ok(found, `library_questions_cases.json holds no case ${name}`);
	return found;
};

const STROKED_LETTERS = "ascii: search mo for the stroked o";
const SPELLINGS = "spellings: search beyonce";
const UNICODE = "unicode: search sigma alone";
const GENRES = "genres: search rock";
const CREDITS = 'credits: search "alpha" splits true';

const stateOfCase = (name: string) => caseState(caseNamed(name));

const valuesQuery = (
	field: string,
	prefix: string,
	limit = 100,
): [string, string][] => [
	["field", field],
	["prefix", prefix],
	["limit", String(limit)],
	...ROLES,
];

const askValues = (
	state: FakeState,
	query: [string, string][],
	headers: Record<string, string> = {},
) => ask(state, VALUES, { query, headers });

const valuesOf = async (
	state: FakeState,
	field: string,
	prefix: string,
	limit?: number,
) => {
	const answer = await askValues(state, valuesQuery(field, prefix, limit));
	assert.equal(answer.status, 200, rawOf(answer).toString("utf8", 0, 200));
	return bodyOf(answer).values;
};

const COMPOSED_ELECTRO = "Électro";
const DECOMPOSED_ELECTRO = "Électro";

type Completion = [
	library: string,
	field: string,
	prefix: string,
	values: string[],
];

const checkCompletions = async (completions: Completion[]) => {
	for (const [library, field, prefix, values] of completions)
		assert.deepEqual(
			await valuesOf(stateOfCase(library), field, prefix),
			values,
			`${library}, ${field} beginning ${JSON.stringify(prefix)}`,
		);
};

test("an empty prefix answers every value of the field once, in bytewise order", async (t) => {
	frozenAt(t);
	await checkCompletions([
		[
			STROKED_LETTERS,
			"artist",
			"",
			["Branford Marsalis", "Moenia", "MØ", "Mœnia", "Æon Flux", "Łódź"],
		],
		[
			STROKED_LETTERS,
			"album",
			"",
			["Adición", "Mo Better Blues", "Mœnia", "Æ", "Ø", "Łódź"],
		],
		[STROKED_LETTERS, "genre", "", ["Jazz", "Pop", "Rock"]],
	]);
});

// A value no fold changes is a poor witness: each case here needs the fold on the side it names.
// MØ folds to "mo", so no artist begins with "o" though one holds it.
test("a prefix and a value are both folded before one is matched against the other", async (t) => {
	frozenAt(t);
	await checkCompletions([
		[STROKED_LETTERS, "artist", "mo", ["Moenia", "MØ", "Mœnia"]],
		[STROKED_LETTERS, "artist", "mø", ["Moenia", "MØ", "Mœnia"]],
		[STROKED_LETTERS, "artist", "moe", ["Moenia", "Mœnia"]],
		[STROKED_LETTERS, "artist", "MŒ", ["Moenia", "Mœnia"]],
		[STROKED_LETTERS, "artist", "æ", ["Æon Flux"]],
		[STROKED_LETTERS, "artist", "lodz", ["Łódź"]],
		[STROKED_LETTERS, "album", "o", ["Ø"]],
		[STROKED_LETTERS, "artist", "o", []],
		[SPELLINGS, "artist", "bjo", ["Bjork", "Björk"]],
		[SPELLINGS, "artist", "BJÖ", ["Bjork", "Björk"]],
		[SPELLINGS, "album", "ágæ", ["Ágætis byrjun"]],
		[UNICODE, "artist", "straß", ["Strasse", "Straße"]],
		[UNICODE, "album", "ẞ", ["SS", "ẞ"]],
	]);
});

test("each field is completed from its own column", async (t) => {
	frozenAt(t);
	await checkCompletions([
		[CREDITS, "artist", "tv", ["TV On The Radio"]],
		[CREDITS, "albumArtist", "tv", ["TV on the Radio"]],
		[CREDITS, "artist", "l", ["Lambda"]],
		[CREDITS, "albumArtist", "l", []],
		[CREDITS, "album", "l", ["Loose Singles"]],
		[STROKED_LETTERS, "album", "mo", ["Mo Better Blues", "Mœnia"]],
		[STROKED_LETTERS, "genre", "p", ["Pop"]],
	]);
});

test("each genre of a multi-valued tag is a value of its own, offered once however often held", async (t) => {
	frozenAt(t);
	await checkCompletions([
		[GENRES, "genre", "po", ["Pop"]],
		[GENRES, "genre", "ja", ["Jazz"]],
		[GENRES, "genre", "bl", ["Blues"]],
		[GENRES, "genre", "rock,", ["Rock, Pop"]],
		[GENRES, "genre", "é", ["Electro", DECOMPOSED_ELECTRO, COMPOSED_ELECTRO]],
	]);
});

test("a value the player left unresolved, empty or N/A is no value, nor is an empty genre", async (t) => {
	frozenAt(t);
	const state = stateOfCase(GENRES);

	assert.deepEqual(await valuesOf(state, "genre", "n"), []);
	assert.deepEqual(await valuesOf(state, "genre", "?"), []);
	const every: string[] = await valuesOf(state, "genre", "");
	for (const blank of ["", "   ", "?", "N/A"])
		assert.ok(!every.includes(blank), `${JSON.stringify(blank)} is offered`);
});

// Values that differ only in case or spacing are one value, as the client's own tag grouping reads
// them. The library lists the spellings in an order other than bytewise, so a fake naming the
// group after the first track holding it names it wrongly.
test("spellings of one name are offered once, under the bytewise-first of them, and a blank credit is none", async (t) => {
	frozenAt(t);
	const artist = [
		"the national",
		"The National",
		"   ",
		"THE NATIONAL",
		"?",
		"Nationals",
		"N/A",
		"",
	];
	const state = caseState({
		directory: artist.map(() => "Case/"),
		columns: { artist, title: artist.map((_, at) => `Track ${at}`) },
	});

	assert.deepEqual(await valuesOf(state, "artist", "the"), ["THE NATIONAL"]);
	assert.deepEqual(await valuesOf(state, "artist", ""), [
		"Nationals",
		"THE NATIONAL",
	]);
});

test("limit caps the values at the first that many, and a limit of 0 answers none", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);
	const capped: [number, string[]][] = [
		[0, []],
		[1, ["Moenia"]],
		[2, ["Moenia", "MØ"]],
		[3, ["Moenia", "MØ", "Mœnia"]],
		[100, ["Moenia", "MØ", "Mœnia"]],
	];

	for (const [limit, expected] of capped)
		assert.deepEqual(
			await valuesOf(state, "artist", "mo", limit),
			expected,
			`limit ${limit}`,
		);
	assert.deepEqual(await valuesOf(state, "artist", "", 2), [
		"Branford Marsalis",
		"Moenia",
	]);
	assert.deepEqual(await valuesOf(state, "genre", "", 0), []);
});

test("a field whose role was left out of the question has no values", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);

	const answer = await askValues(state, [
		["field", "genre"],
		["prefix", ""],
		["limit", "100"],
		...ROLES.filter(([role]) => role !== "genre"),
	]);

	assert.equal(answer.status, 200);
	assert.deepEqual(bodyOf(answer).values, []);
});

test("values answer 200 JSON at the held pair, private, no-cache and with no ETag", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);
	const held = await libraryOf(state);

	const answer = await askValues(state, valuesQuery("artist", "MŒ"));

	assert.equal(answer.status, 200);
	assert.match(answer.headers["content-type"] ?? "", /^application\/json/);
	assert.equal(answer.headers["cache-control"], "private, no-cache");
	assert.equal(answer.headers.etag, undefined);
	assert.deepEqual(bodyOf(answer), {
		structure: held.structure,
		revision: held.revision,
		values: ["Moenia", "Mœnia"],
	});
});

test("values offering gzip are answered gzipped, holding the same document", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);
	const plain = await askValues(state, valuesQuery("artist", "mo"));
	const zipped = await askValues(state, valuesQuery("artist", "mo"), {
		"accept-encoding": "gzip",
	});

	assert.equal(zipped.status, 200);
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.deepEqual(
		JSON.parse(gunzipSync(rawOf(zipped)).toString("utf8")),
		bodyOf(plain),
	);
});

const unacceptable = (detail: string) => ({
	status: 400,
	body: { error: "unacceptable question", detail },
});

test("a field other than artist, albumArtist, album and genre is 400 naming the field", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);

	for (const field of ["title", "albumartist", "album artist", "Genre", ""])
		assert.deepEqual(
			refusalOf(await askValues(state, valuesQuery(field, "mo"))),
			unacceptable("'field' must be artist, albumArtist, album or genre"),
			JSON.stringify(field),
		);
});

// 512 two-byte characters: a limit counted in characters or UTF-16 units admits one more.
const KILOBYTE_OF_ACCENTS = "é".repeat(512);

test("a prefix of 1024 bytes is asked, and one byte more is refused however few characters", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);
	assert.equal(new TextEncoder().encode(KILOBYTE_OF_ACCENTS).length, 1024);

	for (const prefix of ["m".repeat(1024), KILOBYTE_OF_ACCENTS])
		assert.deepEqual(await valuesOf(state, "artist", prefix), []);
	for (const prefix of ["m".repeat(1025), `${KILOBYTE_OF_ACCENTS}m`])
		assert.deepEqual(
			refusalOf(await askValues(state, valuesQuery("artist", prefix))),
			unacceptable("'prefix' must be at most 1024 bytes"),
		);
});

test("a values question missing a parameter, or with a limit that is not a count, is 400 naming it", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);
	const asked = valuesQuery("artist", "mo");

	for (const missing of ["field", "prefix", "limit"])
		assert.deepEqual(
			refusalOf(
				await askValues(
					state,
					asked.filter(([name]) => name !== missing),
				),
			),
			unacceptable(`'${missing}' is required`),
			missing,
		);
	for (const limit of ["-1", "1.5", "x"])
		assert.deepEqual(
			refusalOf(
				await askValues(
					state,
					asked.map(([name, value]) => [
						name,
						name === "limit" ? limit : value,
					]),
				),
			),
			unacceptable("'limit' must be a whole number of 0 or more"),
			limit,
		);
});

test("a values question naming a parameter that is neither a role nor its own is 400 naming it", async (t) => {
	frozenAt(t);
	const state = stateOfCase(STROKED_LETTERS);

	assert.deepEqual(
		refusalOf(
			await askValues(state, [...valuesQuery("artist", "mo"), ["query", "mo"]]),
		),
		{
			status: 400,
			body: { error: "unacceptable role", detail: "'query' is not a role" },
		},
	);
});

test("values from a component serving no media library are 503, and before any build 202 starting none", async (t) => {
	frozenAt(t);
	const off = declared(withFake({ canReadLibrary: false }));
	assert.deepEqual(refusalOf(await askValues(off, valuesQuery("artist", ""))), {
		status: 503,
		body: { error: failureText("kNoLibrary") },
	});

	const unbuilt = createState();
	const before = await libraryOf(unbuilt);
	const answer = await askValues(unbuilt, valuesQuery("artist", ""));
	assert.equal(answer.status, 202);
	assert.deepEqual(bodyOf(answer), before);
	assert.deepEqual(await libraryOf(unbuilt), before);
});

test("a values role naming an expression the declaration does not hold is 409 naming it", async (t) => {
	frozenAt(t);
	const state = declared({}, [...TRACK_EXPRESSIONS]);

	assert.deepEqual(
		refusalOf(
			await askValues(state, [
				["field", "artist"],
				["prefix", ""],
				["limit", "5"],
				...withRole("artist", "%nothing%"),
			]),
		),
		{ status: 409, body: { error: "'%nothing%' is not a declared column" } },
	);
});

test("values spend from the questions' bucket, refused as a question is", async (t) => {
	frozenAt(t);
	const state = declared(
		withFake({ rateLimits: { libraryQuestions: { burst: 1, refillMs: DAY } } }),
		[...TRACK_EXPRESSIONS],
	);

	assert.equal(
		(
			await ask(state, "/api/library/genre", {
				query: [["name", "Grunge"], ...ROLES],
			})
		).status,
		200,
	);
	const refused = await askValues(state, valuesQuery("artist", ""));
	assert.equal(refused.status, 429);
	assert.deepEqual(bodyOf(refused), { error: "too many library questions" });
	assert.match(refused.headers["retry-after"] ?? "", /^[1-9]\d*$/);
});
