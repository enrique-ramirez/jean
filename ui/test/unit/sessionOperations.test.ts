import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceIdentity } from "../../src/domain/player/device.ts";
import {
	configureListening,
	connect,
} from "../../src/domain/player/listenerStore.ts";
import { POLL_MS } from "../../src/domain/player/playerPoll.ts";
import * as session from "../../src/domain/player/session.ts";
import type { SessionOutcome } from "../../src/domain/player/sessionOperations.ts";
import { sessionScope } from "../../src/shared/api/client.ts";
import {
	FORMATS,
	loadOperations,
	named,
	sessionStoreHarness,
} from "./sessionStoreHarness.ts";

// What the picker's start, Leave and Stop send, in what order, and where they leave the tab. The
// picker draws none of it yet, so the store's operations are driven directly against the fake.

const harness = sessionStoreHarness();
const operations = await loadOperations();

const OTHER_DEVICE = "another-device";

const NOT_POLLS = ["create", "ticket", "stream", "leave"];

type Store = Awaited<ReturnType<typeof harness.begin>>;

const listenToPlayer = async (store: Store) => {
	configureListening({
		origin: store.context.origin,
		formats: FORMATS,
		session: null,
	});
	connect();
	await store.settle();
	assert.ok(store.isListening(), "the player's stream never opened");
	assert.equal(store.openStreams(), 1);
};

const startedSession = async (store: Store) => {
	const outcome = await operations.startSession(store.context);
	await store.settle();
	assert.deepEqual(outcome, { ok: true }, "the session never started");
	const { id } = session.sessionSnapshot();
	assert.ok(id, "the start left the tab on the player");
	return id;
};

const ANOTHER = { deviceId: OTHER_DEVICE, name: "Kitchen tablet" };

const heardOnAnotherDevice = (store: Store) => {
	const elsewhere = store.fake.state.sessions.create(ANOTHER);
	elsewhere.share(true);
	const stream = store.fake.state.addSessionListener(elsewhere.id, ANOTHER);
	return { elsewhere, stream };
};

const outcomeOf = (operation: Promise<SessionOutcome>) => {
	let settled: SessionOutcome | null = null;
	void operation.then((outcome) => {
		settled = outcome;
	});
	return () => settled;
};

const ON_THE_PLAYER = { id: null, role: null, notice: null };

test("starting a session sends one create carrying this device, then one ticket naming the session, and opens its stream with that ticket", async (t) => {
	const store = await harness.begin(t);
	const from = store.mark();

	const outcome = await operations.startSession(store.context);
	await store.settle();

	assert.deepEqual(outcome, { ok: true });
	const { id } = session.sessionSnapshot();
	assert.ok(id, "the tab is not in a session");
	assert.deepEqual(session.sessionSnapshot(), {
		id,
		role: "listening",
		notice: null,
	});
	assert.deepEqual(store.said(from, NOT_POLLS), [
		"create",
		`ticket ${id}`,
		"stream",
	]);
	const [create] = store.steps(from).filter((one) => one.route === "create");
	assert.deepEqual(create.body, deviceIdentity());

	const steps = store.steps(from);
	const polls = steps.filter(
		(one) => one.route === "poll" && one.session === id,
	);
	assert.equal(polls.length, 1, "the session was not polled once");
	assert.equal(polls[0].deviceId, store.thisDevice());
	assert.ok(
		steps.indexOf(polls[0]) > steps.indexOf(create),
		"the session was polled before it was created",
	);

	// The fake counts the stream as this device's in this session only where it was opened with a
	// ticket the session issued.
	const document = await store.fake.documentOf(id, store.thisDevice());
	assert.deepEqual(document.body.createdBy, deviceIdentity());
	assert.equal(document.body.listeners, 1);
	assert.ok(store.isListening());
	assert.deepEqual(store.stored(), { id, listening: true });
});

const REFUSALS = [
	{
		as: "too many sessions",
		reason: "full",
		rechecks: 0,
		// The session the tab is in takes the one place.
		fooJean: { maxSessions: 1 },
		refuse: () => {},
	},
	{
		as: "sessions are not available",
		reason: "unavailable",
		rechecks: 1,
		fooJean: {},
		refuse: (store: Store) => {
			store.fake.state.fooJean.canCreateSessions = false;
		},
	},
] as const;

for (const refusal of REFUSALS) {
	test(`a create refused as ${refusal.as} sends nothing more and leaves the tab in the session it was in, still listening`, async (t) => {
		const store = await harness.begin(t, { fooJean: refusal.fooJean });
		const first = await startedSession(store);
		refusal.refuse(store);
		const from = store.mark();

		const outcome = await operations.startSession(store.context);
		await store.settle();

		assert.equal(outcome.ok, false);
		assert.equal(!outcome.ok && outcome.reason, refusal.reason);
		assert.deepEqual(store.said(from, NOT_POLLS), ["create"]);
		assert.deepEqual(session.sessionSnapshot(), {
			id: first,
			role: "listening",
			notice: null,
		});
		assert.deepEqual(sessionScope(), {
			session: first,
			deviceId: store.thisDevice(),
		});
		assert.deepEqual(store.stored(), { id: first, listening: true });
		assert.ok(
			store.isListening(),
			"the stream of the session it was in stopped",
		);
		assert.equal(
			(await store.fake.documentOf(first, store.thisDevice())).body.listeners,
			1,
		);
		assert.equal(store.rechecks(), refusal.rechecks);
	});
}

test("starting a session while listening to the player sends the player's leave, naming no session, after the create and before the session's ticket", async (t) => {
	const store = await harness.begin(t);
	await listenToPlayer(store);
	const from = store.mark();

	const id = await startedSession(store);

	assert.deepEqual(store.said(from, NOT_POLLS), [
		"create",
		"leave player",
		`ticket ${id}`,
		"stream",
	]);
	const [leave] = store.steps(from).filter((one) => one.route === "leave");
	assert.equal(leave.deviceId, store.thisDevice());
	assert.equal(
		store.fake.state.streamDevices.has(store.thisDevice()),
		false,
		"the player still counts this device as listening",
	);
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).body.listeners,
		1,
	);
});

test("starting a session from another one leaves the old one once its stream has let go, and only then takes the new ticket", async (t) => {
	const store = await harness.begin(t);
	const first = await startedSession(store);
	store.element()?.holdLetGo();
	const from = store.mark();

	const outcome = outcomeOf(operations.startSession(store.context));
	await store.settle();

	const second = session.sessionSnapshot().id;
	assert.ok(
		second && second !== first,
		"the tab did not move to a new session",
	);
	assert.deepEqual(store.said(from, NOT_POLLS), ["create"]);
	assert.equal(
		store.openStreams(),
		0,
		"the old session's stream is still open",
	);

	store.element()?.letGo();
	await store.settle();

	assert.deepEqual(store.said(from, NOT_POLLS), [
		"create",
		`leave ${first}`,
		`ticket ${second}`,
		"stream",
	]);
	assert.deepEqual(outcome(), { ok: true });
	assert.equal(
		(await store.fake.documentOf(first, store.thisDevice())).status,
		404,
		"the session left, whose last member this device was, did not end",
	);
});

test("leaving a session closes its stream, puts the tab on the player, and sends the leave only once the element has let go", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	store.element()?.holdLetGo();
	const from = store.mark();

	const outcome = outcomeOf(operations.leaveSession(store.context));
	await store.settle();

	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
	assert.equal(sessionScope(), null);
	assert.equal(store.stored(), null);
	assert.equal(store.phase(), "off");
	assert.equal(store.openStreams(), 0);
	assert.equal(
		store.leavesTo(id, from),
		0,
		"the leave raced the stream's close",
	);

	store.element()?.letGo();
	await store.settle();

	// Sent after the scope moved to the player, so the session it names is the one the listener held.
	assert.deepEqual(store.said(from, NOT_POLLS), [`leave ${id}`]);
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).status,
		404,
		"the first leave did not end the session this device was the last member of",
	);
	assert.deepEqual(outcome(), { ok: true });

	const said = store.said(from, ["poll", "leave"]);
	assert.ok(
		said.indexOf("poll player") > -1 &&
			said.indexOf("poll player") < said.indexOf(`leave ${id}`),
		"the player was not polled before the leave",
	);
});

test("where the stream's connection outlives the element letting go, the first leave leaves the session alive and the retry ends it", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	store.element()?.closeLate();
	const from = store.mark();

	const outcome = outcomeOf(operations.leaveSession(store.context));
	await store.settle();

	assert.equal(store.leavesTo(id, from), 1);
	assert.equal(
		store.openStreams(),
		1,
		"the connection closed before the leave reached the player",
	);
	assert.ok(
		store.fake.state.sessions.find(id),
		"the first leave ended a session whose connection the player still held",
	);
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);

	store.element()?.letGo();
	await store.settle();
	assert.equal(store.openStreams(), 0);
	assert.ok(
		store.fake.state.sessions.find(id),
		"the session ended with no leave after the close",
	);

	await store.advance(operations.LEAVE_RETRY_MS);

	assert.deepEqual(store.said(from, NOT_POLLS), [`leave ${id}`, `leave ${id}`]);
	assert.equal(
		store.fake.state.sessions.find(id),
		null,
		"the retry did not end the session this device was the last member of",
	);
	assert.deepEqual(outcome(), { ok: true });
});

test("where the connection closed before the first leave, the leave is sent again after the retry interval, its answer changes nothing, and no poll ever names the session left", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	const from = store.mark();

	const outcome = outcomeOf(operations.leaveSession(store.context));
	await store.settle();
	assert.equal(store.leavesTo(id, from), 1);

	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.deepEqual(store.said(from, NOT_POLLS), [`leave ${id}`, `leave ${id}`]);
	assert.deepEqual(
		store.said(from, ["poll"]).filter((one) => one !== "poll player"),
		[],
	);
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
	assert.deepEqual(outcome(), { ok: true });
});

test("the leave's retry is not sent where the tab has entered the session again before it was due", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	await store.fake.share(id, store.thisDevice(), true);
	store.fake.state.addSessionListener(id, {
		deviceId: OTHER_DEVICE,
		name: null,
	});
	const from = store.mark();

	void operations.leaveSession(store.context);
	await store.settle();
	assert.equal(store.leavesTo(id, from), 1);

	session.commitSession({ id, role: "controlling" });
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.equal(
		store.leavesTo(id, from),
		1,
		"the retry left the session re-entered",
	);
	assert.equal(session.sessionSnapshot().id, id);
});

test("leaving while on the player sends nothing", async (t) => {
	const store = await harness.begin(t);
	const from = store.mark();

	await operations.leaveSession(store.context);
	await store.advance(operations.LEAVE_RETRY_MS);

	assert.deepEqual(store.said(from, NOT_POLLS), []);
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
});

test("stopping listening on the player closes its stream and sends the player's leave at once, naming no session", async (t) => {
	const store = await harness.begin(t);
	await listenToPlayer(store);
	// The player's leave is sent as it is today, without waiting for the element.
	store.element()?.holdLetGo();
	const from = store.mark();

	const outcome = await operations.stopListening(store.context);
	await store.settle();

	assert.deepEqual(outcome, { ok: true });
	assert.deepEqual(store.said(from, NOT_POLLS), ["leave player"]);
	assert.equal(store.phase(), "off");
	assert.equal(store.openStreams(), 0);
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
});

test("stopping listening in a session this tab listens to leaves the session and listens to nothing", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	const from = store.mark();

	void operations.stopListening(store.context);
	await store.settle();

	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
	assert.deepEqual(store.said(from, NOT_POLLS), [`leave ${id}`]);
	assert.equal(store.phase(), "off");
	assert.equal(
		(await store.fake.documentOf(id, store.thisDevice())).status,
		404,
	);
});

test("stopping listening in a session this tab only controls sends nothing and stays in it", async (t) => {
	const store = await harness.begin(t);
	const id = await store.fake.create(store.thisDevice());
	session.commitSession({ id, role: "controlling" });
	await store.settle();
	const from = store.mark();

	await operations.stopListening(store.context);
	await store.advance(operations.LEAVE_RETRY_MS);

	assert.deepEqual(store.said(from, NOT_POLLS), []);
	assert.deepEqual(session.sessionSnapshot(), {
		id,
		role: "controlling",
		notice: null,
	});
});

test("listening on the player takes a ticket naming no session and opens the player's stream", async (t) => {
	const store = await harness.begin(t);
	configureListening({
		origin: store.context.origin,
		formats: FORMATS,
		session: null,
	});
	const from = store.mark();

	const outcome = await operations.startListening(store.context);
	await store.settle();

	assert.deepEqual(outcome, { ok: true });
	assert.deepEqual(store.said(from, NOT_POLLS), ["ticket player", "stream"]);
	assert.ok(store.isListening());
	assert.ok(store.fake.state.streamDevices.has(store.thisDevice()));
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
});

test("joining to listen while listening to the player lets go of the player's stream and sends its leave before the session's ticket is asked for, and opens the session's stream after", async (t) => {
	const store = await harness.begin(t);
	const { elsewhere } = heardOnAnotherDevice(store);
	await listenToPlayer(store);
	const tickets = store.hold(named("/api/stream/ticket"));
	const from = store.mark();

	const outcome = outcomeOf(
		operations.joinToListen(store.context, elsewhere.id),
	);
	await tickets.reached;
	await store.settle();

	assert.equal(
		store.openStreams(),
		0,
		"the player's stream was still open when the session's ticket was asked for",
	);
	assert.deepEqual(store.said(from, NOT_POLLS), ["leave player"]);

	tickets.release();
	await store.settle();

	assert.deepEqual(outcome(), { ok: true });
	assert.deepEqual(store.said(from, NOT_POLLS), [
		"leave player",
		`ticket ${elsewhere.id}`,
		"stream",
	]);
	assert.equal(store.openStreams(), 1);
	assert.equal(
		store.fake.state.streamDevices.has(store.thisDevice()),
		false,
		"the player still counts this device as listening",
	);
});

test("a join whose ticket is refused opens the player's stream again only after the refusal, with the stream it let go already closed", async (t) => {
	const store = await harness.begin(t);
	const { elsewhere } = heardOnAnotherDevice(store);
	await listenToPlayer(store);
	store.fake.state.endSession(elsewhere.id);
	const tickets = store.hold(named("/api/stream/ticket"));
	const from = store.mark();

	const outcome = outcomeOf(
		operations.joinToListen(store.context, elsewhere.id),
	);
	await tickets.reached;
	await store.settle();

	assert.equal(
		store.openStreams(),
		0,
		"the player's stream was still open when the session's ticket was asked for",
	);
	assert.equal(
		store.played().length,
		1,
		"the player's stream was opened again before the ticket was answered",
	);

	tickets.release();
	await store.settle();

	const refusal = outcome();
	assert.equal(refusal?.ok, false);
	assert.equal(refusal && !refusal.ok && refusal.reason, "gone");
	assert.deepEqual(store.said(from, NOT_POLLS), [
		"leave player",
		`ticket ${elsewhere.id}`,
		"ticket player",
		"stream",
	]);
	assert.ok(store.isListening(), "the player's stream was not put back");
	assert.equal(store.openStreams(), 1);
	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
});

test("joining to control while listening to the player asks after the session with the player's stream still open and no leave sent, and only then lets go and sends the player's leave, taking no ticket", async (t) => {
	const store = await harness.begin(t);
	const { elsewhere } = heardOnAnotherDevice(store);
	await listenToPlayer(store);
	const probes = store.hold((request) => {
		const url = new URL(request.url);
		return (
			url.pathname === "/api/state" &&
			url.searchParams.get("session") === elsewhere.id
		);
	});
	const from = store.mark();

	const outcome = outcomeOf(
		operations.joinToControl(store.context, elsewhere.id),
	);
	await probes.reached;
	await store.settle();

	assert.equal(
		store.openStreams(),
		1,
		"the player's stream was let go before the session had answered",
	);
	assert.deepEqual(store.said(from, NOT_POLLS), []);
	assert.equal(outcome(), null);

	probes.release();
	await store.settle();

	assert.deepEqual(outcome(), { ok: true });
	assert.deepEqual(store.said(from, NOT_POLLS), ["leave player"]);
	assert.equal(store.openStreams(), 0);
	assert.equal(
		store.fake.state.streamDevices.has(store.thisDevice()),
		false,
		"the player still counts this device as listening",
	);
	assert.deepEqual(session.sessionSnapshot(), {
		id: elsewhere.id,
		role: "controlling",
		notice: null,
	});
});

test("an operation pressed while another is in flight resolves pending and sends nothing", async (t) => {
	const store = await harness.begin(t);
	await listenToPlayer(store);
	const creates = store.hold(named("/api/sessions"));
	const from = store.mark();

	const first = operations.startSession(store.context);
	await creates.reached;
	const again = outcomeOf(operations.startSession(store.context));
	const stop = outcomeOf(operations.stopListening(store.context));
	await store.settle();

	assert.equal(creates.count(), 1, "a second create was sent");
	for (const pending of [again(), stop()]) {
		assert.ok(pending, "the second operation waited on the first");
		assert.equal(pending.ok, false);
		assert.equal(!pending.ok && pending.reason, "pending");
	}
	assert.deepEqual(store.said(from, NOT_POLLS), []);
	assert.ok(store.isListening(), "the pending stop closed the player's stream");

	creates.release();
	assert.deepEqual(await first, { ok: true });
	await store.settle();
	const id = session.sessionSnapshot().id;
	assert.deepEqual(store.said(from, NOT_POLLS), [
		"create",
		"leave player",
		`ticket ${id}`,
		"stream",
	]);
});

test("a session reported gone while an operation is in flight takes the tab off it at once, and no leave is ever sent for it", async (t) => {
	const store = await harness.begin(t);
	const gone = await startedSession(store);
	const creates = store.hold(named("/api/sessions"));
	const from = store.mark();

	const next = operations.startSession(store.context);
	await creates.reached;
	session.noteSessionGone(gone);

	assert.deepEqual(session.sessionSnapshot(), {
		id: null,
		role: null,
		notice: { kind: "ended", id: gone },
	});
	await store.settle();
	assert.equal(store.openStreams(), 0);

	creates.release();
	assert.deepEqual(await next, { ok: true });
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	const started = session.sessionSnapshot().id;
	assert.ok(started && started !== gone);
	assert.deepEqual(store.said(from, NOT_POLLS), [
		"create",
		`ticket ${started}`,
		"stream",
	]);
});

test("a session reported gone while its start waits on the player's leave is followed by no ticket, and the tab listens to nothing", async (t) => {
	const store = await harness.begin(t);
	await listenToPlayer(store);
	const leaves = store.hold(named("/api/stream/leave"));
	const from = store.mark();

	const outcome = outcomeOf(operations.startSession(store.context));
	await leaves.reached;
	await store.settle();
	const { id } = session.sessionSnapshot();
	assert.ok(id, "the start had not moved the tab into its session");
	store.fake.state.endSession(id);
	session.noteSessionGone(id);

	leaves.release();
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.ok(outcome(), "the start never resolved");
	assert.deepEqual(store.said(from, NOT_POLLS), ["create", "leave player"]);
	assert.equal(store.phase(), "off");
	assert.equal(store.openStreams(), 0);
	assert.deepEqual(session.sessionSnapshot(), {
		id: null,
		role: null,
		notice: { kind: "ended", id },
	});
});

test("Leave pressed while a sharing change is on its way leaves this device in nothing once both have settled: not a member, no connection, the tab on the player", async (t) => {
	const store = await harness.begin(t);
	const { elsewhere: kept, stream: othersStream } = heardOnAnotherDevice(store);
	const joined = await operations.joinToListen(store.context, kept.id);
	await store.settle();
	assert.deepEqual(joined, { ok: true }, "the join never landed");
	const inIt = () =>
		kept.roster().some((device) => device.deviceId === store.thisDevice());
	assert.ok(inIt(), "this device never listened");

	const changes = store.hold(
		(request) =>
			request.method === "POST" && named(`/api/sessions/${kept.id}`)(request),
	);
	const sharing = operations.setSessionShared(store.context, false);
	await changes.reached;
	const leaving = operations.leaveSession(store.context);
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);
	changes.release();
	await Promise.all([sharing, leaving]);
	await store.settle();
	await store.advance(operations.LEAVE_RETRY_MS + POLL_MS);

	assert.deepEqual(session.sessionSnapshot(), ON_THE_PLAYER);
	assert.equal(inIt(), false, "this device still holds a connection");
	assert.equal(store.openStreams(), 0, "this device's stream is still open");
	othersStream.close();
	store.fake.state.sessions.leave(kept, OTHER_DEVICE);
	assert.equal(
		store.fake.state.sessions.find(kept.id),
		null,
		"this device is still a member of the session it left",
	);
});
