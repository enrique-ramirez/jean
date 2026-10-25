import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import * as librarySource from "../../src/domain/track/librarySource.ts";
import { keptOrder, moveOrder } from "../../src/domain/track/playlistPatch.ts";
import {
	createRowWindows,
	type RowsList,
	type RowsTransport,
	type RowWindows,
	WINDOW_ROWS,
} from "../../src/domain/track/rowWindows.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";

type PlaylistPage = components["schemas"]["PlaylistPage"];
type PlaylistRow = components["schemas"]["PlaylistRow"];
type PlaylistList = Extract<RowsList, { kind: "playlist" }>;

const { windowedPlaylistSourceOf } = librarySource;

const PACING_MS = 100;
const LONG_AFTER_MS = 120_000;
const VIEWPORT_ROWS = 40;

const LENGTH = 3000;
const BEFORE = "7";
const AFTER = "8";

const playlist = (
	id = "p1",
	structure = BEFORE,
	length = LENGTH,
): PlaylistList => ({ kind: "playlist", id, structure, length });

interface Ask {
	id: string;
	structure: string;
	offset: number;
	count: number;
	isOpen: boolean;
	land: (result: unknown) => void;
}

const span = (start: number, end: number) =>
	Array.from({ length: end - start }, (_, step) => start + step);

const rig = (t: TestContext) => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const now = mock.method(performance, "now", () => Date.now());
	t.after(() => {
		mock.timers.reset();
		now.mock.restore();
	});
	const asks: Ask[] = [];
	const transport: RowsTransport = {
		readRows: () => new Promise(() => {}),
		readPage: (ask) =>
			new Promise((resolve) => {
				const sent: Ask = {
					...ask,
					isOpen: true,
					land: (result) => {
						sent.isOpen = false;
						resolve(result as never);
					},
				};
				asks.push(sent);
			}),
	};
	const windows = createRowWindows(transport);
	return {
		windows,
		asks,
		open: () => {
			const open = asks.filter((ask) => ask.isOpen);
			assert.equal(open.length, 1, "expected exactly one page asked");
			return open[0];
		},
	};
};
type Rig = ReturnType<typeof rig>;

const SETTLE_STEPS = 20;
const settle = async () => {
	for (let step = 0; step < SETTLE_STEPS; step += 1)
		await new Promise((resolve) => setImmediate(resolve));
};
const advance = async (ms: number) => {
	mock.timers.tick(ms);
	await settle();
};

const titleAt = (id: string, structure: string, position: number) =>
	`${id}@${structure} row ${position}`;

const rowAt = (
	id: string,
	structure: string,
	position: number,
): PlaylistRow => ({
	columns: [titleAt(id, structure, position)],
	libraryPath: position % 3 === 0 ? null : `Artist/Album/${position}.flac`,
	subsong: 0,
});

const pageFor = (
	ask: Ask,
	row: (position: number) => PlaylistRow = (position) =>
		rowAt(ask.id, ask.structure, position),
): PlaylistPage => ({
	structure: ask.structure,
	revision: "1",
	totalCount: LENGTH,
	items: span(ask.offset, ask.offset + ask.count).map(row),
});

const answer = (ask: Ask, row?: (position: number) => PlaylistRow) =>
	ask.land({ ok: true, page: pageFor(ask, row) });

const view = async ({ windows }: Rig, list: PlaylistList, first: number) => {
	windows.view(list, first, first + VIEWPORT_ROWS, 0);
	await advance(0);
};

const drawWindow = async (made: Rig, list: PlaylistList, window: number) => {
	await view(made, list, window * WINDOW_ROWS + 1000);
	await advance(PACING_MS);
	answer(made.open());
	await settle();
	await advance(PACING_MS);
};

const shown = (windows: RowWindows, list: PlaylistList, position: number) => {
	const held = windows.at(list, position);
	if (!held) return null;
	assert.equal(held.kind, "playlist");
	if (held.kind !== "playlist") return null;
	return held.page.items[held.row].columns[0] ?? null;
};

const retitled = (position: number): PlaylistRow => ({
	columns: [`retitled ${position}`],
	libraryPath: `Artist/Album/${position}.flac`,
	subsong: 0,
});

test("a change to a row of a held window draws in place, and leaves the window held and the rows beside it as they were", async (t) => {
	const made = rig(t);
	const list = playlist();
	await drawWindow(made, list, 0);
	await drawWindow(made, list, 1);
	const asked = made.asks.length;
	let told = 0;
	t.after(made.windows.subscribe(() => (told += 1)));

	made.windows.patch(list, 5, retitled(5));
	made.windows.patch(list, 2050, retitled(2050));

	assert.ok(told > 0, "a row changed and nobody was told");
	assert.equal(shown(made.windows, list, 5), "retitled 5");
	assert.equal(shown(made.windows, list, 2050), "retitled 2050");
	assert.equal(shown(made.windows, list, 4), titleAt("p1", BEFORE, 4));
	assert.equal(shown(made.windows, list, 6), titleAt("p1", BEFORE, 6));
	assert.equal(shown(made.windows, list, 2049), titleAt("p1", BEFORE, 2049));

	await view(made, list, 0);
	await view(made, list, WINDOW_ROWS + 1000);
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, asked);
});

test("a change to a row no held window covers keeps nothing, and that window is asked once it is viewed", async (t) => {
	const made = rig(t);
	const list = playlist();
	await drawWindow(made, list, 0);

	made.windows.patch(list, 2500, retitled(2500));

	assert.equal(made.windows.at(list, 2500), null);
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 1, "a change outside the held windows asked");

	await view(made, list, 2480);
	await advance(PACING_MS);
	const ask = made.open();
	assert.equal(ask.offset, WINDOW_ROWS);
	assert.equal(ask.count, LENGTH - WINDOW_ROWS);
	answer(ask);
	await settle();
	assert.equal(shown(made.windows, list, 2500), titleAt("p1", BEFORE, 2500));
});

test("a change to one playlist leaves another playlist's rows at the same position alone", async (t) => {
	const made = rig(t);
	const one = playlist("p1");
	const other = playlist("p2");
	await drawWindow(made, one, 0);
	await drawWindow(made, other, 0);

	made.windows.patch(one, 5, retitled(5));

	assert.equal(shown(made.windows, one, 5), "retitled 5");
	assert.equal(shown(made.windows, other, 5), titleAt("p2", BEFORE, 5));
});

const expectCarried = (
	windows: RowWindows,
	order: ArrayLike<number>,
	isHeld: (old: number) => boolean,
) => {
	const after = playlist("p1", AFTER, order.length);
	const wrong: string[] = [];
	for (let position = 0; position < order.length; position += 1) {
		const old = order[position];
		const expected = isHeld(old) ? titleAt("p1", BEFORE, old) : null;
		const drawn = shown(windows, after, position);
		if (drawn !== expected)
			wrong.push(`${position}: drew ${drawn}, expected ${expected}`);
	}
	assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} positions wrong`);
};

const onlyTheFirstWindow = (old: number) => old < WINDOW_ROWS;

const ROTATION = 1000;

test("a move of held rows through Jean's own write draws every row at its new place and asks nothing", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist(), 0);
	const order = moveOrder(LENGTH, [3, 4], 10);
	assert.ok(order);

	made.windows.carry("p1", BEFORE, AFTER, order);

	expectCarried(made.windows, order, onlyTheFirstWindow);
	await view(made, playlist("p1", AFTER), 0);
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 1, "a carried window was read again");
});

test("a row moved from a pending position stays pending at its new place, and its window is asked when viewed while the carried rows draw", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist(), 0);
	const order = moveOrder(LENGTH, [2500], 5);
	assert.ok(order);

	made.windows.carry("p1", BEFORE, AFTER, order);

	expectCarried(made.windows, order, onlyTheFirstWindow);
	const after = playlist("p1", AFTER);
	assert.equal(
		shown(made.windows, after, WINDOW_ROWS),
		titleAt("p1", BEFORE, WINDOW_ROWS - 1),
	);

	await view(made, after, 0);
	await advance(PACING_MS);
	const ask = made.open();
	assert.equal(ask.structure, AFTER);
	assert.equal(ask.offset, 0);
	assert.equal(ask.count, WINDOW_ROWS);
	assert.equal(made.windows.at(after, 5), null);
	assert.equal(shown(made.windows, after, 6), titleAt("p1", BEFORE, 5));

	answer(ask);
	await settle();
	assert.equal(shown(made.windows, after, 5), titleAt("p1", AFTER, 5));
});

test("a removal through Jean's own write closes the gap over held rows, and the row it pulls up from a pending position stays pending", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist(), 0);
	const order = keptOrder(LENGTH, [100]);
	assert.ok(order);

	made.windows.carry("p1", BEFORE, AFTER, order);

	expectCarried(made.windows, order, onlyTheFirstWindow);
	const after = playlist("p1", AFTER, order.length);
	assert.equal(shown(made.windows, after, 100), titleAt("p1", BEFORE, 101));
	assert.equal(made.windows.at(after, WINDOW_ROWS - 1), null);
});

test("a sort through Jean's own write carries every held row to the place the player's order gives it, across windows", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist(), 0);
	// The player answers a sort with its order. A rotation stands in for any, and unlike a reversal
	// it is not its own inverse, so an order read backwards draws the wrong rows.
	const order = Int32Array.from(
		span(0, LENGTH),
		(position) => (position + ROTATION) % LENGTH,
	);

	made.windows.carry("p1", BEFORE, AFTER, order);

	expectCarried(made.windows, order, onlyTheFirstWindow);
});

test("a carry moves one playlist's rows and leaves another's at the same structure alone", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist("p1"), 0);
	await drawWindow(made, playlist("p2"), 0);
	const order = moveOrder(LENGTH, [0], 20);
	assert.ok(order);

	made.windows.carry("p1", BEFORE, AFTER, order);

	assert.equal(
		shown(made.windows, playlist("p2"), 0),
		titleAt("p2", BEFORE, 0),
	);
	assert.equal(made.windows.at(playlist("p2", AFTER), 0), null);
});

test("a structure no write carried to holds none of the carried rows, and its viewport is asked there", async (t) => {
	const made = rig(t);
	await drawWindow(made, playlist(), 0);
	const order = moveOrder(LENGTH, [3], 10);
	assert.ok(order);
	made.windows.carry("p1", BEFORE, AFTER, order);

	const elsewhere = playlist("p1", "9");
	for (const position of [0, 10, 2047])
		assert.equal(made.windows.at(elsewhere, position), null);

	await view(made, elsewhere, 0);
	await advance(PACING_MS);
	const ask = made.open();
	assert.equal(ask.structure, "9");
	assert.equal(ask.offset, 0);
});

const ORIGIN = "http://player.invalid";

// In foobar2000 every track of one cue sheet is a subsong of one file, so the path alone cannot
// tell two of its rows apart, and a change that swaps them must carry the subsong with the row.
test("a change that swaps two tracks of one cue sheet leaves each row addressed by the track it shows", async (t) => {
	const made = rig(t);
	const list = playlist();
	const source = windowedPlaylistSourceOf({
		windows: made.windows,
		origin: ORIGIN,
		listNow: () => list,
	});
	const CUE = "Artist/Album/side.cue";
	const side = (title: string, subsong: number): PlaylistRow => ({
		columns: [title],
		libraryPath: CUE,
		subsong,
	});
	await view(made, list, 0);
	await advance(PACING_MS);
	answer(made.open(), (position) =>
		position === 0
			? side("Side A", 1)
			: position === 1
				? side("Side B", 2)
				: rowAt("p1", BEFORE, position),
	);
	await settle();

	made.windows.patch(list, 0, side("Side B", 2));
	made.windows.patch(list, 1, side("Side A", 1));

	assert.equal(shown(made.windows, list, 0), "Side B");
	assert.equal(shown(made.windows, list, 1), "Side A");
	assert.deepEqual(source.address(0), {
		kind: "library",
		track: CUE,
		subsong: 2,
	});
	assert.deepEqual(source.address(1), {
		kind: "library",
		track: CUE,
		subsong: 1,
	});
});

test("a playlist row the library holds is addressed by its library path first, and one it does not hold, or one still pending, by its position at the structure it was read at", async (t) => {
	const made = rig(t);
	let list = playlist();
	const source = windowedPlaylistSourceOf({
		windows: made.windows,
		origin: ORIGIN,
		listNow: () => list,
	});
	await drawWindow(made, list, 0);

	const at = (index: number, structure = BEFORE) => ({
		kind: "playlist" as const,
		playlist: "p1",
		index,
		structure,
	});
	assert.equal(source.playlistId, "p1");
	assert.deepEqual(source.addresses(1), [
		{ kind: "library", track: "Artist/Album/1.flac", subsong: 0 },
		at(1),
	]);
	assert.deepEqual(source.addresses(3), [at(3)]);
	assert.deepEqual(source.address(3), at(3));
	assert.deepEqual(source.addresses(2500), [at(2500)]);

	const order = moveOrder(LENGTH, [1], 7);
	assert.ok(order);
	made.windows.carry("p1", BEFORE, AFTER, order);
	list = playlist("p1", AFTER);
	assert.deepEqual(source.addresses(7), [
		{ kind: "library", track: "Artist/Album/1.flac", subsong: 0 },
		at(7, AFTER),
	]);
});

test("a pending playlist row is queued by its position, as a held one is", async (t) => {
	const made = rig(t);
	const list = playlist();
	const source = windowedPlaylistSourceOf({
		windows: made.windows,
		origin: ORIGIN,
		listNow: () => list,
	});
	await drawWindow(made, list, 0);

	assert.deepEqual(await source.queueTargets([5, 2500]), {
		kind: "rows",
		targets: [
			{ playlistId: "p1", itemIndex: 5 },
			{ playlistId: "p1", itemIndex: 2500 },
		],
	});
});
