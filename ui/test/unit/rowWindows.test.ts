import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";

import {
	createRowWindows,
	HELD_WINDOWS,
	PREFETCH_ROWS,
	type RowsList,
	type RowsTransport,
	type RowWindows,
	WINDOW_ROWS,
} from "../../src/domain/track/rowWindows.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import { jlibColumn } from "../../src/shared/api/jlib.ts";
import type {
	RowSet,
	RowsFailure,
	RowsWindow,
} from "../../src/shared/api/libraryRows.ts";

type PlaylistPage = components["schemas"]["PlaylistPage"];

const TITLE = "%title%";
const PACING_MS = 100;
const LONG_AFTER_MS = 120_000;
const STRUCTURE = 41;
const WINDOWS = 100;

const allMusic = (
	length = WINDOWS * WINDOW_ROWS,
	structure = STRUCTURE,
): RowsList => ({
	kind: "library",
	id: "all music",
	structure,
	length,
	ordinals: null,
});

const albumOf = (ordinals: number[]): RowsList => ({
	kind: "library",
	id: "album",
	structure: STRUCTURE,
	length: ordinals.length,
	ordinals: Int32Array.from(ordinals),
});

const playlistOf = (id: string, structure = "7", length = 100): RowsList => ({
	kind: "playlist",
	id,
	structure,
	length,
});

interface Ask {
	kind: "rows" | "page";
	id: string | null;
	structure: number | string;
	positions: number[];
	sentAt: number;
	isOpen: boolean;
	land: (result: unknown) => void;
}

interface Transport {
	transport: RowsTransport;
	asks: Ask[];
	overlaps: number;
}

const ordinalsOf = (set: RowSet) =>
	"ordinals" in set
		? [...set.ordinals]
		: set.runs.flatMap(([start, length]) =>
				Array.from({ length }, (_, step) => start + step),
			);

const span = (start: number, end: number) =>
	Array.from({ length: end - start }, (_, step) => start + step);

const windowSpan = (window: number, length = WINDOWS * WINDOW_ROWS) =>
	span(window * WINDOW_ROWS, Math.min(length, (window + 1) * WINDOW_ROWS));

const fakeTransport = (): Transport => {
	const made: Transport = {
		asks: [],
		overlaps: 0,
		transport: {
			readRows: (ask) => send("rows", null, ask.structure, ordinalsOf(ask.set)),
			readPage: (ask) =>
				send(
					"page",
					ask.id,
					ask.structure,
					span(ask.offset, ask.offset + ask.count),
				),
		},
	};
	function send<Result>(
		kind: Ask["kind"],
		id: string | null,
		structure: number | string,
		positions: number[],
	) {
		if (made.asks.some((ask) => ask.isOpen)) made.overlaps += 1;
		return new Promise<Result>((resolve) => {
			const ask: Ask = {
				kind,
				id,
				structure,
				positions,
				sentAt: Date.now(),
				isOpen: true,
				land: (result) => {
					ask.isOpen = false;
					resolve(result as Result);
				},
			};
			made.asks.push(ask);
		});
	}
	return made;
};

const titleOf = (ordinal: number) => `title ${ordinal}`;
const playlistTitleOf = (id: string, position: number) =>
	`${id} row ${position}`;

const textColumn = (values: string[]) =>
	jlibColumn(
		Uint32Array.from(values, (_, id) => id),
		{ count: values.length, of: (id) => values[id] },
		{ distinct: values.length, hasUnresolved: false, allUnresolved: false },
	);

const rowsWindow = (ask: Ask): RowsWindow => {
	const spine = textColumn(ask.positions.map(() => ""));
	return {
		structure: ask.structure as number,
		revision: 1,
		trackCount: WINDOWS * WINDOW_ROWS,
		rows: ask.positions.length,
		ordinals: Int32Array.from(ask.positions),
		columns: new Map([[TITLE, textColumn(ask.positions.map(titleOf))]]),
		spine: { directory: spine, filename: spine, subsong: spine },
	};
};

const playlistPage = (ask: Ask): PlaylistPage => ({
	structure: String(ask.structure),
	revision: "1",
	totalCount: ask.positions.length,
	items: ask.positions.map((position) => ({
		columns: [playlistTitleOf(ask.id ?? "", position)],
		libraryPath: null,
		subsong: 0,
	})),
});

const answered = (ask: Ask) =>
	ask.land(
		ask.kind === "rows"
			? { ok: true, window: rowsWindow(ask) }
			: { ok: true, page: playlistPage(ask) },
	);

const failed = (
	ask: Ask,
	failure: Partial<RowsFailure> & Pick<RowsFailure, "reason">,
) =>
	ask.land({
		ok: false,
		detail: "",
		retryAfterMs: null,
		structureMoved: false,
		building: null,
		...failure,
	} satisfies RowsFailure);

const SETTLE_STEPS = 20;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async () => {
	for (let step = 0; step < SETTLE_STEPS; step += 1) await flush();
};

const advance = async (ms: number) => {
	mock.timers.tick(ms);
	await settle();
};

const advanceTo = (at: number) => {
	assert.ok(at >= Date.now(), `the clock is past ${at} ms already`);
	return advance(at - Date.now());
};

interface Rig extends Transport {
	store: RowWindows;
	open: () => Ask;
}

const rig = (t: TestContext): Rig => {
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const clock = mock.method(performance, "now", () => Date.now());
	t.after(() => {
		clock.mock.restore();
		mock.timers.reset();
	});
	const made = fakeTransport();
	return {
		...made,
		store: createRowWindows(made.transport),
		open: () => {
			const open = made.asks.filter((ask) => ask.isOpen);
			assert.equal(open.length, 1, "expected exactly one ask out");
			return open[0];
		},
	};
};

const MIDDLE = 1000;
const VIEWPORT_ROWS = 40;

const viewAt = (
	{ store }: Rig,
	list: RowsList,
	first: number,
	direction: -1 | 0 | 1,
) => {
	store.view(list, first, first + VIEWPORT_ROWS, direction);
	return advance(0);
};

const draw = async (made: Rig, list: RowsList, window: number) => {
	await viewAt(made, list, window * WINDOW_ROWS + MIDDLE, 1);
	await advance(PACING_MS);
	answered(made.open());
	await settle();
	await advance(PACING_MS);
};

const titleAt = (store: RowWindows, list: RowsList, position: number) => {
	const held = store.at(list, position);
	if (!held) return null;
	if (held.kind === "playlist")
		return held.page.items[held.row].columns[0] ?? null;
	return held.window.columns.get(TITLE)?.at(held.row) ?? null;
};

test("a window is the criterion's 2048 rows, prefetched within 512 of its edge, and 32 are held", () => {
	assert.equal(WINDOW_ROWS, 2048);
	assert.equal(PREFETCH_ROWS, 512);
	assert.equal(HELD_WINDOWS, 32);
});

test("opening a list asks one window, the one under the viewport, aligned to the window size, and nothing else", async (t) => {
	const made = rig(t);
	const list = allMusic();
	let told = 0;
	t.after(made.store.subscribe(() => (told += 1)));

	await viewAt(made, list, 5000, 0);

	assert.equal(made.asks.length, 1);
	const [ask] = made.asks;
	assert.equal(ask.kind, "rows");
	assert.equal(ask.structure, STRUCTURE);
	assert.deepEqual(ask.positions, windowSpan(2));
	assert.equal(made.store.at(list, 5000), null, "a pending row answered");

	answered(ask);
	await settle();
	await advance(LONG_AFTER_MS);

	assert.equal(made.asks.length, 1);
	assert.ok(told > 0, "a window landed and nobody was told");
	assert.equal(titleAt(made.store, list, 5000), titleOf(5000));
	assert.equal(titleAt(made.store, list, 2 * WINDOW_ROWS), titleOf(4096));
	assert.equal(made.store.at(list, 3 * WINDOW_ROWS), null);
});

test("viewing again inside a window already asked asks nothing, while it is out and once it has landed", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await viewAt(made, list, 2 * WINDOW_ROWS + MIDDLE, 0);
	await advance(PACING_MS);
	await viewAt(made, list, 2 * WINDOW_ROWS + 900, -1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 1);

	answered(made.open());
	await settle();
	await advance(PACING_MS);
	await viewAt(made, list, 2 * WINDOW_ROWS + 1100, 1);
	await advance(LONG_AFTER_MS);

	assert.equal(made.asks.length, 1);
});

test("scrolling forward to within the prefetch distance of a window's end asks the next window and no other", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await draw(made, list, 0);

	await viewAt(made, list, 1400, 1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 1, "asked before the prefetch distance");

	await viewAt(made, list, 1600, 1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(1));

	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 2);
});

test("scrolling backward to within the prefetch distance of a window's start asks the window before it, and nearing the end while scrolling back asks nothing", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await draw(made, list, 3);

	await viewAt(made, list, 3 * WINDOW_ROWS + 1600, -1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 1);

	await viewAt(made, list, 3 * WINDOW_ROWS + 300, -1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(2));

	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 2);
});

test("the last window stops at the list's length, and no window is asked past either end", async (t) => {
	const made = rig(t);
	const length = 3000;
	const list = allMusic(length);
	await draw(made, list, 0);

	await viewAt(made, list, 10, -1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 1, "asked a window before the first");

	await viewAt(made, list, 1600, 1);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, span(WINDOW_ROWS, length));
	answered(made.open());
	await settle();
	await advance(PACING_MS);

	await viewAt(made, list, length - VIEWPORT_ROWS - 1, 1);
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 2, "asked a window past the last");
});

test("a fling across five windows while one is out asks, once it lands, only the window now under the viewport", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await viewAt(made, list, 0, 0);
	const first = made.open();

	for (let window = 1; window <= 5; window += 1) {
		await advance(16);
		await viewAt(made, list, window * WINDOW_ROWS + MIDDLE, 1);
	}
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 1);

	answered(first);
	await settle();
	await advance(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(5));

	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 2);
});

test("a drag of the scrollbar to three quarters asks the window there first, then the next one it nears", async (t) => {
	const made = rig(t);
	const length = 202_000;
	const list = allMusic(length);
	await viewAt(made, list, 0, 0);
	const first = made.open();

	for (const share of [0.1, 0.3, 0.5]) {
		await advance(16);
		await viewAt(made, list, Math.round(length * share), 1);
	}
	await advance(16);
	await viewAt(made, list, length * 0.75, 1);

	answered(first);
	await settle();
	await advance(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(73, length));

	answered(made.open());
	await settle();
	await advance(PACING_MS);
	assert.equal(made.asks.length, 3);
	assert.deepEqual(made.asks[2].positions, windowSpan(74, length));

	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 3);
});

test("a library list and a playlist on screen together never have two asks out at once", async (t) => {
	const made = rig(t);
	const playlist = playlistOf("p1");
	await viewAt(made, allMusic(), MIDDLE, 0);
	await viewAt(made, playlist, 0, 0);
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 1);

	answered(made.open());
	await settle();
	await advance(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.equal(made.asks[1].kind, "page");
	assert.equal(made.overlaps, 0);
});

test("the next ask goes out no sooner than 100 ms after the last was sent, however soon that one was answered", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await viewAt(made, list, MIDDLE, 0);
	await advance(10);
	answered(made.open());
	await settle();

	await viewAt(made, list, 7 * WINDOW_ROWS + MIDDLE, 0);
	await advanceTo(PACING_MS - 1);
	assert.equal(made.asks.length, 1, "asked again inside 100 ms");

	await advanceTo(PACING_MS);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(7));
	assert.ok(made.asks[1].sentAt - made.asks[0].sentAt >= PACING_MS);
});

test("drawing one window more than are held drops the least recently drawn", async (t) => {
	const made = rig(t);
	const list = allMusic();
	for (let window = 0; window < HELD_WINDOWS; window += 1)
		await draw(made, list, window);
	await draw(made, list, HELD_WINDOWS);

	assert.equal(made.store.at(list, MIDDLE), null);
	for (let window = 1; window <= HELD_WINDOWS; window += 1) {
		const position = window * WINDOW_ROWS + MIDDLE;
		assert.equal(titleAt(made.store, list, position), titleOf(position));
	}
});

test("a window drawn again counts as drawn then, so the one drawn longest ago is dropped instead", async (t) => {
	const made = rig(t);
	const list = allMusic();
	for (let window = 0; window < HELD_WINDOWS; window += 1)
		await draw(made, list, window);
	await viewAt(made, list, MIDDLE, -1);
	await advance(PACING_MS);
	assert.equal(made.asks.length, HELD_WINDOWS, "a held window was asked");

	await draw(made, list, HELD_WINDOWS);

	assert.equal(titleAt(made.store, list, MIDDLE), titleOf(MIDDLE));
	assert.equal(made.store.at(list, WINDOW_ROWS + MIDDLE), null);
});

const drawPlaylist = async (made: Rig, playlist: RowsList) => {
	await viewAt(made, playlist, 0, 0);
	answered(made.open());
	await settle();
	await advance(PACING_MS);
};

test("a playlist window still on screen is never dropped, though it is the least recently drawn", async (t) => {
	const made = rig(t);
	const library = allMusic();
	const playlist = playlistOf("p1");
	await drawPlaylist(made, playlist);

	for (let window = 0; window < HELD_WINDOWS; window += 1)
		await draw(made, library, window);

	assert.equal(titleAt(made.store, playlist, 0), playlistTitleOf("p1", 0));
	assert.equal(made.store.at(library, MIDDLE), null);
	assert.equal(
		titleAt(made.store, library, WINDOW_ROWS + MIDDLE),
		titleOf(WINDOW_ROWS + MIDDLE),
	);
});

test("a playlist window whose list has left the screen is dropped first once it is the least recently drawn", async (t) => {
	const made = rig(t);
	const library = allMusic();
	const playlist = playlistOf("p1");
	await drawPlaylist(made, playlist);
	made.store.leave(playlist);

	for (let window = 0; window < HELD_WINDOWS; window += 1)
		await draw(made, library, window);

	assert.equal(made.store.at(playlist, 0), null);
	assert.equal(titleAt(made.store, library, MIDDLE), titleOf(MIDDLE));
});

test("an album viewed after All Music drew its rows asks for none of them, and reads them by ordinal", async (t) => {
	const made = rig(t);
	await draw(made, allMusic(), 0);
	const album = albumOf([5, 6, 7]);

	await viewAt(made, album, 0, 0);
	await advance(LONG_AFTER_MS);

	assert.equal(made.asks.length, 1);
	assert.equal(titleAt(made.store, album, 0), titleOf(5));
	assert.equal(titleAt(made.store, album, 2), titleOf(7));
});

test("an album only partly held asks for exactly the ordinals not held", async (t) => {
	const made = rig(t);
	await draw(made, allMusic(), 0);
	const album = albumOf(span(2040, 2061));

	await viewAt(made, album, 0, 0);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, span(WINDOW_ROWS, 2061));
	answered(made.open());
	await settle();

	assert.equal(titleAt(made.store, album, 0), titleOf(2040));
	assert.equal(titleAt(made.store, album, 20), titleOf(2060));
});

test("a playlist's rows are held apart from the library's at the same positions, and by the playlist's own structure", async (t) => {
	const made = rig(t);
	const library = allMusic();
	await draw(made, library, 0);
	const playlist = playlistOf("p1", "7", 100);

	await viewAt(made, playlist, 0, 0);
	assert.equal(made.asks.length, 2);
	const page = made.asks[1];
	assert.equal(page.kind, "page");
	assert.equal(page.id, "p1");
	assert.equal(page.structure, "7");
	assert.deepEqual(page.positions, span(0, 100));
	answered(page);
	await settle();
	await advance(PACING_MS);

	assert.equal(titleAt(made.store, playlist, 0), playlistTitleOf("p1", 0));
	assert.equal(titleAt(made.store, library, 0), titleOf(0));

	await viewAt(made, playlistOf("p1", "8", 100), 0, 0);
	assert.equal(made.asks.length, 3);
	assert.equal(made.asks[2].structure, "8");
	answered(made.open());
	await settle();
	await advance(PACING_MS);

	await viewAt(made, playlistOf("p2", "7", 100), 0, 0);
	assert.equal(made.asks.length, 4);
	assert.equal(made.asks[3].id, "p2");
});

test("a window refused 429 is asked again once its Retry-After has passed on the clock, and a poll tick before then does not hurry it", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await viewAt(made, list, MIDDLE, 0);
	failed(made.open(), { reason: "tooFast", retryAfterMs: 2_000 });
	await settle();

	await advanceTo(1_999);
	made.store.answered();
	await settle();
	assert.equal(made.asks.length, 1, "asked before Retry-After");
	assert.equal(made.store.at(list, MIDDLE), null);

	await advanceTo(2_000);
	assert.equal(made.asks.length, 2);
	assert.deepEqual(made.asks[1].positions, windowSpan(0));
});

test("a window that fails otherwise is asked again only on a poll's answered tick, after 5 s doubling to 60 s, and stays pending meanwhile", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await viewAt(made, list, MIDDLE, 0);

	let asked = 1;
	for (const wait of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
		failed(made.open(), { reason: "unavailable" });
		await settle();
		const failedAt = Date.now();

		await advanceTo(failedAt + wait - 1);
		made.store.answered();
		await settle();
		assert.equal(made.asks.length, asked, `asked again before ${wait} ms`);

		await advanceTo(failedAt + wait);
		assert.equal(made.asks.length, asked, "asked again without a poll tick");
		assert.equal(made.store.at(list, MIDDLE), null);

		made.store.answered();
		await settle();
		asked += 1;
		assert.equal(made.asks.length, asked, `not asked again after ${wait} ms`);
		assert.deepEqual(made.asks[asked - 1].positions, windowSpan(0));
	}

	answered(made.open());
	await settle();
	assert.equal(titleAt(made.store, list, MIDDLE), titleOf(MIDDLE));
});

test("a 409 drops the library's held windows and asks nothing more at that structure, and the viewport is asked again at the structure the list moves to", async (t) => {
	const made = rig(t);
	await draw(made, allMusic(), 0);

	await viewAt(made, allMusic(), WINDOW_ROWS + MIDDLE, 0);
	failed(made.open(), { reason: "refused", structureMoved: true });
	await settle();
	await advance(LONG_AFTER_MS);

	assert.equal(made.store.at(allMusic(), MIDDLE), null);
	assert.equal(made.asks.length, 2, "asked again at the refused structure");

	const moved = allMusic(WINDOWS * WINDOW_ROWS, STRUCTURE + 1);
	await viewAt(made, moved, WINDOW_ROWS + MIDDLE, 0);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 3);
	assert.equal(made.asks[2].structure, STRUCTURE + 1);
	assert.deepEqual(made.asks[2].positions, windowSpan(1));
});

test("a 409 answering an ask made before the list moved to a new structure is discarded, so the new structure's window is kept and asked once", async (t) => {
	const made = rig(t);
	await viewAt(made, allMusic(), MIDDLE, 0);
	const old = made.open();

	const moved = allMusic(WINDOWS * WINDOW_ROWS, STRUCTURE + 1);
	await viewAt(made, moved, MIDDLE, 0);
	failed(old, { reason: "refused", structureMoved: true });
	await settle();
	await advance(PACING_MS);

	assert.equal(made.asks.length, 2);
	assert.equal(made.asks[1].structure, STRUCTURE + 1);
	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);

	assert.equal(titleAt(made.store, moved, MIDDLE), titleOf(MIDDLE));
	assert.equal(made.asks.length, 2, "a window was asked again");
});

test("a stale window on screen is asked again when viewed, and a stale one off screen is not asked until it is viewed", async (t) => {
	const made = rig(t);
	const list = allMusic();
	await draw(made, list, 0);
	await draw(made, list, 1);

	made.store.markStale({ kind: "library" });
	await viewAt(made, list, WINDOW_ROWS + MIDDLE, 0);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 3);
	assert.deepEqual(made.asks[2].positions, windowSpan(1));
	answered(made.open());
	await settle();
	await advance(LONG_AFTER_MS);
	assert.equal(made.asks.length, 3, "a stale window off screen was asked");

	await viewAt(made, list, MIDDLE, 0);
	await advance(PACING_MS);
	assert.equal(made.asks.length, 4);
	assert.deepEqual(made.asks[3].positions, windowSpan(0));
});
