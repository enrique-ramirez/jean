import {
	component,
	copyRowsInto,
	type Playlist,
	playlists,
	rowsOf,
} from "./component.ts";
import { expect, type LiveTrack, test } from "./fixtures.ts";

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
}

const preview = (query: string) =>
	component<QueryPreview>("/api/autoplaylists/preview", {
		method: "POST",
		body: JSON.stringify({ query }),
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

		await component<Playlist>(`/api/autoplaylists/${made.id}`, {
			method: "POST",
			body: JSON.stringify({ key: KEY, query: byArtist(second) }),
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
