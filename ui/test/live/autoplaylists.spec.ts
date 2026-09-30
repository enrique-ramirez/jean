import {
	attempt,
	component,
	copyFromLibrary,
	copyRowsInto,
	type Playlist,
	playlists,
	removePlaylist,
	rowsOf,
} from "./component.ts";
import { expect, type Install, type LiveTrack, test } from "./fixtures.ts";

// foobar2000's autoplaylist client fills the playlist from the Media Library, refills it when its
// query changes and locks it against rows added by hand.

test.describe.configure({ mode: "serial" });

const TITLE = "#live autoplaylist";
const KEY = "live:autoplaylist";

interface QueryPreview {
	valid: boolean;
	error: string;
	matches: number;
	libraryEnabled: boolean;
	structure?: number;
	ordinals?: number[];
}

const preview = (query: string, rows?: boolean) =>
	component<QueryPreview>("/api/autoplaylists/preview", {
		method: "POST",
		body: JSON.stringify(rows ? { query, rows } : { query }),
	});

const byArtist = (artist: string) => `%artist% IS "${artist}"`;

const twoArtists = (tracks: LiveTrack[]) => {
	const counts = new Map<string, number>();
	for (const { artist } of tracks)
		if (artist && artist !== "?" && !artist.includes('"'))
			counts.set(artist, (counts.get(artist) ?? 0) + 1);
	const [first, ...rest] = [...counts].sort(([, a], [, b]) => b - a);
	const second = rest.find(([, count]) => count !== first?.[1]);
	return first && second ? [first, second] : null;
};

const listed = async (id: string) =>
	(await playlists()).find((entry) => entry.id === id);

const artistsOf = async (id: string, count: number) =>
	(await rowsOf(id, 0, count, ["%artist%"])).items.map(
		(item) => item.columns[0],
	);

const NEW_TITLE = "#027 live autoplaylist";
const NOT_AN_AUTOPLAYLIST = {
	error: "that playlist is not an autoplaylist",
	detail: "",
};

const ours: string[] = [];

// Whether the case passed or not, so the install fixture's own check finds the playlists as it
// found them.
test.afterEach(async () => {
	for (const id of ours.splice(0))
		if (await listed(id)) await removePlaylist(id);
});

test("an autoplaylist holds what its preview counted, refills when its query changes, and is gone once removed", async ({
	install,
}) => {
	const { canCreateAutoPlaylists } = await component<{
		canCreateAutoPlaylists: boolean;
	}>("/api/capabilities");
	const artists = twoArtists(install.tracks);
	test.skip(
		!canCreateAutoPlaylists || !artists,
		"this install makes no autoplaylists, or its library has no two artists holding different numbers of tracks",
	);
	if (!artists) return;
	const [[first, firstCount], [second, secondCount]] = artists;

	const previewed = await preview(byArtist(first));
	expect(previewed).toEqual({
		valid: true,
		error: "",
		matches: firstCount,
		libraryEnabled: true,
	});

	const made = await component<Playlist>("/api/autoplaylists", {
		method: "POST",
		body: JSON.stringify({ title: TITLE, key: KEY, query: byArtist(first) }),
	});
	ours.push(made.id);
	try {
		expect(made.isAutoPlaylist).toBe(true);
		await expect
			.poll(async () => (await listed(made.id))?.itemCount)
			.toBe(firstCount);
		expect(new Set(await artistsOf(made.id, firstCount))).toEqual(
			new Set([first]),
		);

		const source = (await playlists()).find(
			(entry) =>
				!entry.isAutoPlaylist && entry.role === null && entry.itemCount > 0,
		);
		expect(
			source,
			"a playlist of the user's with rows to copy from",
		).toBeDefined();
		expect(
			await copyRowsInto(made.id, source?.id ?? "", 1),
			"a copy into it is refused by the core's lock",
		).toBe(409);
		expect((await listed(made.id))?.itemCount).toBe(firstCount);

		const updated = await component<Playlist>(`/api/autoplaylists/${made.id}`, {
			method: "POST",
			body: JSON.stringify({ key: KEY, query: byArtist(second) }),
		});
		expect(updated.managed).toEqual({
			key: KEY,
			query: byArtist(second),
			sort: "",
			forceSort: false,
		});
		await expect
			.poll(async () => (await listed(made.id))?.itemCount)
			.toBe(secondCount);
		expect(new Set(await artistsOf(made.id, secondCount))).toEqual(
			new Set([second]),
		);
		expect((await listed(made.id))?.title).toBe(TITLE);
	} finally {
		await component<void>(`/api/autoplaylists/${made.id}`, {
			method: "DELETE",
		});
	}

	expect(await listed(made.id)).toBeUndefined();
});

const isAscending = (ordinals: readonly number[]) =>
	ordinals.every((ordinal, n) => n === 0 || ordinals[n - 1] < ordinal);

const canCreate = async () =>
	(await component<{ canCreateAutoPlaylists: boolean }>("/api/capabilities"))
		.canCreateAutoPlaylists;

test("a preview asked for its rows names every match once, ascending, as the ordinals of the library the export holds", async ({
	install,
}) => {
	const artists = twoArtists(install.tracks);
	test.skip(!artists, "this library has no two artists to query");
	if (!artists) return;
	const [[artist, count]] = artists;

	const counted = await preview(byArtist(artist));
	const withRows = await preview(byArtist(artist), true);
	expect(counted).toEqual({
		valid: true,
		error: "",
		matches: count,
		libraryEnabled: true,
	});
	expect(withRows).toEqual({
		...counted,
		structure: install.structure,
		ordinals: expect.any(Array),
	});
	const ordinals = withRows.ordinals ?? [];
	expect(ordinals).toHaveLength(withRows.matches);
	expect(isAscending(ordinals)).toBe(true);
	expect(
		new Set(ordinals.map((ordinal) => install.tracks[ordinal]?.artist)),
	).toEqual(new Set([artist]));

	// The broadest query there is: a snapshot mapped at the wrong generation or truncated shows here
	// first.
	const everything = await preview("ALL", true);
	expect(everything.matches).toBe(install.itemCount);
	expect(everything.ordinals).toEqual(
		Array.from({ length: install.itemCount }, (_, ordinal) => ordinal),
	);
});

// An autoplaylist made in foobar2000's own dialog, with `managed: null`, cannot be made from
// here: the player offers no way to make one without its window. The one such
// autoplaylist an install may already hold is somebody's, and an update replaces its query, so
// none is touched. What is left is Jean's own path through the dialog: made without a key,
// updated with the key it stored, then deleted through the autoplaylist route.
test("an autoplaylist made without a key takes a new query with its name left alone, refills, and is gone once deleted", async ({
	install,
}) => {
	const artists = twoArtists(install.tracks);
	test.skip(
		!(await canCreate()) || !artists,
		"this install makes no autoplaylists, or its library has no two artists holding different numbers of tracks",
	);
	if (!artists) return;
	const [[first, firstCount], [second, secondCount]] = artists;

	const autoplaylist = await component<Playlist>("/api/autoplaylists", {
		method: "POST",
		body: JSON.stringify({ title: NEW_TITLE, query: byArtist(first) }),
	});
	ours.push(autoplaylist.id);
	await expect
		.poll(async () => (await listed(autoplaylist.id))?.itemCount)
		.toBe(firstCount);

	const updated = await component<Playlist>(
		`/api/autoplaylists/${autoplaylist.id}`,
		{
			method: "POST",
			body: JSON.stringify({
				key: "",
				query: byArtist(second),
				sort: "",
				forceSort: false,
			}),
		},
	);
	expect(updated).toMatchObject({
		id: autoplaylist.id,
		title: NEW_TITLE,
		isAutoPlaylist: true,
		managed: { key: "", query: byArtist(second), sort: "", forceSort: false },
	});
	await expect
		.poll(async () => (await listed(autoplaylist.id))?.itemCount)
		.toBe(secondCount);
	expect(new Set(await artistsOf(autoplaylist.id, secondCount))).toEqual(
		new Set([second]),
	);
	expect((await listed(autoplaylist.id))?.managed?.query).toBe(
		byArtist(second),
	);

	const removed = await attempt(
		`/api/autoplaylists/${autoplaylist.id}`,
		undefined,
		"DELETE",
	);
	expect(removed).toEqual({
		status: 200,
		body: { removed: true, id: autoplaylist.id },
	});
	expect(await listed(autoplaylist.id)).toBeUndefined();
});

const plainPlaylist = async (install: Install) => {
	const playlist = await copyFromLibrary(
		`${NEW_TITLE} plain`,
		install.structure,
		[0, 1].filter((ordinal) => ordinal < install.itemCount),
	);
	ours.push(playlist.id);
	return playlist;
};

test("a plain playlist is refused an autoplaylist update and an autoplaylist delete with the 409, and keeps its rows and its name", async ({
	install,
}) => {
	test.skip(install.itemCount === 0, "this library holds no tracks");
	const playlist = await plainPlaylist(install);
	const before = await rowsOf(playlist.id, 0, playlist.itemCount);

	const update = await attempt(`/api/autoplaylists/${playlist.id}`, {
		query: "ALL",
	});
	expect(update).toEqual({ status: 409, body: NOT_AN_AUTOPLAYLIST });

	const remove = await attempt(
		`/api/autoplaylists/${playlist.id}`,
		undefined,
		"DELETE",
	);
	expect(remove).toEqual({ status: 409, body: NOT_AN_AUTOPLAYLIST });

	expect(await listed(playlist.id)).toMatchObject({
		title: playlist.title,
		isAutoPlaylist: false,
		managed: null,
	});
	expect(await rowsOf(playlist.id, 0, playlist.itemCount)).toEqual(before);
});
