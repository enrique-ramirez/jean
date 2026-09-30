import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { mock, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import * as store from "../../src/domain/track/libraryLoader.ts";
import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import { librarySourceOf } from "../../src/domain/track/librarySource.ts";
import {
	type PlaylistSnapshot,
	playlistSnapshot,
	subscribePlaylist,
} from "../../src/domain/track/playlistEntries.ts";
import {
	carryPlaylist,
	holdPlaylistLoads,
	loadPlaylist,
	recheckPlaylist,
} from "../../src/domain/track/playlistLoader.ts";
import type {
	PlaylistChanges,
	PlaylistPage,
} from "../../src/shared/api/playlists.ts";
import type { StateDocument } from "../../src/shared/api/state.ts";
import type { TrackColumns } from "../../src/shared/api/types.ts";
import { en } from "../../src/shared/i18n/en.ts";

// The store holds the rows a playlist view draws and the addresses a rating is
// written to, and a delta reaches it from a poll rather than from anything a
// person does. What it did with one is not a surface a browser can be pointed
// at: the page looks the same whether a row's address followed its values or
// stayed behind.

const ORIGIN = "http://player.invalid:8881";
// Every track of one cue sheet shares a library path, so the subsong is the
// half of the address that tells two of them apart.
const CUE = "Fictional Artist/Imaginary Album/album.flac";
const TRACK = "Fictional Artist/Imaginary Album/02 Track.flac";
const LAST = "Fictional Artist/Imaginary Album/03 Last.flac";

// Past 2^53, because a generation that made a round trip through a JavaScript
// number would name a different one.
const STRUCTURE = "9204739866101318923";

const FIRST_READ = "4611686018427387904";
const SECOND_READ = "4611686018427387905";

interface Row {
	libraryPath: string | null;
	subsong: number;
	title: string;
	rating: string;
}

const columnsOf = ({ title, rating }: Row): TrackColumns => {
	const columns = TRACK_EXPRESSIONS.map(() => "");
	columns[FIELD.title] = title;
	columns[FIELD.rating] = rating;
	return columns;
};

const pageOf = (
	rows: Row[],
	revision: string,
	structure = STRUCTURE,
): PlaylistPage => ({
	structure,
	revision,
	totalCount: rows.length,
	items: rows.map((row) => ({
		columns: columnsOf(row),
		libraryPath: row.libraryPath,
		subsong: row.subsong,
	})),
});

const changesOf = (
	moved: { position: number; row: Row }[],
	revision: string,
): PlaylistChanges => ({
	revision,
	items: moved.map(({ position, row }) => ({
		position,
		libraryPath: row.libraryPath,
		subsong: row.subsong,
	})),
	columns: TRACK_EXPRESSIONS.map((_, field) => ({
		text: moved.map(({ row }) => columnsOf(row)[field]),
		ids: moved.map((_, at) => at),
	})),
});

interface FakePlayer {
	/** What the playlist holds right now. A reload reads this again. */
	rows: Row[];
	structure: string;
	changes: PlaylistChanges | null;
	rowReads: number;
	changeReads: string[];
	/** Statuses the next changes reads are refused with, one per read. */
	changesRefused: number[];
	/** Revisions a changes read cannot catch up from, answered `410` every time. */
	changesGoneSince: string[];
}

const playerHolding = (t: TestContext, rows: Row[]): FakePlayer => {
	const player: FakePlayer = {
		rows,
		structure: STRUCTURE,
		changes: null,
		rowReads: 0,
		changeReads: [],
		changesRefused: [],
		changesGoneSince: [],
	};

	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});

	const answer = (body: unknown) =>
		new Response(JSON.stringify(body), {
			headers: { "Content-Type": "application/json" },
		});

	globalThis.fetch = ((request: Request) => {
		const url = request.url;
		if (url.includes("/items/changes?")) {
			player.changeReads.push(new URL(url).searchParams.get("structure") ?? "");
			const since = new URL(url).searchParams.get("since") ?? "";
			if (player.changesGoneSince.includes(since))
				return Promise.resolve(
					Response.json({ error: "gone", detail: "" }, { status: 410 }),
				);
			const refused = player.changesRefused.shift();
			if (refused !== undefined)
				return Promise.resolve(
					Response.json({ error: "refused", detail: "" }, { status: refused }),
				);
			assert.ok(player.changes, `no change to answer: ${url}`);
			return Promise.resolve(answer(player.changes));
		}
		if (url.includes("/items?")) {
			player.rowReads += 1;
			return Promise.resolve(
				answer(
					pageOf(
						player.rows,
						player.changes?.revision ?? FIRST_READ,
						player.structure,
					),
				),
			);
		}
		return Promise.reject(new Error(`unexpected request: ${url}`));
	}) as typeof fetch;

	return player;
};

// The load resolves over several microtask turns and never over a timer, so
// the page has settled once the queue drains rather than once a clock passes.
const STEPS_TO_SETTLE = 100;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const loaded = async (
	playlistId: string,
	count: number,
	structure = STRUCTURE,
) => {
	const key = loadPlaylist(ORIGIN, playlistId, structure, count);

	for (let step = 0; step < STEPS_TO_SETTLE; step += 1) {
		const { isLoading, loaded, error } = playlistSnapshot(key);
		if (!isLoading && (loaded === count || error)) break;
		await flush();
	}

	const snapshot = playlistSnapshot(key);
	assert.equal(snapshot.error, null);
	assert.equal(snapshot.loaded, count, "the page never finished loading");
	return key;
};

const columnIn = (key: string, field: number) => {
	const { columns } = playlistSnapshot(key);
	return Array.from({ length: columns.trackCount }, (_, position) =>
		columns.fields[field].at(position),
	);
};

const shownIn = (key: string) => columnIn(key, FIELD.title);

const ratingsIn = (key: string) => columnIn(key, FIELD.rating);

const addressesIn = (key: string, playlistId: string) => {
	const { paths, subsongs, columns } = playlistSnapshot(key);
	assert.ok(paths && subsongs, "the snapshot carried no addresses at all");

	const source = librarySourceOf({
		kind: "playlist",
		playlistId,
		origin: ORIGIN,
		paths,
		subsongs,
		structure: STRUCTURE,
	});
	return Array.from({ length: columns.trackCount }, (_, position) =>
		source.address(position),
	);
};

const libraryAddress = (track: string, subsong: number) => ({
	kind: "library",
	track,
	subsong,
});

test("a delta that swaps two tracks of one cue sheet leaves each row addressing the track it shows", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b01";
	const player = playerHolding(t, [
		{ libraryPath: CUE, subsong: 1, title: "Side A", rating: "3" },
		{ libraryPath: CUE, subsong: 2, title: "Side B", rating: "4" },
		{ libraryPath: TRACK, subsong: 0, title: "Another Track", rating: "5" },
	]);

	const key = await loaded(playlistId, player.rows.length);
	assert.deepEqual(shownIn(key), ["Side A", "Side B", "Another Track"]);

	const swapped = [player.rows[1], player.rows[0]];
	player.rows = [...swapped, player.rows[2]];
	player.changes = changesOf(
		swapped.map((row, position) => ({ position, row })),
		SECOND_READ,
	);

	await recheckPlaylist(ORIGIN, playlistId, {
		structure: STRUCTURE,
		revision: SECOND_READ,
	});

	assert.deepEqual(shownIn(key), ["Side B", "Side A", "Another Track"]);
	assert.deepEqual(addressesIn(key, playlistId), [
		libraryAddress(CUE, 2),
		libraryAddress(CUE, 1),
		libraryAddress(TRACK, 0),
	]);
});

test("a delta that changes a row's values where it sits costs no second read of the page", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b02";
	const player = playerHolding(t, [
		{ libraryPath: CUE, subsong: 1, title: "Side A", rating: "3" },
		{ libraryPath: CUE, subsong: 2, title: "Side B", rating: "4" },
		{ libraryPath: TRACK, subsong: 0, title: "Another Track", rating: "2" },
	]);

	const key = await loaded(playlistId, player.rows.length);
	assert.equal(player.rowReads, 1);

	const rated: Row = { ...player.rows[1], rating: "5" };
	player.rows = [player.rows[0], rated, player.rows[2]];
	player.changes = changesOf([{ position: 1, row: rated }], SECOND_READ);

	await recheckPlaylist(ORIGIN, playlistId, {
		structure: STRUCTURE,
		revision: SECOND_READ,
	});

	assert.deepEqual(ratingsIn(key), ["3", "5", "2"]);
	assert.deepEqual(addressesIn(key, playlistId), [
		libraryAddress(CUE, 1),
		libraryAddress(CUE, 2),
		libraryAddress(TRACK, 0),
	]);
	assert.equal(player.rowReads, 1);
});

// What `foo_jean` answers a move or a sort: the structure the playlist now
// stands at, and `order[new] = old`. The rows are re-keyed to it rather than
// read again, and the poll may announce that structure before the answer lands.
const MOVED = "9204739866101318924";
const ORDER = [2, 0, 3, 1];

const FOUR_ROWS = (): Row[] => [
	{ libraryPath: CUE, subsong: 1, title: "Side A", rating: "3" },
	{ libraryPath: CUE, subsong: 2, title: "Side B", rating: "4" },
	{ libraryPath: TRACK, subsong: 0, title: "Another Track", rating: "5" },
	{ libraryPath: LAST, subsong: 0, title: "Last Track", rating: "1" },
];

const CARRIED_TITLES = ["Another Track", "Side A", "Last Track", "Side B"];
const CARRIED_ADDRESSES = [
	libraryAddress(TRACK, 0),
	libraryAddress(CUE, 1),
	libraryAddress(LAST, 0),
	libraryAddress(CUE, 2),
];

// Each step drains the microtask queue once, so a read that was going to start
// has been asked of the fake by the last one.
const settled = async () => {
	for (let step = 0; step < STEPS_TO_SETTLE; step += 1) await flush();
};

const movedAtThePlayer = (player: FakePlayer) => {
	player.rows = ORDER.map((old) => player.rows[old]);
	player.structure = MOVED;
};

test("a carried playlist is shown in the answered order at the new structure without reading the page again", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b11";
	const player = playerHolding(t, FOUR_ROWS());
	await loaded(playlistId, 4);
	movedAtThePlayer(player);

	assert.equal(carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER), true);
	const key = loadPlaylist(ORIGIN, playlistId, MOVED, 4);
	await settled();

	const snapshot = playlistSnapshot(key);
	assert.equal(snapshot.isLoading, false);
	assert.equal(snapshot.loaded, 4);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
	assert.deepEqual(addressesIn(key, playlistId), CARRIED_ADDRESSES);
	assert.equal(player.rowReads, 1);
});

test("a poll at the carried structure and the revision already held asks the player nothing", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b12";
	const player = playerHolding(t, FOUR_ROWS());
	await loaded(playlistId, 4);
	movedAtThePlayer(player);
	carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER);
	loadPlaylist(ORIGIN, playlistId, MOVED, 4);

	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: FIRST_READ,
	});
	await settled();

	assert.deepEqual(player.changeReads, []);
	assert.equal(player.rowReads, 1);
});

test("a delta after a carry patches the row now at that position, asked at the new structure", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b13";
	const player = playerHolding(t, FOUR_ROWS());
	await loaded(playlistId, 4);
	movedAtThePlayer(player);
	carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER);
	const key = loadPlaylist(ORIGIN, playlistId, MOVED, 4);

	const rated: Row = { ...player.rows[0], rating: "2" };
	player.rows = [rated, ...player.rows.slice(1)];
	player.changes = changesOf([{ position: 0, row: rated }], SECOND_READ);
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});

	assert.deepEqual(player.changeReads, [MOVED]);
	assert.deepEqual(ratingsIn(key), ["2", "3", "1", "4"]);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
	assert.equal(player.rowReads, 1);
});

const THIRD_READ = "4611686018427387906";

const carriedAt = async (t: TestContext, playlistId: string) => {
	const player = playerHolding(t, FOUR_ROWS());
	await loaded(playlistId, 4);
	movedAtThePlayer(player);
	assert.equal(carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER), true);
	return { player, key: loadPlaylist(ORIGIN, playlistId, MOVED, 4) };
};

// `foo_jean` keeps a change window per structure and drops it when the
// structure moves, so the revision a carry brings from the old structure is
// always past it: the first changes read after a carry answers `410`.
test("the first 410 after a carry takes the poll's revision as held and reads nothing", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b21";
	const { player, key } = await carriedAt(t, playlistId);

	player.changesRefused = [410];
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	await settled();

	assert.deepEqual(player.changeReads, [MOVED]);
	assert.equal(player.rowReads, 1);
	assert.equal(playlistSnapshot(key).isLoading, false);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);

	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	await settled();

	assert.deepEqual(player.changeReads, [MOVED]);
	assert.equal(player.rowReads, 1);
});

test("a 410 after the carry's first one reads the page again", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b22";
	const { player, key } = await carriedAt(t, playlistId);

	player.changesRefused = [410];
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	player.changesRefused = [410];
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: THIRD_READ,
	});
	await settled();

	assert.equal(player.rowReads, 2);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
});

test("a delta answered after a carry leaves a later 410 reading the page again", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b23";
	const { player, key } = await carriedAt(t, playlistId);

	player.changes = changesOf([], SECOND_READ);
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	player.changesRefused = [410];
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: THIRD_READ,
	});
	await settled();

	assert.equal(player.rowReads, 2);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
});

// A `409` says the structure moved again since the carry, so every held
// position names another row and only a fresh page will do.
test("a 409 as the first answer after a carry reads the page again", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b24";
	const { player } = await carriedAt(t, playlistId);

	player.changesRefused = [409];
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	await settled();

	assert.equal(player.rowReads, 2);
});

// The poll announces the moved structure before the move's answer lands, so
// its recheck finds the new key with nothing carried yet. The carry's first
// 410 belongs to that poll: a later 410 is a window the player can no longer
// catch up from, and only a fresh page shows what changed meanwhile.
test("a 410 after a carry whose poll arrived first reads the page again and draws what changed", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b25";
	const player = playerHolding(t, FOUR_ROWS());
	const heldKey = await loaded(playlistId, 4);
	const stopHeld = subscribePlaylist(heldKey, () => {});

	const release = holdPlaylistLoads(playlistId);
	movedAtThePlayer(player);
	player.changesGoneSince = [FIRST_READ, SECOND_READ];

	stopHeld();
	const key = loadPlaylist(ORIGIN, playlistId, MOVED, 4);
	const stopMoved = subscribePlaylist(key, () => {});
	t.after(stopMoved);
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: SECOND_READ,
	});
	await settled();

	assert.equal(carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER), true);
	release();
	await settled();
	assert.equal(player.rowReads, 1);

	const rated: Row = { ...player.rows[0], rating: "2" };
	player.rows = [rated, ...player.rows.slice(1)];
	player.changes = changesOf([], THIRD_READ);
	await recheckPlaylist(ORIGIN, playlistId, {
		structure: MOVED,
		revision: THIRD_READ,
	});
	await settled();

	assert.equal(player.rowReads, 2);
	assert.deepEqual(ratingsIn(key), ["2", "3", "1", "4"]);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
});

test("a carry from a structure nothing is held at registers nothing, so the new structure is read", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b14";
	const player = playerHolding(t, FOUR_ROWS());
	movedAtThePlayer(player);

	assert.equal(carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER), false);
	const key = await loaded(playlistId, 4, MOVED);

	assert.equal(player.rowReads, 1);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
});

// The poll announces the moved structure before the write's answer lands, and
// the view asks for the playlist at it. A read then would draw the rows again
// from nothing and flicker.
test("a load asked for while held waits, and a carry before the release leaves nothing to read", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b15";
	const player = playerHolding(t, FOUR_ROWS());
	const heldKey = await loaded(playlistId, 4);
	const stopHeld = subscribePlaylist(heldKey, () => {});

	const release = holdPlaylistLoads(playlistId);
	movedAtThePlayer(player);

	// In React's order: the view lets go of the old key, asks for the new one,
	// then subscribes to it.
	stopHeld();
	const key = loadPlaylist(ORIGIN, playlistId, MOVED, 4);
	let notified = 0;
	const stopMoved = subscribePlaylist(key, () => {
		notified += 1;
	});
	t.after(stopMoved);
	await settled();
	assert.equal(player.rowReads, 1);

	assert.equal(carryPlaylist(playlistId, STRUCTURE, MOVED, ORDER), true);
	release();
	await settled();

	assert.equal(player.rowReads, 1);
	assert.ok(notified > 0, "the view at the new structure was never told");
	assert.equal(playlistSnapshot(key).isLoading, false);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
	assert.deepEqual(addressesIn(key, playlistId), CARRIED_ADDRESSES);
});

test("a load asked for while held is read once released when nothing was carried", async (t) => {
	const playlistId = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b16";
	const player = playerHolding(t, FOUR_ROWS());
	await loaded(playlistId, 4);

	const release = holdPlaylistLoads(playlistId);
	movedAtThePlayer(player);
	const key = loadPlaylist(ORIGIN, playlistId, MOVED, 4);
	await settled();
	assert.equal(player.rowReads, 1);

	release();
	await settled();

	assert.equal(player.rowReads, 2);
	assert.equal(playlistSnapshot(key).loaded, 4);
	assert.deepEqual(shownIn(key), CARRIED_TITLES);
});

test("holding one playlist's loads leaves another playlist's read alone", async (t) => {
	const held = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b17";
	const other = "6f1d3d1e-0b0a-4c4a-9d7a-8f2f6c9a1b18";
	const player = playerHolding(t, FOUR_ROWS());

	const release = holdPlaylistLoads(held);
	t.after(release);
	await loaded(other, 4);

	assert.equal(player.rowReads, 1);
});

// The component library entry is one per origin and outlives a test, so each
// test reads the library from an origin of its own.
let origins = 0;
const libraryOrigin = () => {
	origins += 1;
	return `http://library-${origins}.invalid:8881`;
};

const SNAPSHOT = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "fixtures/library.jlib"),
);

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

type Build = NonNullable<StateDocument["library"]["build"]>;

type Export =
	| { kind: "snapshot" }
	| { kind: "held"; until: Promise<void> }
	| { kind: "building" }
	| { kind: "unreachable" }
	| { kind: "refused"; status: number; body?: unknown };

const SNAPSHOT_EXPORT: Export = { kind: "snapshot" };
const BUILDING: Export = { kind: "building" };
const UNREACHABLE: Export = { kind: "unreachable" };
const refusedWith = (status: number, body?: unknown): Export => ({
	kind: "refused",
	status,
	body,
});
const SERVER_ERROR = refusedWith(500);

interface LibraryPlayer {
	exports: Export[];
	exportsAsked: number;
	build: Build | null;
	structure: number;
	stateFailures: number;
}

const answerExport = (answer: Export) => {
	switch (answer.kind) {
		case "snapshot":
			return Promise.resolve(new Response(SNAPSHOT));
		case "held":
			return answer.until.then(() => new Response(SNAPSHOT));
		case "building":
			return Promise.resolve(new Response(null, { status: 202 }));
		case "unreachable":
			return Promise.reject(new TypeError("fetch failed"));
		case "refused":
			return Promise.resolve(
				answer.body === undefined
					? new Response(null, { status: answer.status })
					: Response.json(answer.body, { status: answer.status }),
			);
	}
};

const libraryPlayer = (t: TestContext, exports: Export[]): LibraryPlayer => {
	const player: LibraryPlayer = {
		exports,
		exportsAsked: 0,
		build: null,
		structure: 0,
		stateFailures: 0,
	};

	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	t.after(() => {
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	globalThis.fetch = ((request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/api/library/export") {
			const at = Math.min(player.exportsAsked, player.exports.length - 1);
			player.exportsAsked += 1;
			return answerExport(player.exports[at]);
		}
		if (pathname === "/api/state" && player.stateFailures > 0) {
			player.stateFailures -= 1;
			return Promise.reject(new TypeError("fetch failed"));
		}
		if (pathname === "/api/state")
			return Promise.resolve(
				Response.json({
					library: {
						ready: false,
						structure: player.structure,
						revision: 0,
						trackCount: 0,
						columns: [],
						build: player.build,
					},
				}),
			);
		return Promise.reject(new Error(`unexpected request: ${pathname}`));
	}) as typeof fetch;

	return player;
};

// A failed export resolves over microtask turns and never over a timer.
const SETTLE_STEPS = 20;

const settle = async () => {
	for (let step = 0; step < SETTLE_STEPS; step += 1) await flush();
};

const readLibrary = async (t: TestContext, origin: string) => {
	const key = loadComponentLibrary(origin);
	const seen: PlaylistSnapshot[] = [];
	const stop = subscribePlaylist(key, () => {
		seen.push(playlistSnapshot(key));
	});
	t.after(stop);
	await settle();
	return { key, seen };
};

const tickAt = async (origin: string, at: number) => {
	mock.timers.setTime(at);
	await store.retryFailedLibraryRead(origin);
	await settle();
};

const tryAgainAt = async (origin: string, at: number) => {
	mock.timers.setTime(at);
	await store.tryLibraryAgain(origin);
	await settle();
};

test("a failed library read holds the component's reason and detail, and no translated text", async (t) => {
	const origin = libraryOrigin();
	libraryPlayer(t, [
		refusedWith(413, { error: "library too large", detail: "30441 tracks" }),
	]);

	const { key } = await readLibrary(t, origin);
	const snapshot = playlistSnapshot(key);

	assert.equal(snapshot.isLoading, false);
	assert.deepEqual(
		{ reason: snapshot.failure?.reason, detail: snapshot.failure?.detail },
		{ reason: "too-large", detail: "library too large: 30441 tracks" },
	);
	assert.equal(snapshot.error, null);
	// The phrase is chosen when the notice is drawn, so a language switch
	// reaches a failure already held.
	const english = en["library.readTooLarge"];
	for (const [field, value] of Object.entries(snapshot)) {
		const text = value instanceof Error ? value.message : JSON.stringify(value);
		assert.ok(
			!text?.includes(english),
			`${field} holds the translated message`,
		);
	}
});

test("while the library is being built, loaded and total follow the build's progress", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [BUILDING]);
	player.build = { phase: "formatting", formatted: 8_192, total: 20_000 };

	const { key } = await readLibrary(t, origin);
	const wind = async (ms: number) => {
		for (let passed = 0; passed < ms; passed += 100) {
			mock.timers.tick(100);
			await settle();
		}
	};

	await wind(2_000);
	assert.deepEqual(
		(({ loaded, total, isLoading }) => ({ loaded, total, isLoading }))(
			playlistSnapshot(key),
		),
		{ loaded: 8_192, total: 20_000, isLoading: true },
	);

	player.build = { phase: "formatting", formatted: 16_384, total: 20_000 };
	await wind(10_000);
	assert.equal(playlistSnapshot(key).loaded, 16_384);
	assert.equal(playlistSnapshot(key).total, 20_000);
});

// Consecutive failures alternate between two transient reasons, so the wait
// is shown to grow with the run of failures rather than per reason.
test("a transient failure is asked again on the first tick 5 s after it, and the wait doubles after each further one up to 60 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
		UNREACHABLE,
		SERVER_ERROR,
	]);
	await readLibrary(t, origin);
	assert.equal(player.exportsAsked, 1);

	const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
	let failedAt = 0;
	for (const [retry, wait] of waits.entries()) {
		await tickAt(origin, failedAt + wait - 1);
		assert.equal(
			player.exportsAsked,
			retry + 1,
			`asked again ${wait - 1} ms after failure ${retry + 1}, before its ${wait} ms wait`,
		);

		await tickAt(origin, failedAt + wait);
		assert.equal(
			player.exportsAsked,
			retry + 2,
			`not asked again ${wait} ms after failure ${retry + 1}`,
		);
		failedAt += wait;
	}
});

test("a read that succeeds puts the wait before the next transient failure is retried back to 5 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [
		SERVER_ERROR,
		SERVER_ERROR,
		SNAPSHOT_EXPORT,
		SERVER_ERROR,
	]);
	const { key } = await readLibrary(t, origin);
	await tickAt(origin, 5_000);
	await tickAt(origin, 15_000);
	assert.equal(player.exportsAsked, 3);
	assert.equal(playlistSnapshot(key).failure, null);

	// A moved structure is what makes the store export again after a success.
	const failedAt = 16_000;
	mock.timers.setTime(failedAt);
	await recheckComponentLibrary(origin, {
		structure: playlistSnapshot(key).structure + 1,
		revision: 0,
	});
	await settle();
	assert.equal(player.exportsAsked, 4);
	assert.equal(playlistSnapshot(key).failure?.reason, "failed");

	await tickAt(origin, failedAt + RETRY_MIN_MS - 1);
	assert.equal(player.exportsAsked, 4);
	await tickAt(origin, failedAt + RETRY_MIN_MS);
	assert.equal(
		player.exportsAsked,
		5,
		"the wait after a success carried on from the failures before it",
	);
});

test("a read refused, too large or unavailable is never asked again on its own", async (t) => {
	const refusals = [
		{ status: 400, reason: "refused" },
		{ status: 413, reason: "too-large" },
		{ status: 503, reason: "unavailable" },
	];
	const player = libraryPlayer(t, []);
	let at = 0;
	for (const { status, reason } of refusals) {
		const origin = libraryOrigin();
		player.exports = [refusedWith(status)];
		player.exportsAsked = 0;
		mock.timers.setTime(at);
		const { key } = await readLibrary(t, origin);
		assert.equal(playlistSnapshot(key).failure?.reason, reason);

		for (const wait of [RETRY_MIN_MS, RETRY_MAX_MS, 60 * RETRY_MAX_MS])
			await tickAt(origin, at + wait);
		assert.equal(player.exportsAsked, 1, `${reason} was asked again`);
		at += 60 * RETRY_MAX_MS;
	}
});

test("Try again after a transient failure asks at once, reads as reading while it runs, and puts the next wait back to 5 s", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [SERVER_ERROR]);
	const { key, seen } = await readLibrary(t, origin);
	// A second failure, so an automatic wait left running would be 10 s.
	await tickAt(origin, RETRY_MIN_MS);
	assert.equal(player.exportsAsked, 2);

	const pressedAt = RETRY_MIN_MS + 1_000;
	seen.length = 0;
	await tryAgainAt(origin, pressedAt);
	assert.equal(player.exportsAsked, 3, "Try again asked nothing");
	assert.ok(
		seen.some((snapshot) => snapshot.isLoading && snapshot.failure === null),
		"the read Try again started never read as reading",
	);
	assert.equal(playlistSnapshot(key).failure?.reason, "failed");

	await tickAt(origin, pressedAt + RETRY_MIN_MS - 1);
	assert.equal(player.exportsAsked, 3);
	await tickAt(origin, pressedAt + RETRY_MIN_MS);
	assert.equal(
		player.exportsAsked,
		4,
		"the wait after Try again carried on from the failures before it",
	);
});

test("Try again after a failure that is not transient asks nothing", async (t) => {
	const origin = libraryOrigin();
	const player = libraryPlayer(t, [refusedWith(413)]);
	const { key } = await readLibrary(t, origin);

	await tryAgainAt(origin, 1_000);

	assert.equal(player.exportsAsked, 1);
	assert.equal(playlistSnapshot(key).failure?.reason, "too-large");
});

// `GET /api/state` answers `304` once the player settles, so a rebuild noticed while the first read
// was still in flight has no later poll to announce it again: the look back after that read is the
// only one there will be, and a failed one has to be asked again.
test("a rebuild noticed mid-read is looked for again on a later tick when the first look back fails", async (t) => {
	const origin = libraryOrigin();
	let release = () => {};
	const until = new Promise<void>((resolve) => {
		release = resolve;
	});
	const player = libraryPlayer(t, [{ kind: "held", until }, SNAPSHOT_EXPORT]);
	await readLibrary(t, origin);

	const rebuilt = { structure: 424_242, revision: 0 };
	player.structure = rebuilt.structure;
	player.stateFailures = 1;
	await recheckComponentLibrary(origin, rebuilt);
	release();
	await settle();
	assert.equal(player.exportsAsked, 1);

	store.libraryPollFollower.answered(origin);
	await settle();
	assert.equal(player.exportsAsked, 2, "the rebuild was never read");
});
