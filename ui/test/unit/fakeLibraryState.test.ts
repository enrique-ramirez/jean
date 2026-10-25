import assert from "node:assert/strict";
import test from "node:test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { createState } from "../fake-api/state.ts";
import {
	ask,
	bodyOf,
	control,
	declared,
	type FakeState,
	frozenAt,
	libraryOf,
	playerOf,
	withFake,
} from "./fakeLibraryHarness.ts";
import { fakePlayer } from "./fakeSessionHarness.ts";

const PLAY_COUNT = "%lastfm_play_count%";
const LAST_PLAYED = "%lastfm_last_played%";
const RATING = TRACK_EXPRESSIONS.find((expression) =>
	expression.includes("rating"),
) as string;

const countsByColumn = async (state: FakeState) => {
	const { columns, changeCounts } = await libraryOf(state);
	assert.equal(changeCounts.length, columns.length);
	return new Map<string, number>(
		columns.map((column: string, at: number) => [column, changeCounts[at]]),
	);
};

const moved = (
	before: Map<string, number>,
	after: Map<string, number>,
): Record<string, number> =>
	Object.fromEntries(
		[...after]
			.filter(([column, count]) => count !== before.get(column))
			.map(([column, count]) => [column, count - (before.get(column) ?? 0)]),
	);

test("a library built once counts no change in any column, one count per declared column", async (t) => {
	frozenAt(t);
	const state = declared();

	const counts = await countsByColumn(state);

	assert.deepEqual([...counts.keys()], (await libraryOf(state)).columns);
	assert.ok(counts.size > 0);
	assert.ok([...counts.values()].every((count) => count === 0));
});

test("a play counted at the player moves the play count's and the last played's change counts by one, and no other", async (t) => {
	frozenAt(t);
	const state = declared({ countsPlays: true });
	const before = await countsByColumn(state);

	assert.equal(control(state, "play", { ordinal: 3 }).status, 204);

	assert.deepEqual(moved(before, await countsByColumn(state)), {
		[PLAY_COUNT]: 1,
		[LAST_PLAYED]: 1,
	});
});

test("a rating written through the tags route moves the rating column's change count by one, and no other", async (t) => {
	frozenAt(t);
	const state = declared();
	const before = await countsByColumn(state);
	const { structure } = await libraryOf(state);

	const written = await ask(state, "/api/tags", {
		method: "POST",
		body: { ordinal: 5, structure, fields: { rating: "4" } },
	});

	assert.equal(written.status, 200);
	assert.deepEqual(moved(before, await countsByColumn(state)), { [RATING]: 1 });
});

const pathAtOrdinal = async (
	state: FakeState,
	ordinal: number,
	structure: number,
) => {
	const answer = await ask(state, "/api/track/library", {
		query: [
			["ordinal", String(ordinal)],
			["structure", String(structure)],
			["columns", "%path%"],
		],
	});
	assert.equal(answer.status, 200);
	return bodyOf(answer).columns[0];
};

test("the state names the playing track's ordinal at the structure it reports", async (t) => {
	frozenAt(t);
	const state = declared();
	state.playItem("p5", 2);

	const player = await playerOf(state);
	const { structure } = await libraryOf(state);

	assert.equal(typeof player.libraryOrdinal, "number");
	assert.equal(
		await pathAtOrdinal(state, player.libraryOrdinal, structure),
		player.path,
	);
});

test("the state names no ordinal for a playing track the media library does not hold", async (t) => {
	frozenAt(t);
	const captured = createState();
	const outside = new Set(
		captured.playlistById("p1")?.items.map((track) => track["%path%"]),
	);
	const state = declared({
		mediaLibrary: captured.libraryTracks.filter(
			(track) => !outside.has(track["%path%"]),
		),
	});
	state.playItem("p1", 0);

	const player = await playerOf(state);

	assert.notEqual(player.path, "");
	assert.equal(player.libraryPath, null);
	assert.equal(player.libraryOrdinal, null);
});

test("a track added above the playing one moves its ordinal with the structure", async (t) => {
	frozenAt(t);
	const state = declared();
	const last = state.ordinalOrder().length - 1;
	const playing = state.ordinalOrder()[last].track["%path%"];
	const row = state
		.playlistById("p7")
		?.items.findIndex((track) => track["%path%"] === playing);
	assert.ok(row !== undefined && row >= 0);
	state.playItem("p7", row);
	const before = await playerOf(state);
	const held = await libraryOf(state);
	assert.equal(before.libraryOrdinal, last);

	assert.equal(control(state, "library", { add: 1 }).status, 204);
	state.finishLibraryBuild();

	const after = await playerOf(state);
	const { structure } = await libraryOf(state);
	assert.notEqual(structure, held.structure);
	assert.equal(after.libraryOrdinal, last + 1);
	assert.equal(
		await pathAtOrdinal(state, after.libraryOrdinal, structure),
		after.path,
	);
});

test("a component serving no media library names no ordinal", async (t) => {
	frozenAt(t);
	const state = declared(withFake({ canReadLibrary: false }));
	state.playItem("p5", 2);

	assert.equal((await playerOf(state)).libraryOrdinal, null);
});

const player = fakePlayer();

test("a detached session's state names its own playing track's ordinal, and the player's names the player's", async () => {
	player.fresh();
	const session = await player.create("device-a");
	const scope = { session, deviceId: "device-a" };
	const played = await player.playRow(scope, "p5", 2);
	assert.equal(played.status, 204, played.text);

	const own = await player.poll(scope);
	const engine = await player.poll();
	const structure = await player.structure();
	assert.notEqual(own.path, engine.path);

	for (const [who, polled] of [
		["the session", own],
		["the player", engine],
	] as const) {
		assert.equal(typeof polled.libraryOrdinal, "number", who);
		const read = await player.send("GET", "/track/library", {
			query: {
				ordinal: String(polled.libraryOrdinal),
				structure: String(structure),
				columns: "%path%",
			},
		});
		assert.equal(read.status, 200, who);
		assert.equal(read.body.columns[0], polled.path, who);
	}
});
