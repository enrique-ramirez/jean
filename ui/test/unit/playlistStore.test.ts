import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { librarySourceOf } from "../../src/domain/track/librarySource.ts";
import {
	loadPlaylist,
	playlistSnapshot,
	recheckPlaylist,
} from "../../src/domain/track/playlistStore.ts";
import type {
	PlaylistChanges,
	PlaylistPage,
} from "../../src/shared/api/fooJean.ts";
import type { TrackColumns } from "../../src/shared/api/types.ts";

// The store holds the rows a playlist view draws and the addresses a rating is
// written to, and a delta reaches it from a poll rather than from anything a
// person does. What it did with one is not a surface a browser can be pointed
// at: the page looks the same whether a row's address followed its values or
// stayed behind.

const ORIGIN = "http://player.invalid:8881";
const TOKEN = "token";

// Every track of one cue sheet shares a library path, so the subsong is the
// half of the address that tells two of them apart.
const CUE = "Fictional Artist/Imaginary Album/album.flac";
const TRACK = "Fictional Artist/Imaginary Album/02 Track.flac";

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

const pageOf = (rows: Row[], revision: string): PlaylistPage => ({
	structure: STRUCTURE,
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
	changes: PlaylistChanges | null;
	rowReads: number;
}

const playerHolding = (t: TestContext, rows: Row[]): FakePlayer => {
	const player: FakePlayer = { rows, changes: null, rowReads: 0 };

	const realFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = realFetch;
	});

	const answer = (body: unknown) =>
		new Response(JSON.stringify(body), {
			headers: { "Content-Type": "application/json" },
		});

	globalThis.fetch = ((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/items/changes?")) {
			assert.ok(player.changes, `no change to answer: ${url}`);
			return Promise.resolve(answer(player.changes));
		}
		if (url.includes("/items?")) {
			player.rowReads += 1;
			return Promise.resolve(
				answer(pageOf(player.rows, player.changes?.revision ?? FIRST_READ)),
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

const loaded = async (playlistId: string, count: number) => {
	const key = loadPlaylist(ORIGIN, TOKEN, playlistId, STRUCTURE, count);

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
		token: TOKEN,
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

	await recheckPlaylist(ORIGIN, TOKEN, playlistId, {
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

	await recheckPlaylist(ORIGIN, TOKEN, playlistId, {
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
