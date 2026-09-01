import type { APIRequestContext } from "@playwright/test";
import type { LibraryItem } from "../../src/shared/api/types.ts";

// A node of `/library/items/by-path`: a folder with a recursive count, or a
// track with its columns. Documented in API.md; nothing in the app reads it
// yet, so the shape lives here with the spec that pins it.
interface LibraryNode {
	type: "D" | "F";
	name: string;
	path: string;
	itemCount?: number;
	subsong?: number;
	columns?: string[];
}

import { expect, inSequence, test } from "./fixtures.ts";

// The fake's media library, checked against the shapes measured on a live
// foobar2000 running beefweb 0.11~git.dc0fdfc. Nothing in Jean uses these
// endpoints yet -- this exists so that when it does, the thing it is tested
// against is not an invention.
//
// The measurements these assertions come from are in API.md, under "The media
// library API". Where the OpenAPI spec and the live player disagreed, the
// player won: there is no `pathSeparator` on the by-path response, and `range`
// is a query parameter rather than a path segment.

// Pinned on rather than inherited: this file is *about* the library endpoints,
// so it has to exercise them even on a run that sends the rest of the suite
// down the autoplaylist fallback (JEAN_NO_LIBRARY_API=1).
test.use({ library: { supported: true, enabled: true } });

const api = (request: APIRequestContext, path: string) =>
	request.get(`/api${path}`);

// `player` is destructured in every test even where it goes unread: it is the
// fixture that resets the fake to this test's state, and Playwright only builds
// the fixtures a test actually asks for. A test taking only `request` runs
// against whatever the previous one left behind.
test.describe("the library the fake serves", () => {
	test("info reports a supported, enabled library that agrees with the tracks", async ({
		request,
		player,
	}) => {
		const { library } = await (await api(request, "/library/info")).json();

		expect(library).toEqual({ supported: true, enabled: true, itemCount: 54 });
	});

	test("items are addressed by a library-relative, forward-slashed path", async ({
		request,
		player,
	}) => {
		const response = await api(
			request,
			"/library/items?columns=%25artist%25,%25title%25&range=0:3",
		);
		const { libraryItems } = await response.json();

		expect(libraryItems.offset).toBe(0);
		expect(libraryItems.totalCount).toBe(54);
		expect(libraryItems.items).toHaveLength(3);

		// Relative to the media library folder and '/'-separated, even though the
		// captured paths are absolute Windows ones. The live player reports
		// pathSeparator as '\' and library paths still are not separated that way.
		libraryItems.items.forEach((item: LibraryItem) => {
			expect(item.path).not.toContain("\\");
			expect(item.path).not.toMatch(/^[A-Z]:/);
			expect(item.subsong).toBe(0);
			expect(item.columns).toHaveLength(2);
		});

		expect(libraryItems.items[0].path).toBe(
			"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac",
		);
	});

	test("range is optional and returns everything", async ({
		request,
		player,
	}) => {
		const { libraryItems } = await (
			await api(request, "/library/items?columns=%25title%25")
		).json();

		expect(libraryItems.items).toHaveLength(54);
	});

	test("the top of the tree has no parentPath, and folders carry a recursive count", async ({
		request,
		player,
	}) => {
		const { libraryNodes } = await (
			await api(request, "/library/items/by-path?columns=%25title%25")
		).json();

		expect(libraryNodes.path).toBe("");
		// Absent, not null: it is how a client knows it cannot navigate up.
		expect(libraryNodes).not.toHaveProperty("parentPath");
		expect(Object.keys(libraryNodes).sort()).toEqual([
			"items",
			"offset",
			"path",
			"totalCount",
		]);

		libraryNodes.items.forEach((node: LibraryNode) => {
			expect(node.type).toBe("D");
			expect(node.itemCount).toBeGreaterThan(0);
			expect(node).not.toHaveProperty("columns");
		});

		// 54 captured tracks across three first-letter folders.
		expect(libraryNodes.items.map((node: LibraryNode) => node.name)).toEqual([
			"A",
			"B",
			"H",
		]);
	});

	test("a folder below the top can be navigated up from", async ({
		request,
		player,
	}) => {
		const { libraryNodes } = await (
			await api(
				request,
				"/library/items/by-path?path=B%2FBabas%C3%B3nicos&columns=%25title%25",
			)
		).json();

		expect(libraryNodes.path).toBe("B/Babasónicos");
		expect(libraryNodes.parentPath).toBe("B");
		expect(libraryNodes.items.map((node: LibraryNode) => node.name)).toEqual([
			"(2001) Jessico",
		]);
	});

	test("tracks and folders are different shapes, folders first", async ({
		request,
		player,
	}) => {
		const { libraryNodes } = await (
			await api(
				request,
				"/library/items/by-path?path=B%2FBabas%C3%B3nicos%2F(2001)%20Jessico&columns=%25title%25",
			)
		).json();

		expect(libraryNodes.items).toHaveLength(12);
		libraryNodes.items.forEach((node: LibraryNode) => {
			expect(node.type).toBe("F");
			expect(node.subsong).toBe(0);
			expect(node.columns).toHaveLength(1);
			expect(node).not.toHaveProperty("itemCount");
		});
		expect(libraryNodes.items[0].name).toBe("01. Los Calientes.mp3");
	});

	test("artwork comes by path: string, with no playlist involved", async ({
		request,
		player,
	}) => {
		const path = encodeURIComponent(
			"B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3",
		);
		const response = await api(request, `/artwork/library?path=${path}`);

		expect(response.status()).toBe(200);
		expect((await response.body()).length).toBeGreaterThan(1000);

		// A track that is not in the library is a 404, not an error.
		const missing = await api(
			request,
			"/artwork/library?path=no/such/track.flac",
		);
		expect(missing.status()).toBe(404);
	});
});

test.describe("adding from the library to a playlist", () => {
	const items = [
		{ path: "B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3" },
		{ path: "B/Babasónicos/(2001) Jessico/02. Fizz.mp3" },
	];

	test("replace and play are one request", async ({ request, player }) => {
		const before = player.playlists.find((entry) => entry.id === "p2")!.items
			.length;
		expect(before).toBe(7);

		const response = await request.post(
			"/api/playlists/p2/items/add-from-library",
			{
				data: { items, replace: true, play: true },
			},
		);
		expect(response.status()).toBe(204);

		// The whole rename/empty/refill/play sequence, with no client-side count
		// arithmetic left to get wrong -- which is the thing that made the scratch
		// playlist play the wrong track.
		const after = player.playlists.find((entry) => entry.id === "p2")!;
		expect(after.items).toHaveLength(2);
		expect(after.items[0]["%title%"]).toBe("Los Calientes");
		expect(player.player.activeItem.playlistId).toBe("p2");
		expect(player.player.activeItem.index).toBe(0);
	});

	test("without replace it appends", async ({ request, player }) => {
		await request.post("/api/playlists/p2/items/add-from-library", {
			data: { items },
		});

		const after = player.playlists.find((entry) => entry.id === "p2")!;
		expect(after.items).toHaveLength(9);
		expect(after.items[7]["%title%"]).toBe("Los Calientes");
	});
});

// A player with no library support is not a broken player -- it is DeaDBeeF,
// and it is the state that has to send Jean back to the autoplaylist.
test.describe("a player with no media library", () => {
	test.use({ library: { supported: false } });

	test("info still answers, because that is how you find out", async ({
		request,
		player,
	}) => {
		const { library } = await (await api(request, "/library/info")).json();

		expect(library!.supported).toBe(false);
		expect(library!.itemCount).toBe(0);
		expect(player.library!.supported).toBe(false);
	});

	test("everything else is 501", async ({ request, player }) => {
		await inSequence(
			[
				"/library/items?columns=%25title%25",
				"/library/items/by-path?columns=%25title%25",
				"/artwork/library?path=whatever",
			],
			async (path: string) =>
				expect((await api(request, path)).status(), path).toBe(501),
		);

		const add = await request.post("/api/playlists/p2/items/add-from-library", {
			data: {},
		});
		expect(add.status()).toBe(501);
	});
});

test.describe("a player whose library is switched off", () => {
	// foobar2000 with no media library configured. A different problem from "this
	// player has no library API", with a different fix, so it must not collapse
	// into the same state.
	test.use({ library: { supported: true, enabled: false } });

	test("it is supported but empty, and the endpoints still work", async ({
		request,
		player,
	}) => {
		const { library } = await (await api(request, "/library/info")).json();

		expect(library).toEqual({ supported: true, enabled: false, itemCount: 0 });
		expect(
			(await api(request, "/library/items?columns=%25title%25")).status(),
		).toBe(200);
	});
});

// The two things the fake deliberately refuses rather than approximating.
test.describe("what the fake will not pretend to do", () => {
	test("the player query syntax", async ({ request, player }) => {
		const response = await api(
			request,
			"/library/items?columns=%25title%25&query=artist%20HAS%20x",
		);

		// Jean should be addressing adds by explicit items anyway -- the two filters
		// do not return the same set, so a fake that guessed would hide that.
		expect(response.status()).toBe(400);
	});

	test("sorting by an arbitrary title-format expression", async ({
		request,
		player,
	}) => {
		const bare = await api(
			request,
			"/library/items?columns=%25title%25&sort=%25title%25",
		);
		expect(bare.status()).toBe(200);

		const computed = await api(
			request,
			"/library/items?columns=%25title%25&sort=%24if(a%2Cb%2Cc)",
		);
		expect(computed.status()).toBe(400);
	});
});
