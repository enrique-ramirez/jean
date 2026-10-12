import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { librarySourceOf } from "../../src/domain/track/librarySource.ts";
import {
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
import type { TrackColumns } from "../../src/shared/api/types.ts";

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
