import {
	attempt,
	component,
	copyFromLibrary,
	type Playlist,
	playlists,
	removePlaylist,
	rowsOf,
} from "./component.ts";
import { expect, type Install, test } from "./fixtures.ts";

// A move and a sort each reach foobar2000's own `playlist_reorder_items`, which a playlist lock
// held by another component, the autoplaylist client among them, can refuse. Nothing here plays.

test.describe.configure({ mode: "serial" });

const TITLE = "#027 live order";
const ROWS = 5;
const BY_TITLE = "%title%";

const ROWS_MOVED =
	"the playlist's rows were added, removed or reordered; read them again";
const LOCKED = "another component has locked that playlist against that edit";

interface Candidate {
	ordinal: number;
	title: string;
}

// Titles opening on distinct capitals, so foobar2000's comparison orders them the same way
// whether or not it folds case, and the expected order is a plain string sort.
const distinctCapitals = (install: Install): Candidate[] => {
	const seen = new Set<string>();
	return install.tracks.flatMap(({ title }, ordinal) => {
		const initial = title.charAt(0);
		if (!/[A-Z]/.test(initial) || seen.has(initial)) return [];
		seen.add(initial);
		return [{ ordinal, title }];
	});
};

const isSorted = (titles: readonly string[]) =>
	titles.every((title, n) => n === 0 || titles[n - 1] < title);

const sortOrder = (titles: readonly string[]) =>
	titles
		.map((title, old) => ({ title, old }))
		.sort((a, b) => (a.title < b.title ? -1 : 1))
		.map(({ old }) => old);

// An `order` equal to its own inverse would pass whichever way round the component answered it.
const isInvolution = (order: readonly number[]) =>
	order.every((old, n) => order[old] === n);

// Rows 0 and 3 out, then back in at position 1 of the three left: 1, [0, 3], 2, 4.
const NON_CONTIGUOUS = { ordinals: [3, 0], to: 1 };
const nonContiguousMove = <T>([a, b, c, d, e]: T[]) => [b, a, d, c, e];

// Five rows the player lists in library order, chosen so that the order after the move is neither
// sorted nor one a sort would restore by an involution.
const pickRows = (install: Install) => {
	const candidates = distinctCapitals(install);
	for (let start = 0; start + ROWS <= candidates.length; start++) {
		const rows = candidates.slice(start, start + ROWS);
		const moved = nonContiguousMove(rows).map(({ title }) => title);
		if (!isSorted(moved) && !isInvolution(sortOrder(moved))) return rows;
	}
	test.skip(
		true,
		`this library has no ${ROWS} titles on distinct capitals to order`,
	);
	throw new Error("unreachable: test.skip(true) throws");
};

const titlesOf = async (id: string) => {
	const page = await rowsOf(id, 0, ROWS, [BY_TITLE]);
	return {
		titles: page.items.map(({ columns: [title] }) => title),
		structure: page.structure,
	};
};

const listed = async (id: string) =>
	(await playlists()).find((entry) => entry.id === id);

const moveRows = (id: string, body: object) =>
	attempt<{ structure: string } & { error: string }>(
		`/api/playlists/${id}/items/move`,
		body,
	);

const sortRows = (id: string, structure: string, pattern = BY_TITLE) =>
	attempt<{ structure: string; order: number[] } & { error: string }>(
		`/api/playlists/${id}/items/sort`,
		{ structure, pattern },
	);

const made: string[] = [];

const make = async (install: Install, rows: Candidate[]) => {
	const playlist = await copyFromLibrary(
		TITLE,
		install.structure,
		rows.map(({ ordinal }) => ordinal),
	);
	made.push(playlist.id);
	return playlist;
};

// Whether the case passed or not, so the install fixture's own check finds the playlists as it
// found them.
test.afterEach(async () => {
	for (const id of made.splice(0))
		if (await listed(id)) await removePlaylist(id);
});

test("a move lands the named rows together at `to` in the order they had, the last position included, and answers the structure the player now reports", async ({
	install,
}) => {
	const rows = pickRows(install);
	const titles = rows.map(({ title }) => title);
	const playlist = await make(install, rows);

	const created = await titlesOf(playlist.id);
	expect(created.titles).toEqual(titles);

	const moved = await moveRows(playlist.id, {
		structure: created.structure,
		...NON_CONTIGUOUS,
	});
	expect(moved.status, JSON.stringify(moved.body)).toBe(200);
	const afterMove = await titlesOf(playlist.id);
	expect(afterMove.titles).toEqual(nonContiguousMove(titles));
	expect(moved.body.structure).not.toBe(created.structure);
	expect(moved.body.structure).toBe(afterMove.structure);
	expect((await listed(playlist.id))?.structure).toBe(moved.body.structure);

	// `to` counts in the playlist without the moved row, so its length less one is the end.
	const toEnd = await moveRows(playlist.id, {
		structure: moved.body.structure,
		runs: [[0, 1]],
		to: ROWS - 1,
	});
	expect(toEnd.status, JSON.stringify(toEnd.body)).toBe(200);
	const [first, ...rest] = afterMove.titles;
	expect((await titlesOf(playlist.id)).titles).toEqual([...rest, first]);
});

test("a move or a sort naming a structure the playlist has left, or a move to past the end, is refused and moves nothing", async ({
	install,
}) => {
	const rows = pickRows(install);
	const playlist = await make(install, rows);
	const created = await titlesOf(playlist.id);
	const moved = await moveRows(playlist.id, {
		structure: created.structure,
		...NON_CONTIGUOUS,
	});
	expect(moved.status, JSON.stringify(moved.body)).toBe(200);
	const standing = await titlesOf(playlist.id);

	const staleMove = await moveRows(playlist.id, {
		structure: created.structure,
		runs: [[0, 1]],
		to: 2,
	});
	expect(staleMove).toEqual({
		status: 409,
		body: { error: ROWS_MOVED, detail: "" },
	});

	const staleSort = await sortRows(playlist.id, created.structure);
	expect(staleSort).toEqual({
		status: 409,
		body: { error: ROWS_MOVED, detail: "" },
	});

	const pastTheEnd = await moveRows(playlist.id, {
		structure: standing.structure,
		runs: [[0, 1]],
		to: ROWS,
	});
	expect(pastTheEnd.status, JSON.stringify(pastTheEnd.body)).toBe(400);

	expect(await titlesOf(playlist.id)).toEqual(standing);
});

test("a sort by title leaves the player's playlist in title order and answers, for each new position, the position its row held before", async ({
	install,
}) => {
	const rows = pickRows(install);
	const playlist = await make(install, rows);
	const created = await titlesOf(playlist.id);
	const moved = await moveRows(playlist.id, {
		structure: created.structure,
		...NON_CONTIGUOUS,
	});
	expect(moved.status, JSON.stringify(moved.body)).toBe(200);
	const before = await titlesOf(playlist.id);

	const sorted = await sortRows(playlist.id, before.structure);
	expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
	const after = await titlesOf(playlist.id);
	expect(after.titles).toEqual([...before.titles].sort());
	expect(sorted.body.order).toEqual(sortOrder(before.titles));
	expect(sorted.body.order.map((old) => before.titles[old])).toEqual(
		after.titles,
	);
	expect(sorted.body.structure).not.toBe(before.structure);
	expect(sorted.body.structure).toBe(after.structure);
});

// foobar2000's autoplaylist client locks a playlist it keeps sorted against a reorder. On
// one made without `forceSort` the player takes both a move and a sort, and that case is Jean's
// to hide rather than the component's to refuse.
test("a force-sorted autoplaylist refuses a move and a sort with the lock's 409 and keeps its order", async ({
	install,
}) => {
	const { canCreateAutoPlaylists } = await component<{
		canCreateAutoPlaylists: boolean;
	}>("/api/capabilities");
	const artist = install.tracks
		.map(({ artist }) => artist)
		.find(
			(artist, n, all) =>
				artist !== "" &&
				artist !== "?" &&
				!artist.includes('"') &&
				all.indexOf(artist, n + 1) !== -1,
		);
	test.skip(
		!canCreateAutoPlaylists || !artist,
		"this install makes no autoplaylists, or no artist holds two tracks",
	);
	if (!artist) return;
	const query = `%artist% IS "${artist}"`;
	const { matches } = await component<{ matches: number }>(
		"/api/autoplaylists/preview",
		{ method: "POST", body: JSON.stringify({ query }) },
	);

	const autoplaylist = await component<Playlist>("/api/autoplaylists", {
		method: "POST",
		body: JSON.stringify({
			title: `${TITLE} autoplaylist`,
			query,
			sort: BY_TITLE,
			forceSort: true,
		}),
	});
	made.push(autoplaylist.id);
	await expect
		.poll(async () => (await listed(autoplaylist.id))?.itemCount)
		.toBe(matches);
	const before = await rowsOf(autoplaylist.id, 0, matches, ["%path%"]);

	const move = await moveRows(autoplaylist.id, {
		structure: before.structure,
		runs: [[0, 1]],
		to: 1,
	});
	expect(move).toEqual({ status: 409, body: { error: LOCKED, detail: "" } });

	const sort = await sortRows(autoplaylist.id, before.structure, "%path%");
	expect(sort).toEqual({ status: 409, body: { error: LOCKED, detail: "" } });

	expect(await rowsOf(autoplaylist.id, 0, matches, ["%path%"])).toEqual(before);
});
