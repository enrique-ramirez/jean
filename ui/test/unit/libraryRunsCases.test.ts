import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { COMPONENT_RATE_LIMITS } from "../fake-api/fooJean/rateLimits.ts";
import { createState } from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	type CaseLibrary,
	caseState,
	componentBucket,
	control,
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
	tooFast,
	withFake,
	withRole,
} from "./fakeLibraryHarness.ts";

const RUNS = "/api/library/runs";

interface RunsCase {
	name: string;
	source: "library_summary_cases.json" | "library_questions_cases.json";
	lengths: number[];
	covers: number[];
	untagged: number[];
}

interface SourceCase extends CaseLibrary {
	name: string;
}

const CASES = fixture<{ cases: RunsCase[] }>("library_runs_cases.json").cases;

const SOURCES: Record<RunsCase["source"], SourceCase[]> = {
	"library_summary_cases.json": fixture<{ cases: SourceCase[] }>(
		"library_summary_cases.json",
	).cases,
	"library_questions_cases.json": fixture<{ cases: SourceCase[] }>(
		"library_questions_cases.json",
	).cases,
};

const sourceOf = (one: RunsCase) => {
	const found = SOURCES[one.source].find((held) => held.name === one.name);
	assert.ok(found, `${one.source} holds no case ${one.name}`);
	return found;
};

const askRuns = (
	state: FakeState,
	headers: Record<string, string> = {},
	query: [string, string][] = ROLES,
) => ask(state, RUNS, { query, headers });

const startsOf = (lengths: number[]) => {
	const starts: number[] = [];
	let at = 0;
	for (const length of lengths) {
		starts.push(at);
		at += length;
	}
	return starts;
};

for (const runsCase of CASES)
	test(`the fake's runs answer ${runsCase.source} case ${runsCase.name} as groupByAlbum drew it`, async (t) => {
		frozenAt(t);
		const state = caseState(sourceOf(runsCase));
		const held = await libraryOf(state);

		const answer = await askRuns(state);

		assert.equal(answer.status, 200);
		assert.deepEqual(bodyOf(answer), {
			structure: held.structure,
			revision: held.revision,
			lengths: runsCase.lengths,
			covers: runsCase.covers,
			untagged: runsCase.untagged,
		});
	});

test("runs over a library whose every track carries an album tag answer untagged, and empty", async (t) => {
	frozenAt(t);
	const state = declared();

	const document = bodyOf(await askRuns(state));

	assert.ok(Object.hasOwn(document, "untagged"), "no untagged");
	assert.deepEqual(document.untagged, []);
});

test("an album tag written to a loose track moves the ETag though no length or cover moves", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ allowedFields: ["rating", "album"] }));
	const { structure } = await libraryOf(state);
	const loose = 20;
	const tagAlbum = async (album: string) =>
		assert.equal(
			(
				await ask(state, "/api/tags", {
					method: "POST",
					body: { ordinal: loose, structure, fields: { album } },
				})
			).status,
			200,
		);

	await tagAlbum("");
	const before = await askRuns(state);
	const untaggedBefore = bodyOf(before);
	const run = startsOf(untaggedBefore.lengths).indexOf(loose);
	assert.ok(run >= 0, `no run starts at ${loose}`);
	assert.ok(
		untaggedBefore.untagged.includes(run),
		"the loose run is not untagged",
	);

	await tagAlbum("A Single Apart");
	const after = await askRuns(state, { "if-none-match": before.headers.etag });

	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	const tagged = bodyOf(after);
	assert.deepEqual(tagged.lengths, untaggedBefore.lengths);
	assert.deepEqual(tagged.covers, untaggedBefore.covers);
	assert.ok(!tagged.untagged.includes(run), "the tagged run is still untagged");
});

test("runs answer 200 JSON at the held pair, private, no-cache, under a strong quoted ETag, their lengths covering the library", async (t) => {
	frozenAt(t);
	const state = declared();
	const held = await libraryOf(state);

	const answer = await askRuns(state);

	assert.equal(answer.status, 200);
	assert.match(answer.headers["content-type"] ?? "", /^application\/json/);
	assert.equal(answer.headers["cache-control"], "private, no-cache");
	assert.match(answer.headers.etag ?? "", /^"[^"]+"$/);
	const document = bodyOf(answer);
	assert.equal(document.structure, held.structure);
	assert.equal(document.revision, held.revision);
	assert.equal(
		document.lengths.reduce((sum: number, length: number) => sum + length, 0),
		held.trackCount,
	);
	assert.equal(document.covers.length, document.lengths.length);
});

test("runs asked again with their ETag are 304 with no body, under the same tag", async (t) => {
	frozenAt(t);
	const state = declared();
	const first = await askRuns(state);
	const tag = first.headers.etag;

	const again = await askRuns(state, { "if-none-match": tag });

	assert.equal(again.status, 304);
	assert.equal(again.headers.etag, tag);
	assert.equal(rawOf(again).length, 0);
});

// A revision moves about once per track played, and nothing a list draws from the runs moved with
// it, so a client revalidating on every revision has to be told nothing changed.
test("a play moves the revision and leaves the runs' ETag where it was, so asking with it is 304", async (t) => {
	frozenAt(t);
	const state = declared({ countsPlays: true });
	const before = await askRuns(state);
	const pair = await libraryOf(state);

	assert.equal(control(state, "play", { ordinal: 3 }).status, 204);
	assert.equal((await libraryOf(state)).revision, pair.revision + 1);

	const revalidated = await askRuns(state, {
		"if-none-match": before.headers.etag,
	});
	assert.equal(revalidated.status, 304);
	assert.equal((await askRuns(state)).headers.etag, before.headers.etag);
});

test("a retag that splits an album moves the ETag and answers runs broken either side of it", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ allowedFields: ["rating", "album"] }));
	const before = await askRuns(state);
	const { structure } = await libraryOf(state);
	const split = 20;

	const written = await ask(state, "/api/tags", {
		method: "POST",
		body: { ordinal: split, structure, fields: { album: "A Single Apart" } },
	});
	assert.equal(written.status, 200);

	const after = await askRuns(state, { "if-none-match": before.headers.etag });
	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	const starts = startsOf(bodyOf(after).lengths);
	assert.ok(starts.includes(split), `no run starts at ${split}: ${starts}`);
	assert.ok(
		starts.includes(split + 1),
		`no run starts at ${split + 1}: ${starts}`,
	);
});

test("a track added to the library moves the ETag, and the runs cover the larger library at its new structure", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await askRuns(state);

	assert.equal(control(state, "library", { add: 1 }).status, 204);
	state.finishLibraryBuild();
	const held = await libraryOf(state);

	const after = await askRuns(state, { "if-none-match": before.headers.etag });
	assert.equal(after.status, 200);
	assert.notEqual(after.headers.etag, before.headers.etag);
	const document = bodyOf(after);
	assert.equal(document.structure, held.structure);
	assert.equal(
		document.lengths.reduce((sum: number, length: number) => sum + length, 0),
		held.trackCount,
	);
});

test("runs offering gzip are answered gzipped, holding the same document", async (t) => {
	frozenAt(t);
	const state = declared();
	const plain = await askRuns(state);
	const zipped = await askRuns(state, { "accept-encoding": "gzip" });

	assert.equal(zipped.status, 200);
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.match(zipped.headers.vary ?? "", /Accept-Encoding/);
	assert.deepEqual(
		JSON.parse(gunzipSync(rawOf(zipped)).toString("utf8")),
		bodyOf(plain),
	);
});

test("runs naming a parameter that is not a role, an empty expression or one role twice are 400 in the summary's words", async (t) => {
	frozenAt(t);
	const state = declared();
	const refused: [string, [string, string][], object][] = [
		[
			"an unknown role",
			[...ROLES, ["colour", "%genre%"]],
			{ error: "unacceptable role", detail: "'colour' is not a role" },
		],
		[
			"an empty expression",
			withRole("album", ""),
			{
				error: "unacceptable role",
				detail: "role 'album' must be printable text of 1 to 1024 characters",
			},
		],
		[
			"a role named twice in two spellings",
			[...ROLES, ["album", "%title%"]],
			{ error: "duplicate role", detail: "role 'album' is named twice" },
		],
	];

	for (const [what, query, body] of refused)
		assert.deepEqual(
			refusalOf(await askRuns(state, {}, query)),
			{ status: 400, body },
			what,
		);
});

test("runs from a component serving no media library are 503 in foo_jean's words, after the roles are judged", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ canReadLibrary: false }));

	assert.deepEqual(refusalOf(await askRuns(state)), {
		status: 503,
		body: { error: failureText("kNoLibrary") },
	});
	assert.equal(
		(await askRuns(state, {}, [...ROLES, ["colour", "%genre%"]])).status,
		400,
	);
});

test("runs before any snapshot is built are 202 carrying the state's library, and start no build", async (t) => {
	frozenAt(t);
	const state = createState();
	const before = await libraryOf(state);

	const answer = await askRuns(state);

	assert.equal(answer.status, 202);
	assert.deepEqual(bodyOf(answer), before);
	assert.deepEqual(await libraryOf(state), before);
});

test("runs naming an expression the declaration does not hold are 409 naming it", async (t) => {
	frozenAt(t);
	const state = declared();

	assert.deepEqual(
		refusalOf(await askRuns(state, {}, withRole("album", "%nothing%"))),
		{ status: 409, body: { error: "'%nothing%' is not a declared column" } },
	);
});

test("the fake's runs bucket is sized as foo_jean's", () => {
	const buckets: Record<string, unknown> = COMPONENT_RATE_LIMITS;
	assert.deepEqual(
		buckets.libraryRuns,
		componentBucket("kLibraryReadBurst", "kLibraryReadRefill"),
	);
});

test("the runs bucket answers its depth and refuses the next 429 too many library run reads, with Retry-After", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ rateLimits: COMPONENT_RATE_LIMITS }));
	const { burst } = componentBucket("kLibraryReadBurst", "kLibraryReadRefill");

	for (let request = 1; request <= burst; request += 1)
		assert.equal((await askRuns(state)).status, 200, `request ${request}`);

	assert.deepEqual(tooFast(await askRuns(state)), {
		status: 429,
		body: { error: "too many library run reads" },
		waits: true,
	});
});

test("the runs bucket is its own: a spent summary bucket refuses no runs, and spent runs refuse no summary", async (t) => {
	frozenAt(t);
	const state = declared(
		withFake({
			rateLimits: {
				libraryRuns: { burst: 1, refillMs: DAY },
				librarySummaries: { burst: 1, refillMs: DAY },
			},
		}),
	);
	const summary: [string, string][] = [["title", "%title%"]];

	assert.equal(
		(await ask(state, "/api/library/summary", { query: summary })).status,
		200,
	);
	assert.equal((await askRuns(state)).status, 200);
	assert.equal(
		(await ask(state, "/api/library/summary", { query: summary })).status,
		429,
	);
	assert.equal((await askRuns(state)).status, 429);
});

test("runs refused 400 for what they ask spend nothing from the runs bucket", async (t) => {
	frozenAt(t);
	const state = declared(
		withFake({ rateLimits: { libraryRuns: { burst: 1, refillMs: DAY } } }),
	);
	const unknownRole: [string, string][] = [...ROLES, ["colour", "%genre%"]];

	assert.equal((await askRuns(state, {}, unknownRole)).status, 400);
	assert.equal((await askRuns(state)).status, 200);
	assert.equal((await askRuns(state, {}, unknownRole)).status, 400);
	assert.equal((await askRuns(state)).status, 429);
});
