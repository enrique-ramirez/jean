import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import {
	atStructure,
	keepAsking,
	subscribeSummary,
	summaryOf,
} from "../../src/domain/library/useLibrarySummary.ts";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { libraryPollFollower } from "../../src/domain/track/libraryFollower.ts";
import { libraryEvents } from "../../src/domain/track/libraryHolds.ts";
import type { LibrarySummary } from "../../src/shared/api/librarySummary.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import { createState } from "../fake-api/state.ts";

let origins = 0;
const summaryOrigin = () => {
	origins += 1;
	return `http://summary-${origins}.invalid:8881`;
};

const ROLES = [
	"trackNumber",
	"discNumber",
	"title",
	"artist",
	"album",
	"albumArtist",
	"duration",
	"playCount",
	"lastPlayed",
	"rating",
	"year",
	"genre",
	"codec",
	"bitrate",
	"playCountLocal",
	"lastPlayedLocal",
	"added",
] as const;

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

type FakeState = ReturnType<typeof createState>;
type Library = StateDocument["library"];

const ALBUM = {
	album: "Album",
	artist: "Artist",
	cover: "Artist/Album/01.flac",
	ordinals: [0, 1, 2],
	trackCount: 3,
	plays: 4,
	lastPlayed: 0,
	added: 0,
	rating: null,
	ratedCount: 0,
	bitrate: 900,
};

const summaryAt = (structure: number, revision: number): LibrarySummary => ({
	structure,
	revision,
	trackCount: 3,
	seconds: 600,
	earliestYear: 1999,
	latestYear: 1999,
	albumCount: 1,
	artistCount: 1,
	genreCount: 1,
	topGenres: [{ name: "Genre", count: 3, share: 100 }],
	topAlbum: ALBUM,
	topArtist: {
		name: "Artist",
		plays: 4,
		albumCount: 1,
		trackCount: 3,
		cover: ALBUM,
	},
	topTracks: [
		{
			ordinal: 0,
			title: "Title",
			artist: "Artist",
			plays: 4,
			cover: ALBUM.cover,
		},
	],
	shelves: [
		{
			id: "added",
			albums: [ALBUM],
			figures: {
				albumCount: 1,
				trackCount: 3,
				seconds: 600,
				earliestYear: 1999,
				latestYear: 1999,
			},
		},
	],
});

type SummaryAnswer =
	| { kind: "document" }
	| { kind: "held"; until: Promise<void> }
	| { kind: "unreachable" }
	| { kind: "status"; status: number; headers?: Record<string, string> };

const DOCUMENT: SummaryAnswer = { kind: "document" };
const UNREACHABLE: SummaryAnswer = { kind: "unreachable" };
const answeredWith = (
	status: number,
	headers?: Record<string, string>,
): SummaryAnswer => ({ kind: "status", status, headers });

const held = () => {
	let release = () => {};
	const until = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { answer: { kind: "held", until } as SummaryAnswer, release };
};

interface SummaryPlayer {
	state: FakeState;
	answers: SummaryAnswer[];
	summaries: URL[];
}

const libraryOf = (state: FakeState): Library => ({
	ready: true,
	structure: state.libraryFeed.structure,
	revision: state.libraryFeed.revision,
	trackCount: state.libraryTracks.length,
	columns: [...state.libraryFeed.columns],
	changeCounts: state.libraryChangeCounts(),
	build: null,
	halted: false,
});

const pairOf = (state: FakeState) => ({
	structure: state.libraryFeed.structure,
	revision: state.libraryFeed.revision,
});

const answerSummary = (player: SummaryPlayer, answer: SummaryAnswer) => {
	const { structure, revision } = pairOf(player.state);
	const document = summaryAt(structure, revision);
	switch (answer.kind) {
		case "document":
			return Promise.resolve(Response.json(document));
		case "held":
			return answer.until.then(() => Response.json(document));
		case "unreachable":
			return Promise.reject(new TypeError("fetch failed"));
		case "status":
			return Promise.resolve(
				answer.status === 202
					? Response.json(
							{ ...libraryOf(player.state), ready: false },
							{ status: 202 },
						)
					: Response.json(
							{ error: `refused with ${answer.status}` },
							{ status: answer.status, headers: answer.headers },
						),
			);
	}
};

const summaryPlayer = (
	t: TestContext,
	answers: SummaryAnswer[],
): SummaryPlayer => {
	const state = createState({ countsPlays: true });
	state.libraryFeed.columns = [...TRACK_EXPRESSIONS];
	state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	state.finishLibraryBuild();

	const player: SummaryPlayer = {
		state,
		answers,
		summaries: [],
	};

	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const clock = mock.method(performance, "now", () => Date.now());
	t.after(() => {
		clock.mock.restore();
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	globalThis.fetch = ((input: Request | URL | string) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		switch (url.pathname) {
			case "/api/library/summary": {
				const at = Math.min(player.summaries.length, player.answers.length - 1);
				player.summaries.push(url);
				return answerSummary(player, player.answers[at]);
			}
			case "/api/state":
				return Promise.resolve(Response.json({ library: libraryOf(state) }));
		}
		return Promise.reject(new Error(`unexpected request: ${url.pathname}`));
	}) as typeof fetch;

	return player;
};

const SETTLE_STEPS = 20;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async () => {
	for (let step = 0; step < SETTLE_STEPS; step += 1) await flush();
};

const advanceTo = async (at: number) => {
	const by = at - Date.now();
	assert.ok(by >= 0, `the clock is past ${at} ms already`);
	mock.timers.tick(by);
	await settle();
};

const tickAt = async (origin: string, at: number) => {
	await advanceTo(at);
	libraryPollFollower.answered(origin);
	await settle();
};

const announce = async (
	origin: string,
	player: SummaryPlayer,
	library: Partial<Library> = {},
) => {
	libraryPollFollower.libraryAnnounced(origin, {
		...libraryOf(player.state),
		...library,
	});
	await settle();
};

const openWithTheLibrary = async (
	t: TestContext,
	origin: string,
	player: SummaryPlayer,
) => {
	t.after(keepAsking(origin, false));
	t.after(subscribeSummary(origin, () => {}));
	await announce(origin, player);
};

const movePlayCount = (player: SummaryPlayer) =>
	player.state.countPlay(player.state.libraryTracks[0]);

const rebuild = (player: SummaryPlayer) => {
	player.state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	player.state.finishLibraryBuild();
};

test("the summary is asked once the poll announces the library, naming every role by the expression the library declares for it", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [DOCUMENT]);
	const landedAt = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);

	assert.equal(player.summaries.length, 1);
	const { searchParams } = player.summaries[0];
	assert.deepEqual([...new Set(searchParams.keys())].sort(), [...ROLES].sort());
	for (const role of ROLES) {
		assert.deepEqual(
			searchParams.getAll(role),
			[TRACK_EXPRESSIONS[FIELD[role]]],
			`${role} is not named once by its declared expression`,
		);
	}
	assert.deepEqual(
		summaryOf(origin),
		summaryAt(landedAt.structure, landedAt.revision),
	);

	for (const at of [RETRY_MIN_MS, RETRY_MAX_MS, 2 * RETRY_MAX_MS])
		await tickAt(origin, at);
	await announce(origin, player);
	assert.equal(player.summaries.length, 1, "asked again with the pair unmoved");
});

test("a pair moved asks for the summary once more, and the previous document is read until the next one lands", async (t) => {
	const origin = summaryOrigin();
	const next = held();
	const player = summaryPlayer(t, [DOCUMENT, next.answer]);
	const first = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);
	const read: (number | undefined)[] = [];
	t.after(
		subscribeSummary(origin, () => read.push(summaryOf(origin)?.revision)),
	);

	movePlayCount(player);
	const moved = pairOf(player.state);
	assert.notEqual(moved.revision, first.revision);
	await announce(origin, player);

	assert.equal(player.summaries.length, 2);
	assert.deepEqual(
		summaryOf(origin),
		summaryAt(first.structure, first.revision),
	);

	next.release();
	await settle();
	assert.deepEqual(
		summaryOf(origin),
		summaryAt(moved.structure, moved.revision),
	);
	assert.equal(
		read.at(-1),
		moved.revision,
		"a subscriber was never told the next document landed",
	);

	await tickAt(origin, RETRY_MAX_MS);
	await announce(origin, player);
	assert.equal(player.summaries.length, 2);
});

test("a document kept across a rebuild gives no rows at the rebuilt structure until that structure's document lands", async (t) => {
	const origin = summaryOrigin();
	const next = held();
	const player = summaryPlayer(t, [DOCUMENT, next.answer]);
	const first = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);

	rebuild(player);
	const rebuilt = pairOf(player.state);
	await announce(origin, player);
	assert.notEqual(rebuilt.structure, first.structure);
	assert.equal(player.summaries.length, 2);

	assert.equal(summaryOf(origin)?.structure, first.structure);
	assert.equal(atStructure(summaryOf(origin), rebuilt.structure), null);

	next.release();
	await settle();
	assert.deepEqual(
		atStructure(summaryOf(origin), rebuilt.structure),
		summaryAt(rebuilt.structure, rebuilt.revision),
	);
});

test("atStructure gives the document only at the structure it was computed at", () => {
	const document = summaryAt(7, 3);
	assert.equal(atStructure(document, 7), document);
	assert.equal(atStructure(document, 8), null);
	assert.equal(atStructure(document, 6), null);
	assert.equal(atStructure(null, 7), null);
});

test("a summary answered 500 is asked again on the first answered tick 5 s later, and that answer lands", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [answeredWith(500), DOCUMENT]);
	const pair = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);
	assert.equal(player.summaries.length, 1);
	assert.equal(summaryOf(origin), null);

	await tickAt(origin, RETRY_MIN_MS - 1);
	assert.equal(player.summaries.length, 1, "asked again before its 5 s wait");

	await advanceTo(RETRY_MIN_MS);
	assert.equal(player.summaries.length, 1, "asked again without a tick");

	libraryPollFollower.answered(origin);
	await settle();
	assert.equal(player.summaries.length, 2);
	assert.deepEqual(summaryOf(origin), summaryAt(pair.structure, pair.revision));
});

test("each further 500, 503 or unreachable doubles the wait before the summary is asked again, up to 60 s", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [
		answeredWith(500),
		answeredWith(503),
		UNREACHABLE,
		answeredWith(500),
		answeredWith(503),
		UNREACHABLE,
		answeredWith(500),
	]);
	await openWithTheLibrary(t, origin, player);
	assert.equal(player.summaries.length, 1);

	const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
	let failedAt = 0;
	for (const [retry, wait] of waits.entries()) {
		await tickAt(origin, failedAt + wait - 1);
		assert.equal(
			player.summaries.length,
			retry + 1,
			`asked again ${wait - 1} ms after failure ${retry + 1}, before its ${wait} ms wait`,
		);

		await tickAt(origin, failedAt + wait);
		assert.equal(
			player.summaries.length,
			retry + 2,
			`not asked again ${wait} ms after failure ${retry + 1}`,
		);
		failedAt += wait;
	}
});

for (const status of [400, 413]) {
	test(`a summary refused with ${status} is not asked again at the same pair, and is asked once when the pair moves`, async (t) => {
		const origin = summaryOrigin();
		const player = summaryPlayer(t, [answeredWith(status), DOCUMENT]);
		await openWithTheLibrary(t, origin, player);

		for (const at of [RETRY_MIN_MS, RETRY_MAX_MS, 2 * RETRY_MAX_MS])
			await tickAt(origin, at);
		await announce(origin, player);
		assert.equal(player.summaries.length, 1, "asked again at the same pair");

		movePlayCount(player);
		const moved = pairOf(player.state);
		await announce(origin, player);
		assert.equal(player.summaries.length, 2);
		assert.deepEqual(
			summaryOf(origin),
			summaryAt(moved.structure, moved.revision),
		);

		await tickAt(origin, 3 * RETRY_MAX_MS);
		assert.equal(player.summaries.length, 2);
	});
}

test("a summary answered 202 is asked again when the poll reports the library ready, and not on ticks", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [answeredWith(202), DOCUMENT]);
	const pair = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);

	for (const at of [RETRY_MIN_MS, RETRY_MAX_MS, 2 * RETRY_MAX_MS])
		await tickAt(origin, at);
	await announce(origin, player, { ready: false });
	assert.equal(
		player.summaries.length,
		1,
		"asked again before the library was ready",
	);

	await announce(origin, player);
	assert.equal(player.summaries.length, 2);
	assert.deepEqual(summaryOf(origin), summaryAt(pair.structure, pair.revision));

	await announce(origin, player);
	assert.equal(player.summaries.length, 2, "asked again on every ready report");
});

test("a summary answered 429 is asked again once its Retry-After has passed, and not before", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [
		answeredWith(429, { "Retry-After": "2" }),
		DOCUMENT,
	]);
	const pair = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);

	await tickAt(origin, 1_999);
	assert.equal(
		player.summaries.length,
		1,
		"asked again inside its Retry-After",
	);

	await tickAt(origin, 2_000);
	assert.equal(player.summaries.length, 2);
	assert.deepEqual(summaryOf(origin), summaryAt(pair.structure, pair.revision));
});

test("a summary answered 409 is asked again once a rows answer has declared again, and not on ticks", async (t) => {
	const origin = summaryOrigin();
	const player = summaryPlayer(t, [answeredWith(409), DOCUMENT]);
	const pair = pairOf(player.state);
	await openWithTheLibrary(t, origin, player);

	for (const at of [RETRY_MIN_MS, RETRY_MAX_MS, 2 * RETRY_MAX_MS])
		await tickAt(origin, at);
	assert.equal(player.summaries.length, 1, "asked again before a declaration");

	await announce(origin, player);
	assert.equal(player.summaries.length, 1, "asked again on a report alone");

	libraryEvents.exported(origin);
	await settle();
	assert.equal(player.summaries.length, 2);
	assert.deepEqual(summaryOf(origin), summaryAt(pair.structure, pair.revision));
});
