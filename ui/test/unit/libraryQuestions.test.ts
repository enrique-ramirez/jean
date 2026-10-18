import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	libraryAnswerOf,
	retryLibraryQuestion,
	subscribeLibraryAnswer,
} from "../../src/domain/track/libraryAsker.ts";
import {
	libraryPollFollower,
	loadComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import {
	playlistSnapshot,
	subscribePlaylist,
} from "../../src/domain/track/playlistEntries.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import { LIBRARY_ROLE_NAMES } from "../fake-api/fooJean/librarySummary.ts";
import { createState } from "../fake-api/state.ts";

let origins = 0;
const questionOrigin = () => {
	origins += 1;
	return `http://questions-${origins}.invalid:8881`;
};

const QUESTION_RETRY_MS = 1_000;
const LONG_AFTER_MS = 120_000;

const ALBUM = { kind: "album", artist: "artist", album: "album" } as const;
const SPELLED = { album: "Album", artist: "Artist" };

type FakeState = ReturnType<typeof createState>;
type Library = StateDocument["library"];
type OrdinalSet = components["schemas"]["OrdinalSet"];
type AlbumDocument = components["schemas"]["AlbumAnswer"];

type QuestionAnswer =
	| { kind: "document"; refs: OrdinalSet; structureAhead: number }
	| { kind: "held"; refs: OrdinalSet; until: Promise<void> }
	| { kind: "unreachable" }
	| { kind: "status"; status: number; headers?: Record<string, string> };

const answeredWith = (
	refs: OrdinalSet,
	structureAhead = 0,
): QuestionAnswer => ({
	kind: "document",
	refs,
	structureAhead,
});
const UNREACHABLE: QuestionAnswer = { kind: "unreachable" };

const heldWith = (refs: OrdinalSet) => {
	let release = () => {};
	const until = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { answer: { kind: "held", refs, until } as QuestionAnswer, release };
};
const refusedWith = (
	status: number,
	headers?: Record<string, string>,
): QuestionAnswer => ({ kind: "status", status, headers });

const FIRST_THREE: OrdinalSet = { runs: [[0, 3]] };

interface QuestionPlayer {
	state: FakeState;
	answers: QuestionAnswer[];
	questions: URL[];
	exportsAsked: number;
	changesFailures: number;
}

const libraryOf = (state: FakeState): Library => ({
	ready: true,
	structure: state.libraryFeed.structure,
	revision: state.libraryFeed.revision,
	snapshotId: state.librarySnapshotId(),
	trackCount: state.libraryTracks.length,
	columns: [...state.libraryFeed.columns],
	build: null,
	halted: false,
});

const pairOf = (state: FakeState) => ({
	structure: state.libraryFeed.structure,
	revision: state.libraryFeed.revision,
});

const albumDocument = (
	state: FakeState,
	refs: OrdinalSet,
	structureAhead = 0,
): AlbumDocument => ({
	structure: pairOf(state).structure + structureAhead,
	revision: pairOf(state).revision,
	refs,
	...SPELLED,
});

const answerQuestion = (player: QuestionPlayer, answer: QuestionAnswer) => {
	switch (answer.kind) {
		case "document":
			return Promise.resolve(
				Response.json(
					albumDocument(player.state, answer.refs, answer.structureAhead),
				),
			);
		case "held": {
			const document = albumDocument(player.state, answer.refs);
			return answer.until.then(() => Response.json(document));
		}
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

const answerChanges = (player: QuestionPlayer, url: URL) => {
	if (player.changesFailures > 0) {
		player.changesFailures -= 1;
		return Promise.resolve(new Response(null, { status: 500 }));
	}
	const changes = player.state.libraryChanges(
		Number(url.searchParams.get("since")),
		Number(url.searchParams.get("structure")),
	);
	return Promise.resolve(
		changes.status === 200
			? new Response(changes.bytes)
			: Response.json({ error: changes.outcome }, { status: changes.status }),
	);
};

const QUESTION_ROUTES = new Set([
	"/api/library/album",
	"/api/library/artist",
	"/api/library/genre",
]);

const questionPlayer = (
	t: TestContext,
	answers: QuestionAnswer[],
): QuestionPlayer => {
	const state = createState({ countsPlays: true });
	state.libraryFeed.columns = [...TRACK_EXPRESSIONS];
	state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	state.finishLibraryBuild();

	const player: QuestionPlayer = {
		state,
		answers,
		questions: [],
		exportsAsked: 0,
		changesFailures: 0,
	};

	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => {
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	globalThis.fetch = ((input: Request | URL | string) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (QUESTION_ROUTES.has(url.pathname)) {
			const at = Math.min(player.questions.length, player.answers.length - 1);
			player.questions.push(url);
			return answerQuestion(player, player.answers[at]);
		}
		switch (url.pathname) {
			case "/api/library/export":
				player.exportsAsked += 1;
				return Promise.resolve(new Response(state.libraryExport()));
			case "/api/library/changes":
				return answerChanges(player, url);
			case "/api/library/summary":
				return Promise.resolve(Response.json(pairOf(state)));
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

const readLibrary = async (t: TestContext, origin: string) => {
	const key = loadComponentLibrary(origin);
	t.after(subscribePlaylist(key, () => {}));
	await settle();
	return key;
};

type View = ReturnType<typeof libraryAnswerOf<typeof ALBUM>>;

const askAlbum = async (t: TestContext, origin: string) => {
	const told: View[] = [];
	t.after(
		subscribeLibraryAnswer(origin, ALBUM, () =>
			told.push(libraryAnswerOf(origin, ALBUM)),
		),
	);
	await settle();
	return told;
};

const refsShown = (origin: string) => {
	const { answer } = libraryAnswerOf(origin, ALBUM);
	return answer ? [...answer.refs] : null;
};

const failureShown = (origin: string) =>
	libraryAnswerOf(origin, ALBUM).failure?.reason ?? null;

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
	player: QuestionPlayer,
	library: Partial<Library> = {},
) => {
	libraryPollFollower.libraryAnnounced(origin, {
		...libraryOf(player.state),
		...library,
	});
	await settle();
};

const rebuild = (player: QuestionPlayer) => {
	player.state.libraryFeed.building = [...TRACK_EXPRESSIONS];
	player.state.finishLibraryBuild();
};

const waitsOutTheClockAndThePoll = async (
	origin: string,
	player: QuestionPlayer,
) => {
	for (const at of [QUESTION_RETRY_MS, 60_000, LONG_AFTER_MS])
		await tickAt(origin, Date.now() + at);
	await announce(origin, player);
};

test("an album question names every role once by the expression the library declares for it, with the album as name and its artist as by, and the asker gets the ordinals its runs name", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		answeredWith({
			runs: [
				[1, 2],
				[6, 1],
			],
		}),
	]);
	await readLibrary(t, origin);
	await askAlbum(t, origin);

	assert.equal(player.questions.length, 1);
	const asked = player.questions[0];
	assert.equal(asked.pathname, "/api/library/album");
	assert.deepEqual(
		[...new Set(asked.searchParams.keys())].sort(),
		[...LIBRARY_ROLE_NAMES, "name", "by"].sort(),
	);
	for (const role of LIBRARY_ROLE_NAMES)
		assert.deepEqual(
			asked.searchParams.getAll(role),
			[TRACK_EXPRESSIONS[FIELD[role]]],
			`${role} is not named once by its declared expression`,
		);
	assert.deepEqual(asked.searchParams.getAll("name"), [ALBUM.album]);
	assert.deepEqual(asked.searchParams.getAll("by"), [ALBUM.artist]);

	const { answer, failure } = libraryAnswerOf(origin, ALBUM);
	assert.deepEqual(answer && [...answer.refs], [1, 2, 6]);
	assert.equal(answer?.album, SPELLED.album);
	assert.equal(answer?.artist, SPELLED.artist);
	assert.equal(failure, null);
});

test("a set sent as a bitset reaches the asker as the ordinals its bits name, least significant bit first", async (t) => {
	const origin = questionOrigin();
	questionPlayer(t, [answeredWith({ bitset: "CQY=" })]);
	await readLibrary(t, origin);
	await askAlbum(t, origin);

	assert.deepEqual(refsShown(origin), [0, 3, 9, 10]);
});

test("an answer computed at a structure other than the library held is never given to the asker, and the question is asked again once the library reaches that structure", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		answeredWith(FIRST_THREE, 1),
		answeredWith({ runs: [[5, 2]] }),
	]);
	const key = await readLibrary(t, origin);
	const held = playlistSnapshot(key).structure;
	const told = await askAlbum(t, origin);

	assert.equal(player.questions.length, 1);
	assert.equal(refsShown(origin), null);

	await waitsOutTheClockAndThePoll(origin, player);
	assert.equal(
		player.questions.length,
		1,
		"asked again before the library reached the answer's structure",
	);
	assert.equal(failureShown(origin), null);

	rebuild(player);
	await announce(origin, player);
	assert.equal(playlistSnapshot(key).structure, held + 1);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [5, 6]);

	assert.deepEqual(
		told.filter(({ answer }) => answer?.refs.length === 3),
		[],
		"the asker was given the answer computed at the other structure",
	);
});

test("an answer given at one structure is taken away when the library moves to another, until the question is answered there", async (t) => {
	const origin = questionOrigin();
	const next = heldWith({ runs: [[5, 2]] });
	const player = questionPlayer(t, [answeredWith(FIRST_THREE), next.answer]);
	await readLibrary(t, origin);
	await askAlbum(t, origin);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);

	rebuild(player);
	await announce(origin, player);
	assert.equal(player.questions.length, 2);
	assert.equal(
		refsShown(origin),
		null,
		"the answer from the structure before was still given",
	);

	next.release();
	await settle();
	assert.deepEqual(refsShown(origin), [5, 6]);
});

test("a question answered 429 shows no failure, and is asked again by itself once its Retry-After has passed, not before", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		refusedWith(429, { "Retry-After": "2" }),
		answeredWith(FIRST_THREE),
	]);
	await readLibrary(t, origin);
	const told = await askAlbum(t, origin);
	assert.equal(player.questions.length, 1);

	await tickAt(origin, 1_999);
	assert.equal(
		player.questions.length,
		1,
		"asked again inside its Retry-After",
	);
	assert.equal(refsShown(origin), null);

	await advanceTo(2_000);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);
	assert.deepEqual(
		told.filter(({ failure }) => failure !== null),
		[],
		"a 429 was shown as a failure",
	);
});

test("a question answered 202 is asked again when the poll reports the library ready, and not on ticks or with time", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		refusedWith(202),
		answeredWith(FIRST_THREE),
	]);
	await readLibrary(t, origin);
	await askAlbum(t, origin);

	for (const at of [QUESTION_RETRY_MS, 60_000, LONG_AFTER_MS])
		await tickAt(origin, at);
	await announce(origin, player, { ready: false });
	assert.equal(
		player.questions.length,
		1,
		"asked again before the library was ready",
	);

	await announce(origin, player);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);

	await announce(origin, player);
	assert.equal(player.questions.length, 2, "asked again on every ready report");
});

test("a question answered 409 is asked again once the export has declared again, and not on ticks or with time", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		refusedWith(409),
		answeredWith(FIRST_THREE),
	]);
	const pair = pairOf(player.state);
	await readLibrary(t, origin);
	await askAlbum(t, origin);

	for (const at of [QUESTION_RETRY_MS, 60_000, LONG_AFTER_MS])
		await tickAt(origin, at);
	assert.equal(player.questions.length, 1, "asked again before a declaration");

	player.changesFailures = 1;
	await announce(origin, player, { structure: pair.structure + 1 });
	assert.equal(player.exportsAsked, 2, "the library never exported again");
	assert.deepEqual(pairOf(player.state), pair);

	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);
});

test("a question refused 400 is not asked again at the same structure whatever the clock or the poll says, and is asked once the structure moves", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		refusedWith(400),
		answeredWith(FIRST_THREE),
	]);
	await readLibrary(t, origin);
	await askAlbum(t, origin);

	await waitsOutTheClockAndThePoll(origin, player);
	assert.equal(player.questions.length, 1, "asked again at the same structure");

	rebuild(player);
	await announce(origin, player);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);

	await waitsOutTheClockAndThePoll(origin, player);
	assert.equal(player.questions.length, 2);
});

for (const [failing, reason] of [
	[refusedWith(500), "failed"],
	[UNREACHABLE, "unreachable"],
] as const) {
	test(`a question that ${reason === "failed" ? "is answered 500" : "gets no answer"} is asked once more 1 s later, is then held as ${reason} and asked nothing more by itself, and Try again starts the same pair of tries`, async (t) => {
		const origin = questionOrigin();
		const player = questionPlayer(t, [
			failing,
			failing,
			failing,
			answeredWith(FIRST_THREE),
		]);
		await readLibrary(t, origin);
		const told = await askAlbum(t, origin);
		assert.equal(player.questions.length, 1);

		await advanceTo(QUESTION_RETRY_MS - 1);
		assert.equal(player.questions.length, 1, "asked again inside 1 s");
		assert.deepEqual(
			told.filter(({ failure }) => failure !== null),
			[],
			"the first failure was shown before the retry had been tried",
		);

		await advanceTo(QUESTION_RETRY_MS);
		assert.equal(player.questions.length, 2, "not asked again 1 s later");
		assert.equal(failureShown(origin), reason);
		assert.equal(refsShown(origin), null);

		await waitsOutTheClockAndThePoll(origin, player);
		assert.equal(player.questions.length, 2, "asked again by itself");
		assert.equal(failureShown(origin), reason);

		retryLibraryQuestion(origin, ALBUM);
		await settle();
		assert.equal(player.questions.length, 3, "Try again asked nothing");

		const triedAgainAt = Date.now();
		await advanceTo(triedAgainAt + QUESTION_RETRY_MS);
		assert.equal(
			player.questions.length,
			4,
			"the try after Try again was not asked again 1 s later",
		);
		assert.deepEqual(refsShown(origin), [0, 1, 2]);
		assert.equal(failureShown(origin), null);
	});
}

test("a question that fails once and is answered on its retry is never held as failed", async (t) => {
	const origin = questionOrigin();
	const player = questionPlayer(t, [
		refusedWith(500),
		answeredWith(FIRST_THREE),
	]);
	await readLibrary(t, origin);
	const told = await askAlbum(t, origin);

	await advanceTo(QUESTION_RETRY_MS);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(refsShown(origin), [0, 1, 2]);

	await waitsOutTheClockAndThePoll(origin, player);
	assert.equal(player.questions.length, 2);
	assert.deepEqual(
		told.filter(({ failure }) => failure !== null),
		[],
		"a failure the retry answered was shown",
	);
});
