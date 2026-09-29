import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoute } from "../../src/app/routes.ts";
import type { Album } from "../../src/domain/track/albums.ts";
import { buildShelves, refsOfShelf } from "../../src/features/home/shelves.ts";

// Which shelves a library gets, and in what order their tracks are addressed.
// `home.spec.ts` can see which tabs are drawn; it cannot reach the gates below
// without a contrived library per shelf, and it cannot see `refsOfShelf` at all.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const MONTH_MS = YEAR_MS / 12;

let next = 0;

const album = (over: Partial<Album> = {}): Album => {
	const refs = over.refs ?? Int32Array.from([next++, next++, next++, next++]);
	return {
		key: `album-${next}`,
		album: `Album ${next}`,
		artist: "Artist",
		refs,
		plays: 0,
		lastPlayed: 0,
		bitrateTotal: 0,
		bitrateCount: 0,
		lossless: true,
		ratings: [],
		trackCount: refs.length,
		playsPerTrack: 0,
		bitrate: null,
		ratedCount: 0,
		rating: null,
		...over,
	} as Album;
};

const many = (count: number, over: (at: number) => Partial<Album>) =>
	Array.from({ length: count }, (_, at) => album(over(at)));

const ids = (albums: Album[]) => buildShelves(albums).map((shelf) => shelf.id);

test("a shelf that can only fill three entries is dropped rather than shown thin", () => {
	const three = many(3, (at) => ({ plays: 10 + at, lastPlayed: Date.now() }));
	assert.ok(!ids(three).includes("top"));

	const four = many(4, (at) => ({ plays: 10 + at, lastPlayed: Date.now() }));
	assert.ok(ids(four).includes("top"));
});

test("an empty library gets no shelves at all, not an empty one", () => {
	assert.deepEqual(buildShelves([]), []);
});

test("a library the player knows nothing about still opens on something", () => {
	assert.deepEqual(ids(many(6, () => ({}))), ["starter"]);
});

test("Never listened stays away when nothing has ever been played", () => {
	const shelves = ids(many(6, () => ({})));
	assert.ok(!shelves.includes("unopened"));
});

test("Your favourites needs eight rated albums before it will judge", () => {
	const rated = (count: number) =>
		many(count, (at) => ({ ratedCount: 2, rating: 1 + (at % 5) }));

	assert.ok(!ids(rated(7)).includes("rated"));
	assert.ok(ids(rated(12)).includes("rated"));
});

test("Remember these? offers nothing played inside the last eighteen months", () => {
	const now = Date.now();
	// Sixteen albums, eight of them played far harder than the rest, so the
	// busy-percentile gate lets exactly those eight through and the date floor is
	// the only thing left that can keep them off a shelf whose title says they
	// were forgotten.
	const library = (lastPlayed: number) => [
		...many(8, () => ({ plays: 200, playsPerTrack: 50, lastPlayed })),
		...many(8, () => ({ plays: 4, playsPerTrack: 1, lastPlayed })),
	];

	assert.ok(!ids(library(now - 17 * MONTH_MS)).includes("loved"));
	assert.ok(ids(library(now - 19 * MONTH_MS)).includes("loved"));
});

test("Recently played holds only albums played within the last thirty days", () => {
	const now = Date.now();
	const inside = many(4, (at) => ({
		plays: 5,
		lastPlayed: now - 29 * DAY_MS + at,
	}));
	const outside = many(4, () => ({ plays: 5, lastPlayed: now - 31 * DAY_MS }));

	const recent = buildShelves([...inside, ...outside]).find(
		(shelf) => shelf.id === "recent",
	);

	assert.ok(recent);
	assert.deepEqual(
		recent.albums.map((entry) => entry.key).sort(),
		inside.map((entry) => entry.key).sort(),
	);
});

test("Recently played is left off, not drawn empty, when nothing was played in thirty days", () => {
	const shelves = buildShelves(
		many(6, () => ({ plays: 5, lastPlayed: Date.now() - 31 * DAY_MS })),
	);

	assert.ok(shelves.length > 0);
	assert.ok(!shelves.some((shelf) => shelf.id === "recent"));
	assert.ok(shelves.every((shelf) => shelf.albums.length > 0));
});

const SAVED_IDS = ["recent", "top", "rated", "loved", "upgrade", "unopened"];

test("every shelf id a user may have saved still opens that shelf", () => {
	assert.deepEqual(
		SAVED_IDS.map((id) => {
			const view = resolveRoute(`shelf/${id}`);
			return view.kind === "shelf" ? view.shelf.id : null;
		}),
		SAVED_IDS,
	);
});

test("a shelf holds at most twenty-four albums and still reports the whole count", () => {
	const [top] = buildShelves(
		many(40, (at) => ({ plays: 100 - at, lastPlayed: Date.now() })),
	).filter((shelf) => shelf.id === "top");

	assert.equal(top.albums.length, 24);
	assert.equal(top.total, 40);
});

test("refsOfShelf is ascending across albums, not shelf order", () => {
	const shelf = buildShelves([
		album({ refs: Int32Array.from([40, 41]), plays: 90, lastPlayed: 1 }),
		album({ refs: Int32Array.from([10, 11]), plays: 80, lastPlayed: 1 }),
		album({ refs: Int32Array.from([70, 71]), plays: 70, lastPlayed: 1 }),
		album({ refs: Int32Array.from([0, 1]), plays: 60, lastPlayed: 1 }),
	]).find((entry) => entry.id === "top");

	assert.ok(shelf);
	assert.deepEqual([...refsOfShelf(shelf)], [0, 1, 10, 11, 40, 41, 70, 71]);
});

test("refsOfShelf sorts numerically, not as text", () => {
	const shelf = buildShelves([
		album({ refs: Int32Array.from([9, 100]), plays: 5, lastPlayed: 1 }),
		album({ refs: Int32Array.from([20, 3]), plays: 4, lastPlayed: 1 }),
		album({ refs: Int32Array.from([1000, 7]), plays: 3, lastPlayed: 1 }),
		album({ refs: Int32Array.from([80, 11]), plays: 2, lastPlayed: 1 }),
	]).find((entry) => entry.id === "top");

	assert.ok(shelf);
	assert.deepEqual([...refsOfShelf(shelf)], [3, 7, 9, 11, 20, 80, 100, 1000]);
});
