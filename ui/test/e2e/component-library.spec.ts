import type { RecordedRequest } from "../fake-api/state.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	type FakePlayer,
	openSidebar,
	type Page,
	playedFrom,
	playRequests,
	requestsTo,
	rowByTitle,
	scratchFills,
	scratchOf,
	sidebar,
	test,
	toastRegion,
	trackPlayed,
	trackRow,
} from "./fixtures.ts";
import { dragFrom } from "./gestures.ts";
import { openRowMenu } from "./menus.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// `foo_jean` answers the whole library as one binary snapshot, and it is the only source there is.

const exportsAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/export").filter(
		(entry) =>
			entry.method === "GET" &&
			new URLSearchParams(entry.path.split("?")[1]).get("spine") !== "false",
	);

const deltasAsked = (player: FakePlayer) =>
	requestsTo(player, "/api/library/changes");

const everyExport = (player: FakePlayer) =>
	requestsTo(player, "/api/library/export").filter(
		(entry) => entry.method === "GET",
	);

const everyPartLoaded = async (player: FakePlayer) => {
	await expect
		.poll(() => everyExport(player).length - exportsAsked(player).length)
		.toBe(1);
	return everyExport(player).length;
};

const titleAtOrdinal = (player: FakePlayer, ordinal: number) =>
	player.ordinalOrder()[ordinal].track["%title%"];

const rowTitled = (page: Page, title: string) =>
	page.getByRole("row").filter({ has: page.getByText(title, { exact: true }) });

// Ordered against the export that answered a structure move, because a delta asked before it names
// a revision from the structure `foo_jean` has thrown away, which it answers with a 409. The deltas
// after it are ordinary movement in the library Jean now holds.
const deltasAskedBefore = (player: FakePlayer, request: RecordedRequest) => {
	const at = player.requests.indexOf(request);
	return deltasAsked(player).filter(
		(entry) => player.requests.indexOf(entry) < at,
	);
};

const OTHER_DECLARATION = "%title%";

const anotherClientDeclares = async (page: Page) => {
	const answer = await page.request.get(
		`/api/library/export?columns=${encodeURIComponent(OTHER_DECLARATION)}`,
	);
	expect(answer.status(), "an export of another column set").toBe(200);
};

const jeansExports = (player: FakePlayer) =>
	exportsAsked(player).filter(
		(entry) =>
			new URLSearchParams(entry.path.split("?")[1]).getAll("columns").join() !==
			OTHER_DECLARATION,
	);

const jlibHeaderOf = (body: Buffer) =>
	JSON.parse(body.subarray(8, 8 + body.readUInt32LE(4)).toString()) as {
		structure: number;
		revision: number;
	};

const playsOf = (page: Page, row: number) =>
	trackRow(page, row).locator("[data-zero]");

const playsAsked = (player: FakePlayer) =>
	playRequests(player).map((entry) =>
		Number(/\/items\/(\d+)\/play$/.exec(entry.path)?.[1]),
	);

const playlistsMade = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path === "/api/playlists",
	);

const playlistsRenamed = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/?]+$/.test(entry.path) &&
			entry.body?.title !== undefined,
	);

const addsSent = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/]+\/items$/.test(entry.path),
	).length;

const titlesIn = (player: FakePlayer, title: string) =>
	player.playlists
		.find((entry) => entry.title === title)!
		.items.map((track) => track["%title%"]);

const openAllMusic = async (page: Page) => {
	await page.goto("/#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

const FAVORITES = "Favorites";

const changeLibrary = async (
	page: Page,
	change: { add?: number; remove?: number },
) => {
	const answer = await page.request.post("/__control/library", {
		data: change,
	});
	expect(
		answer.status(),
		`POST /__control/library ${JSON.stringify(change)}`,
	).toBeLessThan(300);
};

const libraryState = async (page: Page) =>
	(
		(await (await page.request.get("/api/state")).json()) as {
			library: { structure: number; trackCount: number; halted: boolean };
		}
	).library;

const pathsIn = (player: FakePlayer) =>
	new Set(player.libraryTracks.map((track) => track["%path%"]));

const menuItem = (page: Page, name: string) =>
	page.getByRole("menuitem", { name, exact: true });

const addToPlaylist = (page: Page) =>
	page.getByRole("menuitem", { name: /Add to playlist/ });

const sidebarRow = (page: Page, title: string) =>
	sidebar(page).locator("> div").filter({ hasText: title });

const fileInto = async (
	page: Page,
	isMobile: boolean,
	index: number,
	title: string,
) => {
	await openRowMenu(page, isMobile, index, /^Add to queue$/);
	await addToPlaylist(page).click();
	await menuItem(page, title).click();
};

test.describe("the library as one snapshot", () => {
	test.use({ fooJean: {} });

	test("every track arrives in one export", async ({ page, player }) => {
		await openAllMusic(page);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expectSettlesAt(player, () => exportsAsked(player).length, 1);
	});

	test("the export declares the columns the app reads", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		expect(player.libraryFeed.columns).toContain("%title%");
		expect(player.libraryFeed.columns).toContain("%album artist%");
		expect(player.libraryFeed.columns).toContain("%play_count%");
	});

	test("rows carry what the player tagged, in path order", async ({ page }) => {
		await openAllMusic(page);

		await expect(trackRow(page, 0)).toContainText("Rotten Apple");
		await expect(trackRow(page, 0)).toContainText("Alice in Chains");
	});

	test("an accented artist is still found by a folded search", async ({
		page,
	}) => {
		await openAllMusic(page);
		await page.goto("/#/search/babasonicos");

		await expect
			.poll(() => page.locator('[role="row"]').count())
			.toBeGreaterThan(0);
		await expect(trackRow(page, 0)).toContainText("Babasónicos");
	});
});

test.describe("a snapshot that has to be built first", () => {
	test.use({
		fooJean: { libraryBuilds: 2 },
	});

	test("the 202 is waited out rather than reported as a failure", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		// One 202, the polls that watched the build, then the export that answered.
		expect(exportsAsked(player)).toHaveLength(2);
		expect(player.libraryFeed.columns.length).toBeGreaterThan(0);
	});
});

// foobar2000 older than 2.0 has no media library a component can read, so
// `foo_jean` answers `canReadLibrary: false`. The user's music is still there,
// so every library view says why it cannot show it rather than that it is empty.
const OLDER_PLAYER = {
	summary: "Your library needs foobar2000 2.0 or newer.",
	fix: "Update foobar2000, then reload this page.",
};

const LIBRARY_VIEWS = [
	{ name: "All music", path: "/#/all", heading: /^All music$/ },
	{ name: "home", path: "/", heading: /Your library|of music/ },
	{ name: "the genres index", path: "/#/genres", heading: /^Genres$/ },
	{
		name: "an artist",
		path: `/#/artist/${encodeURIComponent("Babasónicos")}`,
		heading: /^Babasónicos$/,
	},
	{
		name: "search results",
		path: `/#/search/${encodeURIComponent("Babas")}`,
		heading: /^Babas$/,
	},
];

const EMPTY_NOTICE =
	/Nothing in your library yet\.|Nothing tagged .+? in your library\.|That record is not in your library\.|Nothing by .+? in your library\.|Nothing to show from your library yet\.|Nothing in your library carries a genre tag\./;

const libraryAsked = (player: FakePlayer) =>
	player.requests.filter((entry) => entry.path.startsWith("/api/library/"));

const expectOlderPlayerNotice = async (page: Page) => {
	const main = page.locator("main");
	await expect(main.getByText(OLDER_PLAYER.summary)).toBeVisible();
	await expect(main.getByText(OLDER_PLAYER.fix)).toBeVisible();
};

test.describe("a component that does not serve the library", () => {
	test.use({
		fooJean: { canReadLibrary: false },
	});

	for (const view of LIBRARY_VIEWS) {
		test(`${view.name} says the library needs a newer foobar2000, and asks it for nothing`, async ({
			page,
			player,
		}) => {
			await page.goto(view.path);
			await expectOlderPlayerNotice(page);

			// One read, not a retrying one: the notice is up, so anything of the
			// view still on screen was drawn beside it.
			const main = page.locator("main");
			const text = (await main.textContent()) ?? "";
			expect({
				buttons: await main
					.getByRole("button", { name: /^(Try again|Check again)$/ })
					.count(),
				heading: await main
					.getByRole("heading", { level: 1, name: view.heading })
					.count(),
				rows: await main.locator('[role="row"]').count(),
				shelves: await main
					.getByRole("navigation", { name: "Shelves" })
					.count(),
				genres: await main.getByRole("link", { name: /tracks?$/ }).count(),
				emptyNotice: EMPTY_NOTICE.test(text),
			}).toEqual({
				buttons: 0,
				heading: 0,
				rows: 0,
				shelves: 0,
				genres: 0,
				emptyNotice: false,
			});

			await expectSettlesAt(player, () => libraryAsked(player).length, 0);
		});
	}
});

test.describe("a library that moved while Jean was open", () => {
	test.use({
		fooJean: {},
		countsPlays: true,
	});

	test("a play count that advanced arrives as a patch, not a second export", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		const plays = playsOf(page, 0);
		const before = Number(await plays.innerText());

		// Playing the second row is what makes the first stop being the active track, which is when a
		// player with a playback-statistics component records the play.
		await trackRow(page, 0).dblclick();
		await trackRow(page, 1).dblclick();

		await expect(plays).toHaveText(String(before + 1), { timeout: 20_000 });
		expect(deltasAsked(player).length).toBeGreaterThan(0);
		expect(exportsAsked(player)).toHaveLength(1);
	});

	test("a play started at the player is counted the same way", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		const plays = playsOf(page, 0);
		const before = Number(await plays.innerText());
		const playlist = player.playlists.find((entry) =>
			entry.items.some((track) => track["%title%"] === "Rotten Apple"),
		)!;
		const index = playlist.items.findIndex(
			(track) => track["%title%"] === "Rotten Apple",
		);

		for (const row of [index, index === 0 ? 1 : 0]) {
			const answer = await page.request.post("/__control/play", {
				data: { playlistId: playlist.id, index: row },
			});
			expect(answer.ok()).toBe(true);
		}

		await expect(plays).toHaveText(String(before + 1), { timeout: 20_000 });
		expect(deltasAsked(player).length).toBeGreaterThan(0);
		expect(exportsAsked(player)).toHaveLength(1);
		expect(playRequests(player)).toHaveLength(0);
	});
});

test.describe("a library rebuilt under Jean", () => {
	test.use({
		fooJean: {},
		countsPlays: true,
	});

	test("the structure moving is another export rather than an error", async ({
		page,
		player,
	}) => {
		const handed: { url: string; structure: number; revision: number }[] = [];
		page.on("response", async (response) => {
			const url = response.url();
			if (
				response.status() !== 200 ||
				!/\/api\/library\/(export|changes)/.test(url)
			)
				return;
			const { structure, revision } = jlibHeaderOf(await response.body());
			handed.push({ url, structure, revision });
		});

		await openAllMusic(page);

		await trackRow(page, 0).dblclick();
		await trackRow(page, 1).dblclick();
		await anotherClientDeclares(page);

		await expect
			.poll(() => jeansExports(player).length, { timeout: 20_000 })
			.toBe(2);

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		await expect(trackRow(page, 0)).toContainText("Rotten Apple");

		const loaded = handed.find((entry) =>
			/\/api\/library\/export/.test(entry.url),
		)!;
		const held = new Set(
			handed
				.filter((entry) => entry.structure === loaded.structure)
				.map((entry) => entry.revision),
		);
		const asked = deltasAskedBefore(player, jeansExports(player)[1]).map(
			(entry) => {
				const query = new URLSearchParams(entry.path.split("?")[1]);
				return {
					structure: Number(query.get("structure")),
					heldRevision: held.has(Number(query.get("since"))),
				};
			},
		);
		expect(asked).toEqual(
			asked.map(() => ({ structure: loaded.structure, heldRevision: true })),
		);
	});
});

test.describe("a library rebuilt while Jean was reading the one before it", () => {
	test.use({ fooJean: {} });

	// The component reads the snapshot off the library it holds at that moment, so a
	// rescan that starts afterwards leaves what is on the wire a generation old.
	// Fetched as soon as it is asked for and handed to the page only once the test
	// says so, which is what puts the rebuild inside the read rather than before it.
	const holdTheExport = async (page: Page) => {
		let answered = () => {};
		let release = () => {};
		const onTheWire = new Promise<void>((resolve) => {
			answered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});

		await page.route(
			"**/api/library/export**",
			async (route) => {
				const response = await route.fetch();
				const body = await response.body();
				answered();
				await held;
				await route.fulfill({ response, body });
			},
			{ times: 1 },
		);

		return { onTheWire, release: () => release() };
	};

	// `GET /api/state`'s ETag covers the structure and the revision, so this is the
	// last 200 there will be until something else moves the player: every poll from
	// here answers 304, and a notice dropped now is a notice gone for good.
	const noticeOfTheRebuild = (page: Page, before: number) =>
		page.waitForResponse(
			async (response) =>
				response.url().endsWith("/api/state") &&
				response.status() === 200 &&
				((await response.json()) as { library: { structure: number } }).library
					.structure > before,
		);

	test("the track the rebuild added is on screen, and playing it is not refused", async ({
		page,
		player,
	}) => {
		const { onTheWire, release } = await holdTheExport(page);

		await page.goto("/#/all");
		await onTheWire;

		const known = pathsIn(player);
		const noticed = noticeOfTheRebuild(page, player.libraryFeed.structure);
		await changeLibrary(page, { add: 1 });
		await noticed;
		release();

		const added = player.libraryTracks.filter(
			(track) => !known.has(track["%path%"]),
		);
		expect(added).toHaveLength(1);
		const title = added[0]["%title%"];
		expect(
			player.libraryTracks.filter((track) => track["%title%"].includes(title)),
		).toHaveLength(1);

		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"55",
			{ timeout: 20_000 },
		);

		const row = rowByTitle(page, title);
		await scrollUntilMounted(page, row);
		await row.dblclick();

		await expect.poll(() => trackPlayed(player)).toBe(title);
	});
});

test.describe("tracks added and removed at the player", () => {
	test.use({ fooJean: {} });

	test("tracks removed leave the list as a splice, and the library is not exported again", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
		const exported = await everyPartLoaded(player);

		await changeLibrary(page, { remove: 3 });

		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			"51",
			{ timeout: 20_000 },
		);
		expect(player.libraryTracks).toHaveLength(51);
		const last = rowTitled(page, titleAtOrdinal(player, 50));
		await scrollUntilMounted(page, last);
		await expect(last).toHaveAttribute("data-row", "50");
		await expectSettlesAt(player, () => everyExport(player).length, exported);
	});

	test("an add and a remove asked together are one rebuild", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		const before = await libraryState(page);

		await changeLibrary(page, { add: 2, remove: 1 });

		await expect
			.poll(async () => (await libraryState(page)).structure)
			.not.toBe(before.structure);
		expect(await libraryState(page)).toMatchObject({
			structure: before.structure + 1,
			trackCount: before.trackCount + 1,
		});
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(before.trackCount + 1),
			{ timeout: 20_000 },
		);
	});

	test("waits out a halted library before the structure moves", async ({
		page,
	}) => {
		await openAllMusic(page);
		const before = await libraryState(page);
		await page.request.post("/__control/libraryHalted", {
			data: { halted: true },
		});

		await changeLibrary(page, { add: 1 });

		for (const _ of [1, 2])
			expect(await libraryState(page)).toMatchObject({
				halted: true,
				structure: before.structure,
			});

		await page.request.post("/__control/libraryHalted", {
			data: { halted: false },
		});

		await expect
			.poll(async () => (await libraryState(page)).structure)
			.toBe(before.structure + 1);
		expect((await libraryState(page)).trackCount).toBe(before.trackCount + 1);
	});
});

test.describe("an album added at the player", () => {
	test.use({
		fooJean: {},
		libraryShape: { tracks: 600, albums: 40, artists: 8 },
	});

	const ALBUM = 10;

	const addAnAlbum = async (page: Page, player: FakePlayer) => {
		const known = pathsIn(player);
		await changeLibrary(page, { add: ALBUM });
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(600 + ALBUM),
			{ timeout: 20_000 },
		);
		const added = player
			.ordinalOrder()
			.flatMap((entry, ordinal) =>
				known.has(entry.track["%path%"]) ? [] : [ordinal],
			);
		expect(added).toHaveLength(ALBUM);
		return added;
	};

	test("is listed where the player puts it, and the library is not exported again", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		const exported = await everyPartLoaded(player);

		const added = await addAnAlbum(page, player);

		for (const ordinal of [added[0], added.at(-1)!, added.at(-1)! + 1]) {
			const row = rowTitled(page, titleAtOrdinal(player, ordinal));
			await scrollUntilMounted(page, row);
			await expect(row).toHaveAttribute("data-row", String(ordinal));
		}
		await expectSettlesAt(player, () => everyExport(player).length, exported);
	});

	test("a row past it plays the track it shows", async ({ page, player }) => {
		await openAllMusic(page);
		const added = await addAnAlbum(page, player);
		const ordinal = added.at(-1)! + 200;
		const title = titleAtOrdinal(player, ordinal);

		const row = trackRow(page, ordinal);
		await scrollUntilMounted(page, row);
		await expect(row).toContainText(title);
		await row.dblclick();

		await expect.poll(() => trackPlayed(player)).toBe(title);
	});
});

test.describe("playing a set out of the library", () => {
	test.use({ fooJean: {} });

	test("asks the component for its scratch playlist by role, titled, and makes or renames none", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);

		await trackRow(page, 3).dblclick();

		await expectSettlesAt(player, () => scratchFills(player).length, 1);
		// The title rides the call that makes the playlist. Jean's four `#Jean…`
		// readers key on it, and the playlist list is read on a poll, so a playlist
		// that exists under another name for one poll is a playlist that surfaced.
		expect(scratchFills(player)[0].body?.title).toBe("#Jean [all music]");
		expect(playlistsMade(player)).toHaveLength(0);
		expect(playlistsRenamed(player)).toHaveLength(0);

		expect(scratchOf(player)?.items).toHaveLength(54);
		await openSidebar(page);
		// The pair, because either half alone passes against a filter that is
		// wrong in one direction: the playlist the component made for this fill is
		// out, and the user's own, which only shares its title's prefix, is in.
		await expect(sidebar(page).getByText("#Jean [all music]")).toHaveCount(0);
		await expect(sidebar(page).getByText("#Jean Library")).toHaveCount(1);
	});

	test("a second row from the same view plays without filling the playlist again", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await trackRow(page, 3).dblclick();
		await expectSettlesAt(player, () => scratchFills(player).length, 1);

		await trackRow(page, 8).dblclick();

		await expect.poll(() => playedFrom(player)?.index).toBe(8);
		await expectSettlesAt(player, () => scratchFills(player).length, 1);
	});
});

test.describe("the order a library set plays in", () => {
	// Synthesised rather than captured: these tracks sit in a different order by
	// tag than by path, so a set filled in path order rather than in the
	// component's library order would land scrambled.
	test.use({
		fooJean: {},
		mediaLibrarySize: 4000,
	});

	test("plays the row that was clicked", async ({ page, player }) => {
		await openAllMusic(page);

		await trackRow(page, 12).dblclick();

		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		await expect(trackRow(page, 12)).toContainText(trackPlayed(player)!);
	});
});

test.describe("a second view played before the first one has landed", () => {
	test.use({ fooJean: {} });

	// The component applies fills in the order they arrived, so the later click
	// wins the playlist whichever response Jean waited for. What is left to get
	// wrong is the response: acting on the abandoned one starts the wrong track.
	test("plays only the view that was clicked last, never the one it gave up on", async ({
		page,
		player,
	}) => {
		await page.request.post("/__control/latency", { data: { ms: 1200 } });

		await page.goto("/#/search/babasonicos");
		await expect(trackRow(page, 0)).toBeAttached();
		await trackRow(page, 0).dblclick();

		await openAllMusic(page);
		await trackRow(page, 3).dblclick();

		await page.request.post("/__control/latency", { data: { ms: 0 } });

		await expectSettlesAt(player, () => playsAsked(player), [3]);
		expect(scratchOf(player)?.title).toBe("#Jean [all music]");
		expect(scratchOf(player)?.items).toHaveLength(54);
	});
});

test.describe("a view whose fill was refused because the library moved", () => {
	test.use({ fooJean: {} });

	// Two genres the captured library holds the same number of tracks in, so the
	// row counts agree after a refused fill and the playlist's title is the only
	// thing left saying which of them is in there.
	const HELD = "Alternative Rock";
	const ASKED = "Indie Rock";

	// Different rows in each view, so a track played from the wrong one is never the
	// track that was already playing.
	const HELD_ROW = 0;
	const ASKED_ROW = 3;

	const openGenre = async (page: Page, genre: string) => {
		await page.goto(`/#/genre/${encodeURIComponent(genre)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: genre }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
	};

	// Jean re-reads the library when the tab comes back, which is what a 409 asks of
	// a client: export again, then ask again. Given here so the click that follows has
	// a current snapshot to fill from.
	const comeBackToTheTab = (page: Page) =>
		page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

	// The rebuild lands while the fill is held: 409, nothing inserted, and the
	// playlist still holding and naming the first view.
	const refuseAFill = async (page: Page, player: FakePlayer) => {
		await openGenre(page, HELD);
		await trackRow(page, HELD_ROW).dblclick();
		await expectSettlesAt(player, () => scratchFills(player).length, 1);

		await openGenre(page, ASKED);
		await page.request.post("/__control/latency", { data: { ms: 1200 } });

		const refused = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/playlists/own/scratch/items") &&
				response.status() === 409,
		);
		await trackRow(page, ASKED_ROW).dblclick();
		await expect.poll(() => scratchFills(player).length).toBe(2);

		await anotherClientDeclares(page);
		await page.request.post("/__control/latency", { data: { ms: 0 } });
		await refused;
	};

	test("asking for it again plays its own rows, not the ones the playlist kept", async ({
		page,
		player,
	}) => {
		await refuseAFill(page, player);
		await comeBackToTheTab(page);
		await expect.poll(() => jeansExports(player).length).toBe(2);

		await trackRow(page, ASKED_ROW).dblclick();

		await expect.poll(() => playRequests(player)).toHaveLength(2);
		await expect(trackRow(page, ASKED_ROW)).toContainText(
			trackPlayed(player) as string,
		);
	});

	test("the refusal is caught rather than reaching the page as an uncaught error", async ({
		page,
		player,
	}) => {
		const uncaught: string[] = [];
		page.on("pageerror", (error) => uncaught.push(error.message));

		await refuseAFill(page, player);

		await expectSettlesAt(player, () => uncaught, []);
	});
});

test.describe("a view another device played over this one's", () => {
	test.use({ fooJean: {} });

	// Another device fills the one scratch playlist every client shares, straight
	// through the component, and leaves nothing behind in this page's storage.
	const playFromAnotherDevice = async (page: Page, title: string) => {
		const state = await (await page.request.get("/api/state")).json();
		const filled = await page.request.post("/api/playlists/own/scratch/items", {
			data: { title, structure: state.library.structure, ordinals: [0] },
		});
		expect(filled.ok()).toBe(true);
		const { playlistId } = await filled.json();
		const played = await page.request.post(
			`/api/playlists/${playlistId}/items/0/play`,
			{ data: {} },
		);
		expect(played.ok()).toBe(true);
	};

	test("is what this device says it is playing from", async ({ page }) => {
		await page.goto(`/#/genre/${encodeURIComponent("Alternative Rock")}`);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, "Alternative Rock");

		await playFromAnotherDevice(page, "#Jean [genre: Indie Rock]");

		await expectPlayingFrom(page, "Indie Rock");
	});
});

test.describe("the scratch playlist addressed by its id", () => {
	test.use({ fooJean: {} });

	test("refuses every edit to its rows or its place, as the player does", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();
		const state = await (await page.request.get("/api/state")).json();
		const filled = await page.request.post("/api/playlists/own/scratch/items", {
			data: {
				title: "#Jean [all music]",
				structure: state.library.structure,
				ordinals: [0],
			},
		});
		expect(filled.ok()).toBe(true);
		const { playlists } = await (
			await page.request.get("/api/playlists")
		).json();
		const scratch = playlists.find(
			(entry: { role: string | null }) => entry.role === "scratch",
		);
		const other = playlists.find(
			(entry: { role: string | null; itemCount: number }) =>
				entry.role === null && entry.itemCount > 0,
		);

		const edits = {
			move: { index: 0 },
			"items/copy": { source: other.id, runs: [[0, 1]] },
			"items/remove": { structure: scratch.structure, runs: [[0, 1]] },
			items: { structure: state.library.structure, runs: [[0, 1]] },
		};
		for (const [route, data] of Object.entries(edits)) {
			const answer = await page.request.post(
				`/api/playlists/${scratch.id}/${route}`,
				{ data },
			);
			expect(answer.status(), route).toBe(403);
			expect((await answer.json()).error, route).toContain("foo_jean's own");
		}
	});
});

test.describe("a playlist edit refused two ways", () => {
	test.use({ fooJean: {} });

	const ABSENT_PLAYLIST_GUID = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

	test("gets the refusal the player weighs first", async ({ page, player }) => {
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();
		const locked = player.playlists.find(
			(entry) => !entry.isAuto && entry.items.length > 0,
		)!;
		player.fooJean.lockedPlaylists.add(locked.id);

		const copied = await page.request.post(
			`/api/playlists/${locked.guid}/items/copy`,
			{
				data: {
					source: ABSENT_PLAYLIST_GUID,
					runs: [[0, 1]],
				},
			},
		);
		expect(copied.status(), "a copy into it from nowhere").toBe(409);

		const filled = await page.request.post(
			`/api/playlists/${locked.guid}/items`,
			{ data: { runs: [[0, 1]] } },
		);
		expect(filled.status(), "a fill into it with no structure").toBe(400);
	});
});

test.describe("filing a library row into a playlist of your own", () => {
	test.use({ fooJean: {} });

	test("goes to the component by playlist id", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		const before = titlesIn(player, FAVORITES);

		await fileInto(page, isMobile, 2, FAVORITES);

		await expect(toastRegion(page)).toContainText(
			`Added 1 track to ${FAVORITES}`,
		);

		// The row that was clicked rather than merely a row: a ref is an ordinal in
		// the component's library order, which is not the order of the paths.
		const after = titlesIn(player, FAVORITES);
		expect(after).toHaveLength(before.length + 1);
		await expect(trackRow(page, 2)).toContainText(after.at(-1) as string);

		await expectSettlesAt(player, () => addsSent(player), 1);
	});

	test("the sidebar row lights up as a drop target, and the dropped row is filed there", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "dragging a row onto a playlist is mouse-only");

		await openAllMusic(page);
		await openSidebar(page);
		const before = titlesIn(player, FAVORITES);

		const target = sidebarRow(page, FAVORITES);
		await dragFrom(page, trackRow(page, 2), target);
		await expect(target).toHaveAttribute("data-drop-over", "true");
		await page.mouse.up();

		await expect(toastRegion(page)).toContainText(
			`Added 1 track to ${FAVORITES}`,
		);

		await expect
			.poll(() => titlesIn(player, FAVORITES).length)
			.toBe(before.length + 1);
		const after = titlesIn(player, FAVORITES);
		await expect(trackRow(page, 2)).toContainText(after.at(-1) as string);

		await expectSettlesAt(player, () => addsSent(player), 1);
	});

	test.describe("where the player owner has turned playlist writes off", () => {
		test.use({ fooJean: { canWritePlaylists: false } });

		test("the sidebar row never offers itself as a drop target, and no fill is sent", async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(isMobile, "dragging a row onto a playlist is mouse-only");

			await openAllMusic(page);
			await openSidebar(page);
			const before = titlesIn(player, FAVORITES);

			const target = sidebarRow(page, FAVORITES);
			await dragFrom(page, trackRow(page, 2), target);

			// Read while a row is still held over the sidebar: `data-receiving` is what
			// says the drag reached it at all, so the missing target is a refusal rather
			// than a gesture that never started.
			await expect(sidebar(page)).toHaveAttribute("data-receiving", "true");
			await expect(target).not.toHaveAttribute("data-drop-target");
			await expect(target).not.toHaveAttribute("data-drop-over");
			await page.mouse.up();

			await expectSettlesAt(player, () => addsSent(player), 0);
			expect(titlesIn(player, FAVORITES)).toEqual(before);
		});

		test("the same row still queues", async ({ page, player, isMobile }) => {
			await openAllMusic(page);
			await openRowMenu(page, isMobile, 2, /^Add to queue$/);

			const queue = menuItem(page, "Add to queue");
			// Named rather than left to the click's own actionability wait, which
			// reports a timeout where the real answer is that the item was refused.
			await expect(queue).toBeEnabled();
			await queue.click();

			await expect
				.poll(() => player.playQueue.length, { timeout: 10_000 })
				.toBe(1);
		});

		// Nothing about this install can make the item work, so the menu is one row
		// shorter rather than carrying one that explains itself.
		test("Add to playlist is not in the row menu at all", async ({
			page,
			isMobile,
		}) => {
			await openAllMusic(page);
			await openRowMenu(page, isMobile, 2, /^Add to queue$/);

			await expect(addToPlaylist(page)).toHaveCount(0);
		});
	});

	test.describe("on a component too old to report the setting at all", () => {
		test.use({ fooJean: { canWritePlaylists: "absent" } });

		test("Add to playlist still offers the playlists a row can go to", async ({
			page,
			isMobile,
		}) => {
			await openAllMusic(page);
			await openRowMenu(page, isMobile, 2, /^Add to queue$/);

			await expect(addToPlaylist(page)).toBeEnabled();
			await addToPlaylist(page).click();
			await expect(menuItem(page, FAVORITES)).toBeVisible();
		});
	});
});
