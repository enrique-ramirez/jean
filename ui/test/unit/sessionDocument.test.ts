import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import {
	PLAYER_KEY,
	POLL_MS,
	pollPlayerNow,
	startPlayerPoll,
} from "../../src/domain/player/playerPoll.ts";
import * as session from "../../src/domain/player/session.ts";
import type * as DocumentModule from "../../src/domain/player/sessionDocument.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { PlayerSnapshot } from "../../src/shared/api/types.ts";
import { DETACHED_ORDERS, trackAt } from "./fakeSessionHarness.ts";
import {
	loadOperations,
	MemoryStorage,
	named,
	sessionStoreHarness,
} from "./sessionStoreHarness.ts";

// The session's document as the store follows it off the poll, and which of its failure reports this
// tab has yet to tell the person about. Nothing here is drawn; the toast and the standing line read
// what these cases hold.

type SessionDocument = components["schemas"]["Session"];

const harness = sessionStoreHarness();
const operations = await loadOperations();

// Loaded rather than imported, so a module that does not load fails each case by name. `fresh` is
// another copy of the module, as another tab or a reload has: Node keys a module by its whole URL,
// query included.
let copies = 0;
const loadDocumentModule = (fresh = false): Promise<typeof DocumentModule> => {
	const url = new URL(
		"../../src/domain/player/sessionDocument.ts",
		import.meta.url,
	);
	if (fresh) {
		copies += 1;
		url.search = `copy=${copies}`;
	}
	return import(url.href).catch(
		(error: unknown) =>
			new Proxy({} as typeof DocumentModule, {
				get: (_, name) => {
					if (name === "then") return undefined;
					throw new Error(
						`sessionDocument.ts did not load, so ${String(name)} is out of reach`,
						{ cause: error },
					);
				},
			}),
	);
};

const documents = await loadDocumentModule();

const ANOTHER_DEVICE = { deviceId: "another-device", name: null };

// The fake keeps a session's last eight reports, as `contract/openapi.yaml` has the component keep
// them.
const KEPT_REPORTS = 8;

type Store = Awaited<ReturnType<typeof harness.begin>>;

const startedSession = async (store: Store) => {
	const outcome = await operations.startSession(store.context);
	await store.settle();
	assert.deepEqual(outcome, { ok: true }, "the session never started");
	const { id } = session.sessionSnapshot();
	assert.ok(id, "the start left the tab on the player");
	return id;
};

const heldDocument = (client: QueryClient) =>
	client.getQueryData<SessionDocument>(documents.SESSION_DOCUMENT_KEY);

const documentIn = (client: QueryClient) => {
	const held = heldDocument(client);
	assert.ok(held, "no session document is held");
	return held;
};

const readsOf = (store: Store, id: string, from = 0) =>
	store.fake.state.requests.slice(from).filter((entry) => {
		const url = new URL(entry.path, "http://fake");
		return (
			entry.method === "GET" &&
			url.pathname === `/api/sessions/${encodeURIComponent(id)}`
		);
	}).length;

const detached = (store: Store, id: string) => {
	const held = store.fake.state.sessions.find(id);
	assert.ok(held, `the fake holds no session ${id}`);
	return held;
};

const reportOn = (store: Store, id: string, times = 1) => {
	for (let made = 0; made < times; made += 1)
		store.fake.state.addSessionReport(id, trackAt(store.fake.state, "p1", 0));
};

const playIn = (store: Store, id: string) =>
	detached(store, id).play(
		[trackAt(store.fake.state, "p1", 0), trackAt(store.fake.state, "p1", 1)],
		0,
	);

const sequences = (reports: readonly { sequence: number }[]) =>
	reports.map((report) => report.sequence);

const unraisedNow = (client: QueryClient) =>
	sequences(
		documents.unraisedReports(documentIn(client), documents.raisedMark()),
	);

const storedMark = (storage: Storage) => {
	const raw = storage.getItem(documents.SESSION_RAISED_KEY);
	return raw === null ? null : JSON.parse(raw);
};

// Each poll is asked for outright, so it is answered in full whatever the poll last drew.
const polled = async (store: Store, client = store.queryClient, times = 1) => {
	for (let asked = 0; asked < times; asked += 1)
		await pollPlayerNow(client, store.context.origin);
	await store.settle();
};

const statePollsOf = (store: Store, from: number) =>
	store.fake.state.requests
		.slice(from)
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.split("?")[0] === "/api/state",
		).length;

const playbackDrawn = (client: QueryClient) =>
	client.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player.playbackState;

// A reload starts from an empty cache and a poll of its own, in the session the tab was in, with no
// create's answer to seed anything. Its teardown is registered before the harness's, so the poll
// stops before the harness takes its stand-in document away.
const beginWithAReload = async (t: TestContext) => {
	let stop = () => {};
	t.after(() => stop());
	const store = await harness.begin(t);
	const reload = () => {
		const client = new QueryClient();
		const stopPolling = startPlayerPoll(client, store.context.origin);
		stop = () => {
			stopPolling();
			client.clear();
		};
		return client;
	};
	return { store, reload };
};

const copyOf = (storage: Storage) => {
	const copy = new MemoryStorage();
	for (let at = 0; at < storage.length; at += 1) {
		const key = storage.key(at);
		if (key !== null) copy.setItem(key, storage.getItem(key) ?? "");
	}
	return copy;
};

// Another tab of the same browser: its own `sessionStorage` and its own copy of the module.
const inAnotherTab = async <T>(
	storage: Storage,
	work: (tab: typeof DocumentModule) => T,
): Promise<T> => {
	const own = globalThis.sessionStorage;
	Object.assign(globalThis, { sessionStorage: storage });
	try {
		return work(await loadDocumentModule(true));
	} finally {
		Object.assign(globalThis, { sessionStorage: own });
	}
};

// ---- following the document -------------------------------------------------

test("a session started here holds its document from the create's answer, and no read of it is sent then or on the polls after", async (t) => {
	const store = await harness.begin(t);
	const from = store.mark();

	const id = await startedSession(store);

	const held = documentIn(store.queryClient);
	assert.equal(held.id, id);
	assert.equal(held.kind, "detached");
	assert.deepEqual(held.playbackModes, DETACHED_ORDERS);
	assert.equal(
		readsOf(store, id, from),
		0,
		"the create's answer was read again",
	);

	await polled(store, store.queryClient, 3);

	assert.equal(readsOf(store, id, from), 0);
	assert.equal(documentIn(store.queryClient).id, id);
});

const MOVES = [
	{
		what: "sharing it",
		move: (store: Store, id: string) => detached(store, id).share(true),
	},
	{
		what: "a report",
		move: (store: Store, id: string) => reportOn(store, id),
	},
	{
		what: "its effects chain dropping",
		move: (store: Store, id: string) => {
			playIn(store, id);
			store.fake.state.dropSessionChain(id);
		},
	},
] as const;

for (const { what, move } of MOVES) {
	test(`a poll whose sessionRevision has not moved reads nothing, and ${what} moves it and is read once, after which the document is the session's as it now is`, async (t) => {
		const store = await harness.begin(t);
		const id = await startedSession(store);
		const from = store.mark();

		await polled(store, store.queryClient, 2);
		assert.equal(readsOf(store, id, from), 0, "an unmoved revision was read");

		move(store, id);
		await polled(store);
		assert.equal(readsOf(store, id, from), 1);

		await polled(store, store.queryClient, 2);
		assert.equal(
			readsOf(store, id, from),
			1,
			"a revision already read was read again",
		);

		const answered = await store.fake.documentOf(id, store.thisDevice());
		assert.deepEqual(documentIn(store.queryClient), answered.body);
	});
}

// The poll's own interval revalidates against the answer it drew, so a session nothing has changed
// in answers `304`, and that answer hands the follower the revision already read.
test("a session nothing has changed in answers the poll's interval unchanged, and no read is sent", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	const from = store.mark();

	await store.advance(POLL_MS * 3);

	assert.ok(statePollsOf(store, from) >= 2, "the poll's interval never ran");
	assert.equal(readsOf(store, id, from), 0);
	assert.equal(documentIn(store.queryClient).id, id);
});

// The tab holds the listening role without a connection, as a reload leaves it before the press: a
// tab that only controls reads the document on every changed poll, which is a rule of its own.
test("another device starting and stopping listening moves what the poll answers but not sessionRevision, and reads nothing", async (t) => {
	const store = await harness.begin(t);
	const id = await store.fake.create(store.thisDevice());
	playIn(store, id);
	session.commitSession({ id, role: "listening" });
	await store.settle();
	assert.equal(playbackDrawn(store.queryClient), "paused");
	const from = store.mark();

	const listener = store.fake.state.addSessionListener(id, ANOTHER_DEVICE);
	await polled(store);
	assert.equal(
		playbackDrawn(store.queryClient),
		"playing",
		"the poll never answered the listener arriving",
	);

	listener.close();
	await polled(store);
	assert.equal(
		playbackDrawn(store.queryClient),
		"paused",
		"the poll never answered the listener leaving",
	);

	assert.equal(readsOf(store, id, from), 0);
});

test("a tab entering a session it did not create here reads the document once, on its first poll in it", async (t) => {
	const store = await harness.begin(t);
	const id = await store.fake.create(store.thisDevice());
	const from = store.mark();

	session.commitSession({ id, role: "listening" });
	await store.settle();

	assert.equal(readsOf(store, id, from), 1);
	assert.equal(documentIn(store.queryClient).id, id);

	await polled(store, store.queryClient, 2);
	assert.equal(readsOf(store, id, from), 1);
});

test("a tab reloaded in its session reads the document once, on its first poll", async (t) => {
	const { store, reload } = await beginWithAReload(t);
	const id = await startedSession(store);
	const from = store.mark();

	const reloaded = reload();
	await store.settle();

	assert.equal(readsOf(store, id, from), 1);
	assert.equal(documentIn(reloaded).id, id);

	await polled(store, reloaded, 2);
	assert.equal(readsOf(store, id, from), 1);
});

// ---- a change of session ----------------------------------------------------

test("going back to the player forgets the document, and a read asked in the session and answered after drops its answer", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	// Another listener and sharing keep the session there and visible after this device leaves, so
	// the late read is answered with a document rather than a 404.
	store.fake.state.addSessionListener(id, ANOTHER_DEVICE);
	const read = store.hold(named(`/api/sessions/${id}`));
	detached(store, id).share(true);
	await polled(store);
	assert.equal(read.count(), 1, "the moved revision sent no read");

	const outcome = await operations.leaveSession(store.context);
	await store.settle();
	assert.deepEqual(outcome, { ok: true });
	assert.equal(heldDocument(store.queryClient), undefined);

	const from = store.mark();
	read.release();
	await store.settle();

	assert.equal(
		readsOf(store, id, from),
		1,
		"the held read never reached the fake",
	);
	assert.equal(heldDocument(store.queryClient), undefined);
});

test("at a switch to another session nothing of the first is held before the second's document arrives, and a read of the first answered after the switch is dropped", async (t) => {
	const store = await harness.begin(t);
	const first = await startedSession(store);
	store.fake.state.addSessionListener(first, ANOTHER_DEVICE);
	detached(store, first).share(true);
	await polled(store);
	const second = await store.fake.create(store.thisDevice());

	const firstRead = store.hold(named(`/api/sessions/${first}`));
	reportOn(store, first);
	await polled(store);
	assert.equal(firstRead.count(), 1, "the moved revision sent no read");
	const secondRead = store.hold(named(`/api/sessions/${second}`));

	session.commitSession({ id: second, role: "listening" });
	await store.settle();
	assert.equal(secondRead.count(), 1, "the session entered sent no read");
	assert.equal(heldDocument(store.queryClient), undefined);

	const from = store.mark();
	firstRead.release();
	await store.settle();
	assert.equal(
		readsOf(store, first, from),
		1,
		"the held read never reached the fake",
	);
	assert.equal(heldDocument(store.queryClient), undefined);

	secondRead.release();
	await store.settle();
	assert.equal(documentIn(store.queryClient).id, second);
});

test("a session started from inside another holds the new session's document even where a read of the old one is answered after the start", async (t) => {
	const store = await harness.begin(t);
	const first = await startedSession(store);
	store.fake.state.addSessionListener(first, ANOTHER_DEVICE);
	detached(store, first).share(true);
	await polled(store);

	const firstRead = store.hold(named(`/api/sessions/${first}`));
	reportOn(store, first);
	await polled(store);
	assert.equal(firstRead.count(), 1, "the moved revision sent no read");

	const second = await startedSession(store);
	assert.notEqual(second, first);
	assert.equal(documentIn(store.queryClient).id, second);

	firstRead.release();
	await store.settle();
	await polled(store);

	assert.equal(documentIn(store.queryClient).id, second);
	assert.equal(
		readsOf(store, second),
		0,
		"the new session's create's answer was read again",
	);
});

// ---- the reports this tab has not raised --------------------------------------

test("reports already in the document when the tab enters the session are not unraised, and a report made after is, by its sequence", async (t) => {
	const store = await harness.begin(t);
	const id = await store.fake.create(store.thisDevice());
	reportOn(store, id, 2);

	session.commitSession({ id, role: "listening" });
	await store.settle();
	assert.deepEqual(sequences(documentIn(store.queryClient).reports), [1, 2]);
	assert.deepEqual(unraisedNow(store.queryClient), []);

	reportOn(store, id);
	await polled(store);

	assert.deepEqual(unraisedNow(store.queryClient), [3]);
});

test("a report made while the tab is in its session is unraised until marked raised, stays raised on the next read, and the next report is unraised", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);

	reportOn(store, id);
	await polled(store);
	assert.deepEqual(unraisedNow(store.queryClient), [1]);

	documents.markRaised(id, 1);
	assert.deepEqual(unraisedNow(store.queryClient), []);

	detached(store, id).share(true);
	await polled(store);
	assert.equal(
		documentIn(store.queryClient).shared,
		true,
		"the next read never landed",
	);
	assert.deepEqual(unraisedNow(store.queryClient), []);

	reportOn(store, id);
	await polled(store);
	assert.deepEqual(unraisedNow(store.queryClient), [2]);
});

test("after a reload a report marked raised is not unraised again, and one made before the reload and not yet raised still is", async (t) => {
	const { store, reload } = await beginWithAReload(t);
	const id = await startedSession(store);
	reportOn(store, id);
	await polled(store);
	documents.markRaised(id, 1);
	reportOn(store, id);

	const reloaded = reload();
	await store.settle();
	const document = documentIn(reloaded);
	assert.deepEqual(sequences(document.reports), [1, 2]);

	assert.deepEqual(storedMark(store.storage), { id, sequence: 1 });
	const afterReload = await loadDocumentModule(true);
	assert.deepEqual(
		sequences(afterReload.unraisedReports(document, afterReload.raisedMark())),
		[2],
	);
});

test("a report raised in a session left does not hide a report of the same sequence in the session entered next", async (t) => {
	const store = await harness.begin(t);
	const first = await startedSession(store);
	reportOn(store, first);
	await polled(store);
	assert.deepEqual(unraisedNow(store.queryClient), [1]);
	documents.markRaised(first, 1);

	const second = await startedSession(store);
	reportOn(store, second);
	await polled(store);

	assert.equal(documentIn(store.queryClient).id, second);
	assert.deepEqual(unraisedNow(store.queryClient), [1]);
});

test("a tab that leaves its session and comes back into it does not hold the reports made while it was away as unraised, and a report made after it came back is", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	// Another device listening keeps the session there once this one leaves, and sharing keeps it
	// visible to this device, which is no longer a member.
	store.fake.state.addSessionListener(id, ANOTHER_DEVICE);
	detached(store, id).share(true);
	await polled(store);

	const outcome = await operations.leaveSession(store.context);
	await store.settle();
	assert.deepEqual(outcome, { ok: true });
	reportOn(store, id);

	session.commitSession({ id, role: "listening" });
	await store.settle();
	assert.deepEqual(sequences(documentIn(store.queryClient).reports), [1]);
	assert.deepEqual(unraisedNow(store.queryClient), []);

	reportOn(store, id);
	await polled(store);
	assert.deepEqual(unraisedNow(store.queryClient), [2]);
});

test("two tabs of one browser in one session each hold a report unraised until that tab marks it raised", async (t) => {
	const store = await harness.begin(t);
	// Both tabs of one browser read and write the same `localStorage`, so a mark kept there would
	// be shared between them.
	Object.assign(globalThis, { localStorage: new MemoryStorage() });
	t.after(() => Reflect.deleteProperty(globalThis, "localStorage"));
	const id = await startedSession(store);
	// A browser duplicating a tab copies its `sessionStorage`, so the second tab entered the session
	// where the first did.
	const secondTab = copyOf(store.storage);

	reportOn(store, id);
	await polled(store);
	const document = documentIn(store.queryClient);

	assert.deepEqual(unraisedNow(store.queryClient), [1]);
	documents.markRaised(id, 1);
	assert.deepEqual(unraisedNow(store.queryClient), []);

	const inTheSecond = await inAnotherTab(secondTab, (tab) => {
		const before = sequences(tab.unraisedReports(document, tab.raisedMark()));
		tab.markRaised(id, 1);
		const after = sequences(tab.unraisedReports(document, tab.raisedMark()));
		return { before, after };
	});
	assert.deepEqual(inTheSecond, { before: [1], after: [] });
	assert.deepEqual(unraisedNow(store.queryClient), []);
});

test("past the eight reports kept, the unraised are exactly the kept reports after the mark", async (t) => {
	const store = await harness.begin(t);
	const id = await startedSession(store);
	reportOn(store, id, 3);
	await polled(store);
	documents.markRaised(id, 3);

	reportOn(store, id, 7);
	await polled(store);
	const kept = sequences(documentIn(store.queryClient).reports);
	assert.deepEqual(kept, [3, 4, 5, 6, 7, 8, 9, 10]);
	assert.deepEqual(unraisedNow(store.queryClient), [4, 5, 6, 7, 8, 9, 10]);

	reportOn(store, id);
	await polled(store);
	assert.equal(documentIn(store.queryClient).reports.length, KEPT_REPORTS);
	assert.deepEqual(unraisedNow(store.queryClient), [4, 5, 6, 7, 8, 9, 10, 11]);
});
