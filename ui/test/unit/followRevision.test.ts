import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { followRevision } from "../../src/domain/player/followRevision.ts";
import type { Result } from "../../src/shared/api/client.ts";

const ORIGIN = "http://player.invalid:8881";

const settle = async () => {
	for (let step = 0; step < 3; step += 1)
		await new Promise((resolve) => setImmediate(resolve));
};

const stubs = new WeakMap<TestContext, { mock: { callCount(): number } }>();

const consoleErrorIn = (t: TestContext) => {
	const stub = stubs.get(t) ?? t.mock.method(console, "error", () => {});
	stubs.set(t, stub);
	return stub;
};

const follower = (
	t: TestContext,
	{
		active,
		resource = "resource",
	}: { active?: () => boolean; resource?: string } = {},
) => {
	const complaints = consoleErrorIn(t);
	const reads: {
		origin: string;
		answer: (value: string | null) => Promise<void>;
	}[] = [];
	const applied: [string, number][] = [];

	const { announce, forget } = followRevision<string>({
		resource,
		read: (origin) =>
			new Promise<Result<string>>((resolve) => {
				reads.push({
					origin,
					answer: async (value) => {
						resolve(
							value === null
								? { ok: false, reason: "unreachable", message: "" }
								: { ok: true, value },
						);
						await settle();
					},
				});
			}),
		apply: (value, revision) => {
			applied.push([value, revision]);
		},
		active,
	});

	return {
		reads,
		applied,
		forget,
		complaints: () => complaints.mock.callCount(),
		announce: async (revision: number) => {
			announce(ORIGIN, revision);
			await settle();
		},
		latest: () => {
			const last = reads.at(-1);
			assert.ok(last, "nothing has been read yet");
			return last;
		},
	};
};

test("reads once when the announced revision differs from the one last read, and not while it stays the same", async (t) => {
	const queue = follower(t);

	await queue.announce(3);
	assert.equal(queue.reads.length, 1);
	assert.equal(queue.latest().origin, ORIGIN);

	await queue.latest().answer("first");
	assert.deepEqual(queue.applied, [["first", 3]]);

	await queue.announce(3);
	await queue.announce(3);
	assert.equal(queue.reads.length, 1);

	await queue.announce(4);
	assert.equal(queue.reads.length, 2);

	await queue.latest().answer("second");
	assert.deepEqual(queue.applied.at(-1), ["second", 4]);
});

test("a revision moving during a read waits for it, reads once more after it lands, and applies the later read", async (t) => {
	const queue = follower(t);

	await queue.announce(3);
	await queue.announce(4);
	await queue.announce(5);
	assert.equal(queue.reads.length, 1, "a second read went out concurrently");

	await queue.latest().answer("read at 3");
	assert.equal(queue.reads.length, 2);

	await queue.latest().answer("read at 5");
	assert.deepEqual(queue.applied.at(-1), ["read at 5", 5]);

	await queue.announce(5);
	assert.equal(queue.reads.length, 2);
});

test("a failed read applies nothing and is retried on the next announce, the same revision included", async (t) => {
	const queue = follower(t);

	await queue.announce(3);
	await queue.latest().answer(null);
	assert.deepEqual(queue.applied, []);
	assert.equal(queue.reads.length, 1, "a failed read retried without a tick");

	await queue.announce(3);
	assert.equal(queue.reads.length, 2);

	await queue.latest().answer("recovered");
	assert.deepEqual(queue.applied, [["recovered", 3]]);

	await queue.announce(3);
	assert.equal(queue.reads.length, 2);
});

test("a revision lower than the one held reads again", async (t) => {
	const queue = follower(t);

	await queue.announce(9);
	await queue.latest().answer("before the restart");

	await queue.announce(2);
	assert.equal(queue.reads.length, 2);

	await queue.latest().answer("after the restart");
	assert.deepEqual(queue.applied.at(-1), ["after the restart", 2]);
});

test("after forget, the next announce reads whatever the revision", async (t) => {
	const timeline = follower(t);

	await timeline.announce(3);
	await timeline.latest().answer("old connection");

	timeline.forget();
	await timeline.announce(3);
	assert.equal(timeline.reads.length, 2);
});

test("an inactive follower reads nothing whatever the revision, and reads once it is active again", async (t) => {
	let listening = false;
	const timeline = follower(t, { active: () => listening });

	await timeline.announce(3);
	await timeline.announce(4);
	assert.equal(timeline.reads.length, 0);

	listening = true;
	await timeline.announce(4);
	assert.equal(timeline.reads.length, 1);
});

test("a run of failed reads is reported once, and a successful read re-arms the report", async (t) => {
	const queue = follower(t);

	for (const revision of [3, 3, 3]) {
		await queue.announce(revision);
		await queue.latest().answer(null);
	}
	assert.equal(queue.complaints(), 1);

	await queue.announce(3);
	await queue.latest().answer("recovered");
	assert.equal(queue.complaints(), 1);

	await queue.announce(4);
	await queue.latest().answer(null);
	assert.equal(queue.complaints(), 2);
});

test("each resource reports its own run of failures, whatever another resource is doing", async (t) => {
	const queue = follower(t, { resource: "queue" });
	const playlists = follower(t, { resource: "playlist list" });

	await queue.announce(3);
	await queue.latest().answer(null);
	await playlists.announce(8);
	await playlists.latest().answer(null);
	assert.equal(
		queue.complaints(),
		2,
		"a second resource starting to fail went unreported",
	);

	await playlists.announce(8);
	await playlists.latest().answer("recovered");
	await queue.announce(3);
	await queue.latest().answer(null);
	assert.equal(
		queue.complaints(),
		2,
		"another resource's success re-armed this one's report",
	);
});

test("a read from before forget is ignored when it lands, and does not let a second read run beside the current one", async (t) => {
	// A reconnect forgets while the old connection's read is still out, and that read lands late.
	const timeline = follower(t);

	await timeline.announce(3);
	timeline.forget();
	await timeline.announce(3);
	assert.equal(timeline.reads.length, 2);

	await timeline.reads[0].answer("before forget");
	await timeline.announce(4);
	assert.equal(
		timeline.reads.length,
		2,
		"a read started while the one after forget was in flight",
	);

	await timeline.reads[1].answer("after forget");
	assert.deepEqual(timeline.applied, [["after forget", 3]]);
	assert.equal(timeline.reads.length, 3);

	timeline.forget();
	await timeline.announce(4);
	await timeline.reads[2].answer(null);
	assert.equal(
		timeline.complaints(),
		0,
		"a read from before forget was reported as a failure",
	);
});
