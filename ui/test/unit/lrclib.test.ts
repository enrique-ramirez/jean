import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
	kindOf,
	type LrclibAnswer,
	type LrclibRecord,
	rankRecords,
} from "../../src/features/now-playing/lrclib.ts";

type Lrclib = typeof import("../../src/features/now-playing/lrclib.ts");

const LRCLIB_MODULE = new URL(
	"../../src/features/now-playing/lrclib.ts",
	import.meta.url,
).href;

let instances = 0;

// node keeps one instance of a module per URL, query string included.
const freshLrclib = (): Promise<Lrclib> => {
	instances += 1;
	return import(`${LRCLIB_MODULE}?instance=${instances}`);
};

const VERSION = "9.8.7-test";
const LRCLIB_CLIENT = `Jean ${VERSION} (https://github.com/enrique-ramirez/jean)`;

const SECOND = 1_000;
const DEADLINE_MS = 10 * SECOND;
const LONG_AFTER_MS = 10 * 60 * SECOND;

const TRACK = { title: "Te pedí", artist: "Babasónicos" };
const OTHER_TRACK = { title: "Irresponsables", artist: "Babasónicos" };

const record = (
	id: number,
	overrides: Partial<LrclibRecord> = {},
): LrclibRecord => ({
	id,
	trackName: "Te pedí",
	artistName: "Babasónicos",
	albumName: "Jessico",
	duration: 200,
	instrumental: false,
	plainLyrics: "Te pedí",
	syncedLyrics: null,
	...overrides,
});

const synced = (id: number, duration = 200) =>
	record(id, { duration, syncedLyrics: "[00:01.00]Te pedí" });
const plain = (id: number, duration = 200) => record(id, { duration });
const instrumental = (id: number, duration = 200) =>
	record(id, { duration, instrumental: true, plainLyrics: null });

const idsOf = (records: LrclibRecord[]) => records.map((each) => each.id);

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async () => {
	for (let step = 0; step < 10; step += 1) await flush();
};

const neverAnswers = (request: Request) =>
	new Promise<Response>((_, reject) => {
		request.signal.addEventListener("abort", () =>
			reject(request.signal.reason),
		);
	});

const lrclibAnswering = (
	t: TestContext,
	reply: (request: Request) => Response | Promise<Response>,
) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const realFetch = globalThis.fetch;
	const asked: Request[] = [];
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		asked.push(request);
		return Promise.resolve().then(() => reply(request));
	}) as typeof fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});
	return asked;
};

const busy = (status: number, retryAfterSeconds?: number) =>
	new Response(null, {
		status,
		headers:
			retryAfterSeconds === undefined
				? {}
				: { "Retry-After": String(retryAfterSeconds) },
	});

const search = (lrclib: Lrclib, query = TRACK) =>
	lrclib.searchLrclib(query, { version: VERSION });

const FAILED: LrclibAnswer = { ok: false, error: "failed" };
const BUSY: LrclibAnswer = { ok: false, error: "busy" };

test("a search is one GET to LRCLIB's /api/search with the title and artist, Jean's Lrclib-Client header and no referrer", async (t) => {
	const asked = lrclibAnswering(t, () => Response.json([]));
	const lrclib = await freshLrclib();

	// An unencoded ampersand would start a second query parameter.
	await search(lrclib, { title: "Te pedí", artist: "Árbol & Babasónicos" });

	assert.equal(asked.length, 1);
	const [request] = asked;
	const url = new URL(request.url);
	assert.equal(request.method, "GET");
	assert.equal(`${url.origin}${url.pathname}`, "https://lrclib.net/api/search");
	assert.deepEqual([...url.searchParams.keys()].sort(), [
		"artist_name",
		"track_name",
	]);
	assert.equal(url.searchParams.get("track_name"), "Te pedí");
	assert.equal(url.searchParams.get("artist_name"), "Árbol & Babasónicos");
	assert.equal(request.headers.get("Lrclib-Client"), LRCLIB_CLIENT);
	assert.equal(request.headers.get("Accept"), "application/json");
	assert.equal(request.referrerPolicy, "no-referrer");
});

test("a search answers every record LRCLIB sent, in the order it sent them", async (t) => {
	const sent = [instrumental(1, 200), plain(2, 260), synced(3, 150)];
	lrclibAnswering(t, () => Response.json(sent));
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), { ok: true, value: sent });
});

// What LRCLIB sends reaches a render as it is, and React throws on a child that is not text.
test("a record keeps only fields of the type LRCLIB documents, and one with no usable name or duration is left out", async (t) => {
	const whole = synced(1);
	lrclibAnswering(t, () =>
		Response.json([
			whole,
			{
				...plain(2),
				albumName: { name: "Jessico" },
				instrumental: "no",
				plainLyrics: 7,
				syncedLyrics: ["[00:01.00]Te pedí"],
			},
			{ ...plain(3), trackName: { text: "Te pedí" } },
			{ ...plain(4), artistName: null },
			{ ...plain(5), duration: "200" },
			{ ...plain(6), id: "6" },
			"a record",
			null,
		]),
	);
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), {
		ok: true,
		value: [
			whole,
			record(2, { albumName: "", plainLyrics: null, syncedLyrics: null }),
		],
	});
});

test("an empty answer from LRCLIB is a successful search that found nothing", async (t) => {
	lrclibAnswering(t, () => Response.json([]));
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), { ok: true, value: [] });
});

const failures: [string, (request: Request) => Response | Promise<Response>][] =
	[
		[
			"LRCLIB cannot be reached",
			() => Promise.reject(new TypeError("fetch failed")),
		],
		// LRCLIB's errors are JSON.
		[
			"LRCLIB answers 500",
			() =>
				Response.json(
					{ code: 500, name: "InternalError", message: "Internal error" },
					{ status: 500 },
				),
		],
		[
			"LRCLIB answers 404",
			() =>
				Response.json(
					{ code: 404, name: "NotFound", message: "Not found" },
					{ status: 404 },
				),
		],
		[
			"LRCLIB answers 200 with a body that is not JSON",
			() =>
				new Response("<html>not json</html>", {
					headers: { "Content-Type": "application/json" },
				}),
		],
	];

for (const [when, reply] of failures)
	test(`when ${when} the search fails once, never retries by itself, and a second search is sent`, async (t) => {
		const asked = lrclibAnswering(t, reply);
		const lrclib = await freshLrclib();

		assert.deepEqual(await search(lrclib), FAILED);

		t.mock.timers.tick(LONG_AFTER_MS);
		await settle();
		assert.equal(asked.length, 1);

		assert.deepEqual(await search(lrclib), FAILED);
		assert.equal(asked.length, 2);
	});

test("a search LRCLIB has not answered within ten seconds fails, and is not retried", async (t) => {
	const asked = lrclibAnswering(t, neverAnswers);
	const lrclib = await freshLrclib();

	let answer: LrclibAnswer | undefined;
	void search(lrclib).then((value) => {
		answer = value;
	});

	await settle();
	t.mock.timers.tick(DEADLINE_MS - 1);
	await settle();
	assert.equal(answer, undefined, "it gave up before ten seconds");

	t.mock.timers.tick(1);
	await settle();
	assert.deepEqual(answer, FAILED);

	t.mock.timers.tick(LONG_AFTER_MS);
	await settle();
	assert.equal(asked.length, 1);
});

test("after a 429 with Retry-After nothing is sent to LRCLIB, for any track, until that many seconds have passed", async (t) => {
	const retryAfterSeconds = 120;
	const asked = lrclibAnswering(t, () =>
		asked.length === 1
			? busy(429, retryAfterSeconds)
			: Response.json([synced(1)]),
	);
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), BUSY);
	assert.deepEqual(await search(lrclib, OTHER_TRACK), BUSY);

	t.mock.timers.tick(retryAfterSeconds * SECOND - 1);
	assert.deepEqual(await search(lrclib, OTHER_TRACK), BUSY);
	assert.equal(asked.length, 1);

	t.mock.timers.tick(2);
	const after = await search(lrclib, OTHER_TRACK);
	assert.equal(asked.length, 2);
	assert.equal(after.ok, true);
});

test("after a 503 with Retry-After nothing is sent to LRCLIB until that many seconds have passed", async (t) => {
	const retryAfterSeconds = 5;
	const asked = lrclibAnswering(t, () =>
		asked.length === 1
			? busy(503, retryAfterSeconds)
			: Response.json([plain(1)]),
	);
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), BUSY);

	t.mock.timers.tick(retryAfterSeconds * SECOND - 1);
	assert.deepEqual(await search(lrclib), BUSY);
	assert.equal(asked.length, 1);

	t.mock.timers.tick(2);
	assert.deepEqual(await search(lrclib), { ok: true, value: [plain(1)] });
	assert.equal(asked.length, 2);
});

test("after a 429 with no Retry-After the next search is not sent", async (t) => {
	const asked = lrclibAnswering(t, () => busy(429));
	const lrclib = await freshLrclib();

	assert.deepEqual(await search(lrclib), BUSY);
	assert.deepEqual(await search(lrclib, OTHER_TRACK), BUSY);
	assert.equal(asked.length, 1);
});

test("a record's kind is instrumental when LRCLIB flags it, else synced when it has synced lyrics, else plain", () => {
	assert.equal(
		kindOf(record(1, { instrumental: true, syncedLyrics: "[00:01.00]la" })),
		"instrumental",
	);
	assert.equal(kindOf(synced(2)), "synced");
	assert.equal(kindOf(record(3, { syncedLyrics: "" })), "plain");
	assert.equal(kindOf(plain(4)), "plain");
});

test("ranked records run synced, then plain, then instrumental, and within each the closest duration to the track's first, above or below it", () => {
	const records = [
		instrumental(7, 100),
		plain(5, 120),
		synced(1, 150),
		synced(2, 199),
		synced(3, 203),
		synced(4, 260),
		plain(6, 202),
		instrumental(8, 210),
	];

	assert.deepEqual(idsOf(rankRecords(records, 200)), [2, 3, 1, 4, 6, 5, 8, 7]);
});

test("a track with a duration of zero ranks the shortest records first rather than leaving LRCLIB's order", () => {
	assert.deepEqual(
		idsOf(rankRecords([synced(1, 300), synced(2, 30), synced(3, 120)], 0)),
		[2, 3, 1],
	);
});

test("with the track's duration unknown, each kind keeps LRCLIB's order", () => {
	const ranked = rankRecords(
		[plain(1, 400), synced(2, 300), plain(3, 10), synced(4, 100)],
		null,
	);

	assert.deepEqual(idsOf(ranked), [2, 4, 1, 3]);
});

test("ranking leaves the caller's records in LRCLIB's order", () => {
	const sent = [plain(1, 260), synced(2, 200)];

	rankRecords(sent, 200);

	assert.deepEqual(idsOf(sent), [1, 2]);
});
