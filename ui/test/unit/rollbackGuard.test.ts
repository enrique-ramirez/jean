import assert from "node:assert/strict";
import { test } from "node:test";

import { PLAYER_KEY } from "../../src/domain/player/playerPoll.ts";
import * as playerWrite from "../../src/domain/player/playerWrite.ts";
import { QUEUE_KEY } from "../../src/domain/player/queue.ts";
import { commitSession } from "../../src/domain/player/session.ts";
import { readTrack } from "../../src/shared/api/playerState.ts";
import type { QueueRead } from "../../src/shared/api/queue.ts";
import type { PlayerSnapshot } from "../../src/shared/api/types.ts";
import { guidOf, pathAt } from "./fakeSessionHarness.ts";
import { named, sessionStoreHarness } from "./sessionStoreHarness.ts";

// A write's optimistic patch is rolled back when the player refuses it. No unit test renders the
// hooks that make one, so the patch and its rollback are driven here as they would make them, around
// a switch the store makes for real.

const harness = sessionStoreHarness();

type Store = Awaited<ReturnType<typeof harness.begin>>;

const stopped = (snapshot: PlayerSnapshot): PlayerSnapshot => ({
	...snapshot,
	player: { ...snapshot.player, playbackState: "stopped" },
});

const emptied = (queue: QueueRead): QueueRead => ({ ...queue, entries: [] });

// Each session plays its own track and queues its own row, so both answer the same queue revision:
// what a rollback held against that revision alone cannot tell apart.
const twoSessions = async (store: Store) => {
	const scope = (session: string) => ({
		session,
		deviceId: store.thisDevice(),
	});
	const [first, second] = [
		await store.fake.create(store.thisDevice()),
		await store.fake.create(store.thisDevice()),
	];
	for (const [session, row] of [
		[first, 0],
		[second, 2],
	] as const) {
		await store.fake.playRow(scope(session), "p1", row);
		const queued = await store.fake.send("POST", "/queue", {
			...scope(session),
			body: { playlistId: guidOf(store.fake.state, "p5"), positions: [row] },
		});
		assert.ok(queued.status < 300, queued.text);
	}
	const revisions = await Promise.all(
		[first, second].map(
			async (session) =>
				(await store.fake.send("GET", "/queue", scope(session))).body.revision,
		),
	);
	assert.equal(
		revisions[0],
		revisions[1],
		"the two queues answer different revisions",
	);
	return { first, second };
};

const drawnPlayer = (store: Store) =>
	store.queryClient.getQueryData<PlayerSnapshot>(PLAYER_KEY);

const drawnQueue = (store: Store) =>
	store.queryClient.getQueryData<QueueRead>(QUEUE_KEY);

const pressBoth = (store: Store) => ({
	player: playerWrite.patchInSession<PlayerSnapshot>(
		store.queryClient,
		PLAYER_KEY,
		stopped,
	),
	queue: playerWrite.patchInSession<QueueRead>(
		store.queryClient,
		QUEUE_KEY,
		emptied,
		() => drawnQueue(store)?.revision,
	),
});

test("a write pressed in one session and refused after the tab moved to another leaves what the new session drew", async (t) => {
	const store = await harness.begin(t);
	const { first, second } = await twoSessions(store);
	commitSession({ id: first, role: "controlling" });
	await store.settle();
	assert.equal(
		readTrack(drawnPlayer(store)?.player)?.path,
		pathAt(store.fake.state, "p1", 0),
	);

	const written = pressBoth(store);
	commitSession({ id: second, role: "controlling" });
	await store.settle();
	const player = drawnPlayer(store);
	const queue = drawnQueue(store);
	assert.equal(
		readTrack(player?.player)?.path,
		pathAt(store.fake.state, "p1", 2),
	);
	assert.equal(queue?.entries.length, 1);

	written.player.rollBack();
	written.queue.rollBack();

	assert.equal(drawnPlayer(store), player);
	assert.equal(drawnQueue(store), queue);
});

test("a write refused after a switch, before the new session has answered, draws nothing of the session left", async (t) => {
	const store = await harness.begin(t);
	const { first, second } = await twoSessions(store);
	commitSession({ id: first, role: "controlling" });
	await store.settle();

	const written = pressBoth(store);
	const polls = store.hold(named("/api/state"));
	commitSession({ id: second, role: "controlling" });
	await polls.reached;

	written.player.rollBack();
	written.queue.rollBack();

	assert.equal(readTrack(drawnPlayer(store)?.player), null);
	assert.deepEqual(drawnQueue(store)?.entries ?? [], []);

	polls.release();
	await store.settle();
	assert.equal(
		readTrack(drawnPlayer(store)?.player)?.path,
		pathAt(store.fake.state, "p1", 2),
	);
});

test("a write refused in the session it was pressed in rolls back to what was drawn before it, even after a change of role", async (t) => {
	const store = await harness.begin(t);
	const { first } = await twoSessions(store);
	commitSession({ id: first, role: "controlling" });
	await store.settle();

	for (const role of ["controlling", "listening"] as const) {
		const player = drawnPlayer(store);
		const queue = drawnQueue(store);
		assert.ok(player && queue);

		const written = pressBoth(store);
		assert.equal(drawnPlayer(store)?.player.playbackState, "stopped");
		assert.deepEqual(drawnQueue(store)?.entries, []);
		commitSession({ id: first, role });

		written.player.rollBack();
		written.queue.rollBack();

		assert.deepEqual(drawnPlayer(store), player, role);
		assert.deepEqual(drawnQueue(store), queue, role);
	}
});
