import assert from "node:assert/strict";
import { test } from "node:test";

import {
	configureListening,
	connect,
	followTimeline,
	listenTarget,
	resume,
} from "../../src/domain/player/listenerStore.ts";
import { POLL_MS } from "../../src/domain/player/playerPoll.ts";
import type * as SessionModule from "../../src/domain/player/session.ts";
import * as session from "../../src/domain/player/session.ts";
import { sessionScope } from "../../src/shared/api/client.ts";
import {
	FORMATS,
	loadOperations,
	sessionStoreHarness,
} from "./sessionStoreHarness.ts";

// The listener's half of being in a session: what it asks for and in whose name, what it does when
// the session goes away under it, and what a reload brings back.

const harness = sessionStoreHarness();
const operations = await loadOperations();

const NOT_POLLS = ["create", "ticket", "stream", "leave", "timeline"];

type Store = Awaited<ReturnType<typeof harness.begin>>;

const startedSession = async (store: Store) => {
	const outcome = await operations.startSession(store.context);
	await store.settle();
	assert.deepEqual(outcome, { ok: true }, "the session never started");
	const { id } = session.sessionSnapshot();
	assert.ok(id, "the start left the tab on the player");
	return id;
};

// `session.ts` reads the stored value once, as the module is evaluated, so a reload is a fresh copy
// of it. Node keys a module by its whole URL, query included.
let loads = 0;
const reload = async (): Promise<typeof SessionModule> => {
	loads += 1;
	const url = new URL("../../src/domain/player/session.ts", import.meta.url);
	url.search = `reload=${loads}`;
	return import(url.href);
};

test("a tab reloaded while listening comes back into its session waiting for a press, sends nothing, and the press takes a ticket naming the session", async (t) => {
	const store = await harness.begin(t, { reloading: true });
	const id = await store.fake.create(store.thisDevice());
	store.storage.setItem(
		session.SESSION_KEY,
		JSON.stringify({ id, listening: true }),
	);
	const from = store.mark();
	const played = store.played().length;

	const reloaded = await reload();
	await store.settle();

	assert.deepEqual(reloaded.sessionSnapshot(), {
		id,
		role: "listening",
		notice: null,
	});
	assert.equal(store.phase(), "blocked");

	configureListening({
		origin: store.context.origin,
		formats: FORMATS,
		session: id,
	});
	await store.settle();

	assert.equal(store.phase(), "blocked", "taking up the target left the wait");
	assert.equal(store.mark(), from, "the reload sent a request");
	assert.equal(store.played().length, played, "an element was played");

	resume();
	await store.settle();

	assert.deepEqual(store.said(from, NOT_POLLS), [`ticket ${id}`, "stream"]);
	assert.ok(store.isListening());
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).body.listeners,
		1,
	);
});

test("a tab reloaded while only controlling comes back controlling and listens to nothing", async (t) => {
	const store = await harness.begin(t, { reloading: true });
	const id = await store.fake.create(store.thisDevice());
	store.storage.setItem(
		session.SESSION_KEY,
		JSON.stringify({ id, listening: false }),
	);
	const from = store.mark();

	const reloaded = await reload();
	await store.settle();

	assert.deepEqual(reloaded.sessionSnapshot(), {
		id,
		role: "controlling",
		notice: null,
	});
	assert.equal(store.phase(), "off");
	assert.equal(store.mark(), from);
});

test("a tab reloaded while listening, on an install that turns out to offer no stream, listens to nothing and sends nothing", async (t) => {
	const store = await harness.begin(t, { reloading: true });
	const id = await store.fake.create(store.thisDevice());
	store.fake.state.fooJean.canStream = false;
	store.storage.setItem(
		session.SESSION_KEY,
		JSON.stringify({ id, listening: true }),
	);
	const from = store.mark();

	await reload();
	await store.settle();
	assert.equal(store.phase(), "blocked");

	// What `useListener` hands the listener store once discovery reads no stream.
	configureListening(null);
	await store.settle();

	assert.equal(
		store.phase(),
		"off",
		"the tab waits for a press nothing can answer",
	);
	assert.equal(store.mark(), from, "a request was sent");
});

test("a session reported gone closes this tab's stream, sends no leave, and puts the tab on the player saying it ended", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	const from = store.mark();

	session.noteSessionGone(id);
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.deepEqual(session.sessionSnapshot(), {
		id: null,
		role: null,
		notice: { kind: "ended", id },
	});
	assert.equal(store.phase(), "off");
	assert.equal(store.openStreams(), 0);
	assert.deepEqual(store.said(from, NOT_POLLS), []);
	// The fake keeps a member that never left, so the session outliving this proves no leave reached it.
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).status,
		200,
	);
});

test("a change of streaming formats while listening to a session closes the stream without a leave and waits for a press", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	const target = listenTarget();
	assert.ok(target);
	const from = store.mark();

	configureListening({ ...target, formats: ["aac"] });
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.equal(store.openStreams(), 0);
	assert.deepEqual(store.said(from, NOT_POLLS), []);
	assert.equal(store.phase(), "blocked");
	assert.deepEqual(session.sessionSnapshot(), {
		id,
		role: "listening",
		notice: null,
	});
	assert.deepEqual(store.stored(), { id, listening: true });

	resume();
	await store.settle();

	assert.deepEqual(store.said(from, ["ticket", "stream", "leave"]), [
		`ticket ${id}`,
		"stream",
	]);
	assert.equal(store.fake.state.streamFormats.at(-1), "aac");
	assert.ok(store.isListening());
});

test("the listener's ticket and timeline read name the session its target names while the tab's scope names none", async (t) => {
	const store = await harness.begin(t);
	const id = await store.fake.create(store.thisDevice());
	assert.equal(sessionScope(), null);
	configureListening({
		origin: store.context.origin,
		formats: FORMATS,
		session: id,
	});
	const from = store.mark();

	connect();
	await store.settle();
	followTimeline(store.context.origin, Number.MAX_SAFE_INTEGER);
	await store.settle();

	assert.deepEqual(store.said(from, ["ticket", "stream", "leave"]), [
		`ticket ${id}`,
		"stream",
	]);
	const timelines = store.steps(from).filter((one) => one.route === "timeline");
	assert.ok(timelines.length > 0, "the timeline was never read");
	assert.deepEqual(
		timelines.map((one) => one.session),
		timelines.map(() => id),
	);
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).body.listeners,
		1,
	);
});
