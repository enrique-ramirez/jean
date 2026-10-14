import assert from "node:assert/strict";
import {
	after,
	afterEach,
	before,
	beforeEach,
	describe,
	test,
} from "node:test";
import * as client from "../../src/shared/api/client.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type * as Playback from "../../src/shared/api/playback.ts";

const PLAYBACK_COMMANDS = [
	"nextTrack",
	"pause",
	"playLibrarySet",
	"playPause",
	"previousTrack",
	"resume",
	"seekBy",
	"seekTo",
	"setActiveOutput",
	"setMuted",
	"setPlaybackOrder",
	"setVolume",
	"stop",
	"takeSkipAsked",
	"volumeDown",
	"volumeUp",
];

test("the playback client exports the playback commands and no other function", async () => {
	const playback: Record<string, unknown> = await import(
		"../../src/shared/api/playback.ts"
	).catch(() => ({}));
	assert.deepEqual(
		Object.keys(playback)
			.filter((name) => typeof playback[name] === "function")
			.sort(),
		PLAYBACK_COMMANDS,
	);
});

test("the player state module exports playingTrack and libraryPathMatcher", async () => {
	const playerState: Record<string, unknown> = await import(
		"../../src/shared/api/playerState.ts"
	).catch(() => ({}));
	assert.deepEqual(
		{
			playingTrack: typeof playerState.playingTrack,
			libraryPathMatcher: typeof playerState.libraryPathMatcher,
		},
		{ playingTrack: "function", libraryPathMatcher: "function" },
	);
});

type PlayLibrarySetRequest = components["schemas"]["PlayLibrarySetRequest"];

type PlayLibrarySet = (
	origin: string,
	body: PlayLibrarySetRequest,
) => Promise<unknown>;

// True while `playback.ts` has no `playLibrarySet`, and from then only if it takes this shape.
type TakesTheSchemaBody<Module> = Module extends {
	playLibrarySet: infer Command;
}
	? Command extends PlayLibrarySet
		? true
		: false
	: true;

true satisfies TakesTheSchemaBody<typeof Playback>;

describe("playing a set of library tracks", () => {
	const ORIGIN = "http://player.test";
	const SCOPE = {
		session: "d7e19a",
		deviceId: "3f8a1c0e2b7d4a919c3351e0a2f6d4b8",
	};
	// Ordinals out of ascending order, so a client that sorted them, or sent runs, would start
	// somewhere else.
	const SET: PlayLibrarySetRequest = {
		structure: 41,
		ordinals: [9, 0, 1],
		index: 1,
	};

	interface Sent {
		method: string;
		url: URL;
		contentType: string | null;
		body: string;
	}

	let sent: Sent[] = [];
	const realFetch = globalThis.fetch;

	before(() => {
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const request =
				input instanceof Request ? input : new Request(input, init);
			sent.push({
				method: request.method,
				url: new URL(request.url),
				contentType: request.headers.get("content-type"),
				body: await request.text(),
			});
			return new Response(null, { status: 204 });
		}) as typeof fetch;
	});

	after(() => {
		globalThis.fetch = realFetch;
	});

	beforeEach(() => {
		sent = [];
	});

	afterEach(() => {
		client.setSessionScope(null);
	});

	const command = async () => {
		const playback: Record<string, unknown> = await import(
			"../../src/shared/api/playback.ts"
		).catch(() => ({}));
		assert.equal(
			typeof playback.playLibrarySet,
			"function",
			"playback.ts exports playLibrarySet",
		);
		return playback.playLibrarySet as PlayLibrarySet;
	};

	test("posts the structure, the ordinal set and the index as JSON to /playback/play, and nothing else", async () => {
		const playLibrarySet = await command();
		await playLibrarySet(ORIGIN, SET);

		assert.equal(sent.length, 1);
		const [request] = sent;
		assert.equal(request.method, "POST");
		assert.equal(request.url.href, `${ORIGIN}/api/playback/play`);
		assert.match(request.contentType ?? "", /^application\/json/);
		assert.deepEqual(JSON.parse(request.body), SET);
	});

	test("names the scope's session and device while one is set", async () => {
		const playLibrarySet = await command();
		client.setSessionScope(SCOPE);
		await playLibrarySet(ORIGIN, SET);

		assert.equal(sent.length, 1);
		const [request] = sent;
		assert.equal(
			request.url.origin + request.url.pathname,
			`${ORIGIN}/api/playback/play`,
		);
		assert.deepEqual(request.url.searchParams.getAll("session"), [
			SCOPE.session,
		]);
		assert.deepEqual(request.url.searchParams.getAll("deviceId"), [
			SCOPE.deviceId,
		]);
		assert.deepEqual(JSON.parse(request.body), SET);
	});
});
