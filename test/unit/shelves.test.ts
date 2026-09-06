import assert from "node:assert/strict";
import test from "node:test";

import type { Album } from "../../src/features/home/albums.ts";
import { buildShelves, refsOfShelf } from "../../src/features/home/shelves.ts";

// Which shelves a library gets, and in what order their tracks are addressed.
// `home.spec.ts` can see which tabs are drawn; it cannot reach the gates below
// without a contrived library per shelf, and it cannot see `refsOfShelf` at all.

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

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

const titles = (albums: Album[]) =>
	buildShelves(albums).map((shelf) => shelf.title);

test("a shelf that can only fill three entries is dropped rather than shown thin", () => {
	const three = many(3, (at) => ({ plays: 10 + at, lastPlayed: Date.now() }));
	assert.ok(!titles(three).includes("Most played"));

	const four = many(4, (at) => ({ plays: 10 + at, lastPlayed: Date.now() }));
	assert.ok(titles(four).includes("Most played"));
});

test("an empty library gets no shelves at all, not an empty one", () => {
	assert.deepEqual(buildShelves([]), []);
});

test("a library the player knows nothing about still opens on something", () => {
	// No play counts, no ratings, no dates: a fresh install, or a player with no
	// playback-statistics component. Every real shelf is empty and the fallback
	// is the only thing between the user and a blank screen.
	assert.deepEqual(titles(many(6, () => ({}))), ["Start somewhere"]);
});

test("Never listened stays away when nothing has ever been played", () => {
	// Every album reads zero, so offering the whole library as untouched would be
	// a lie about a library Jean simply cannot see the history of.
	const shelves = titles(many(6, () => ({})));
	assert.ok(!shelves.includes("Never listened"));
});

test("Your favourites needs eight rated albums before it will judge", () => {
	// A percentile over three albums calls one of them a favourite. The gate is
	// about having enough to have an opinion, not about the shelf's own minimum.
	const rated = (count: number) =>
		many(count, (at) => ({ ratedCount: 2, rating: 1 + (at % 5) }));

	assert.ok(!titles(rated(7)).includes("Your favourites"));
	assert.ok(titles(rated(12)).includes("Your favourites"));
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

	assert.ok(
		!titles(library(now - 30 * 24 * 60 * 60 * 1000)).includes(
			"Remember these?",
		),
	);
	assert.ok(titles(library(now - 4 * YEAR_MS)).includes("Remember these?"));
});

test("a shelf holds at most twenty-four albums and still reports the whole count", () => {
	const [top] = buildShelves(
		many(40, (at) => ({ plays: 100 - at, lastPlayed: Date.now() })),
	).filter((shelf) => shelf.id === "top");

	assert.equal(top.albums.length, 24);
	assert.equal(top.total, 40);
});

test("refsOfShelf is ascending across albums, not shelf order", () => {
	// beefweb's add-from-library ignores the order of `items` and adds them in
	// the library's own, so a position computed against shelf order addresses a
	// different track. The shelf here is sorted by plays, which puts the album
	// holding the higher refs first.
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
	// `Array.prototype.sort` with no comparator would put 100 before 9.
	const shelf = buildShelves([
		album({ refs: Int32Array.from([9, 100]), plays: 5, lastPlayed: 1 }),
		album({ refs: Int32Array.from([20, 3]), plays: 4, lastPlayed: 1 }),
		album({ refs: Int32Array.from([1000, 7]), plays: 3, lastPlayed: 1 }),
		album({ refs: Int32Array.from([80, 11]), plays: 2, lastPlayed: 1 }),
	]).find((entry) => entry.id === "top");

	assert.ok(shelf);
	assert.deepEqual([...refsOfShelf(shelf)], [3, 7, 9, 11, 20, 80, 100, 1000]);
});
