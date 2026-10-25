import { albumRoute, shelfRoute } from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	coversFromTheComponent,
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	inSequence,
	OFFERS_NO_SHUFFLE,
	openSidebar,
	playedFrom,
	playerDeclaring,
	playRequests,
	requestsTo,
	rowByTitle,
	scratchOf,
	sidebar,
	test,
	trackRow,
	untilQuiet,
	untilTheInstallIsKnown,
	viewHeader,
} from "./fixtures.ts";
import {
	expectPendingRowsPlayByPosition,
	expectTheSetAskedOnce,
	latestAnswer,
	recordLibraryTraffic,
	untilRowsAreHeld,
} from "./libraryLists.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// Recently played has a heading of its own. Every other shelf is inside
// Explore, whose row is whichever tab is active, so it is addressed by its tab.
const shelf = (page: Page, title: string) =>
	page.getByRole("heading", { level: 2, name: title });

const explore = (page: Page) => page.getByRole("region", { name: "Explore" });

const tab = (page: Page, title: string) =>
	page
		.getByRole("navigation", { name: "Shelves" })
		.getByRole("button", { name: title, exact: true });

const albumInExplore = (page: Page, album: string | RegExp) =>
	explore(page).getByRole("button", { name: album });

test.describe("the home screen", () => {
	test("it is where the root lands, not a playlist", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await expect(tab(page, "Most played")).toBeVisible();
	});

	test("the sidebar reads search, home, all music, then playlists", async ({
		page,
	}) => {
		await page.goto("/");
		await openSidebar(page);

		// The list arrives a poll after the static rows above it, so a read taken
		// the instant the sidebar opens can still be missing it.
		await expect(
			sidebar(page).getByRole("button", { name: "Default Playlist" }),
		).toBeVisible();

		const labels = await sidebar(page).getByRole("button").allInnerTexts();
		const home = labels.findIndex((entry) => entry.startsWith("Home"));
		const all = labels.findIndex((entry) => entry.startsWith("All music"));
		const firstPlaylist = labels.findIndex((entry) =>
			entry.startsWith("Default Playlist"),
		);

		expect(home).toBeGreaterThanOrEqual(0);
		expect(all).toBe(home + 1);
		expect(firstPlaylist).toBeGreaterThan(all);
	});

	test("a shelf says why each record is on it", async ({ page }) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		await expect(page.getByText(/[\d,]+ plays$/).first()).toBeVisible();
	});
});

test.describe("the library header", () => {
	test("it leads with the time, and counts underneath", async ({ page }) => {
		await page.goto("/");

		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toContainText(
			"of music",
		);
		// Uppercased in CSS, so the text itself is still sentence case.
		await expect(header).toContainText("Your library");

		await inSequence(["tracks", "albums", "artists"], (label: string) =>
			expect(header.getByText(label, { exact: true })).toHaveCount(1),
		);
		await expect(header.getByText("playlists", { exact: true })).toHaveCount(0);
	});

	test("each card ends in something to press", async ({ page, isMobile }) => {
		await page.goto("/");
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toBeVisible();

		await expect(header.locator('[data-door="albums"]')).toContainText(
			"most played",
		);
		await expect(header.locator('[data-door="artists"]')).toContainText(
			"most played",
		);

		// A link rather than a button, so cmd-click opens All music in a tab. The
		// role is the claim; a selector matching the href was a way of spelling it.
		// Desktop only: the phone hides this card in CSS, so it has no role at all
		// there -- and cmd-click is not a gesture a phone has.
		test.skip(isMobile, "the tracks card is not drawn on a phone");
		await expect(header.getByRole("link", { name: /tracks/ })).toHaveCount(1);
	});

	// Named for what it asserts: the negative half is the describe below, and a
	// future reader finding two tests under one promise deletes the wrong one.
	test("the genres block is drawn when the player has genre tags", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Genres" })).toBeVisible();
	});
});

test.describe("a library with no genre tag", () => {
	test.use({ withoutFields: ["%genre%"] });

	test("says nothing about genres rather than saying zero", async ({
		page,
	}) => {
		await page.goto("/");
		const header = viewHeader(page);
		await expect(header.getByRole("heading", { level: 1 })).toBeVisible();

		await expect(page.getByRole("region", { name: "Genres" })).toHaveCount(0);
		await expect(
			page.getByRole("region", { name: "Your top tracks" }),
		).toBeVisible();
	});
});

test.describe("the closing band", () => {
	test("a top track opens All music and starts there", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		const tracks = page.getByRole("region", { name: "Your top tracks" });
		await expect(tracks).toBeVisible();

		const first = tracks.getByRole("button").first();
		const title = (await first.getAttribute("title"))?.split(" — ").pop();
		await first.click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);
		expect(scratchOf(player)!.title).toBe("#Jean [all music]");
		await expect
			.poll(() => scratchOf(player)!.items[playedFrom(player)?.index ?? -1])
			.toMatchObject({ "%title%": title });
	});

	test("a genre bar opens exactly the tracks it counted", async ({ page }) => {
		await page.goto("/");
		const bars = page.getByRole("region", { name: "Genres" });
		await expect(bars).toBeVisible();

		// The search index covers title, artist and album, not genre, so the bar
		// cannot be a search.
		// Scoped to the list: the section's heading is a link as well, and it opens
		// the genres index rather than a genre.
		const first = bars.getByRole("list").getByRole("link").first();
		const [genre, count] = (await first.innerText()).split("\n");
		await first.click();

		await expect(
			page.getByRole("heading", { level: 1, name: genre.trim() }),
		).toBeVisible();

		// `refsOfGenre` matches the tag the way `summarise` counts it: whole, and
		// through `tagKey`.
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			count.trim().replace(/,/g, ""),
		);
	});
});

test.describe("starting the library from the front door", () => {
	const headerButton = (page: Page, name: string) =>
		viewHeader(page).getByRole("button", { name, exact: true });

	const modesSent = (player: FakePlayer) =>
		player.requests
			.filter(
				(entry) =>
					entry.method === "POST" && entry.path === "/api/playback/mode",
			)
			.map((entry) => entry.body?.mode);

	test("Play opens All music and starts at the beginning", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(headerButton(page, "Play")).toBeVisible();
		await headerButton(page, "Play").click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);
		expect(scratchOf(player)!.title).toBe("#Jean [all music]");

		await expect.poll(() => playedFrom(player)?.index).toBe(0);

		// The playback order is global player state, and Play leaves it alone.
		await expectSettlesAt(player, () => modesSent(player), []);
	});

	test("Shuffle opens All music and turns the mode on", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await headerButton(page, "Shuffle").click();

		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expectSettlesAt(
			player,
			() => scratchOf(player)?.items.length ?? 0,
			54,
		);

		await expect.poll(() => modesSent(player)).toContain("shuffleTracks");
		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)!.guid);
	});

	test("either one agrees with the sidebar and the status bar", async ({
		page,
	}) => {
		await page.goto("/");
		await headerButton(page, "Shuffle").click();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		// Before the drawer: on a phone the sidebar covers the status bar.
		await expectPlayingFrom(page, "All music");
		await openSidebar(page);
		await expect(
			sidebar(page)
				.getByRole("button", { name: /All music/ })
				.getByLabel("Playing from here"),
		).toBeVisible();
	});
});

// Plain Shuffle is Shuffle tracks, or Random where the player has no Shuffle tracks. A player with
// neither has nothing for it to turn on, whatever else it shuffles by.
for (const [offer, playerState] of [
	["no shuffle", OFFERS_NO_SHUFFLE],
	[
		"Shuffle albums and Shuffle folders, and neither Shuffle tracks nor Random",
		playerDeclaring(["Default", "Shuffle (albums)", "Shuffle (folders)"]),
	],
] as const) {
	test.describe(`a front door on a player that offers ${offer}`, () => {
		test.use({ playerState });

		test("Shuffle goes and Play stays", async ({ page, player }) => {
			await page.goto("/");
			const head = viewHeader(page);
			await expect(
				head.getByRole("button", { name: "Play", exact: true }),
			).toBeVisible();
			await untilTheInstallIsKnown(player);
			await expect(
				head.getByRole("button", { name: "Shuffle", exact: true }),
			).toHaveCount(0);
		});
	});
}

test.describe("a front door with the component answering", () => {
	test("Play and Shuffle are both offered", async ({ page }) => {
		await page.goto("/");
		const head = viewHeader(page);
		await expect(
			head.getByRole("button", { name: "Play", exact: true }),
		).toBeEnabled();
		await expect(
			head.getByRole("button", { name: "Shuffle", exact: true }),
		).toBeEnabled();
	});
});

test.describe("all music", () => {
	test("it is the library with no filter on it", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");
	});
});

// The captured plays are months old, and Recently played only holds the last
// thirty days, so one track of each played album is moved to two days ago.
const twoDaysAgo = (() => {
	const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
	);
})();

const PLAYED_LATELY = Object.fromEntries(
	["Los Calientes", "Tautou", "Nutshell", "Bloodhail"].map((title) => [
		title,
		{ "%lastfm_last_played%": twoDaysAgo },
	]),
);

test.describe("opening a shelf from its heading", () => {
	test.use({ retagged: PLAYED_LATELY });

	test("Explore opens whichever tab is showing, and starts nothing", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		await page.getByRole("link", { name: "Explore" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();

		await expectSettlesAt(player, () => scratchOf(player), undefined);
		await expectSettlesAt(player, () => playRequests(player).length, 0);
		expect(player.player.playbackState).toBe("stopped");
	});

	test("it leaves what is already playing alone", async ({ page, player }) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();
		await albumInExplore(page, /^Jessico/).click();
		// Polled on playback rather than on the fill: the playlist is written first
		// and played a round trip later, so the active item reads -1 until then.
		await expect
			.poll(() => player.player.activeItem.index)
			.toBeGreaterThanOrEqual(0);

		const playing = player.player.activeItem.index;
		// `#/home` rather than the front door, which reopens the now-playing screen
		// over whatever is playing. What this test is about is the heading link.
		await page.goto("/#/home");
		await expect(shelf(page, "Recently played")).toBeVisible();
		await page.getByRole("link", { name: "Recently played" }).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Recently played" }),
		).toBeVisible();

		expect(scratchOf(player)!.title).toBe("#Jean [shelf: Most played]");
		expect(player.player.activeItem.index).toBe(playing);
	});

	test("the blurb under Recently played is not a target", async ({ page }) => {
		await page.goto("/");
		await expect(shelf(page, "Recently played")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Recently played" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /Where you have been lately/ }),
		).toHaveCount(0);
	});

	test("Recently played is a row of its own and never also a tab", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(shelf(page, "Recently played")).toBeVisible();

		await expect(tab(page, "Recently played")).toHaveCount(0);

		await expect(tab(page, "Most played")).toHaveAttribute(
			"aria-current",
			"true",
		);
	});
});

test.describe("playing from a shelf", () => {
	test("it plays the whole row, starting at the album you clicked", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();
		expect(scratchOf(player)).toBeUndefined();

		// Jessico is not first on this shelf, so this also proves the click starts
		// where it was aimed.
		await albumInExplore(page, /^Jessico/).click();

		// Polled on the contents rather than the title: the playlist is named when
		// it is created and filled a round trip later, so a title assertion passes
		// while it is still empty.
		await expect
			.poll(() => scratchOf(player)?.items.length ?? 0)
			.toBeGreaterThan(12);
		const scratch = scratchOf(player);
		expect(scratch!.title).toBe("#Jean [shelf: Most played]");
		await expect.poll(() => playedFrom(player)?.id).toBe(scratch!.guid);
		expect(scratch!.items[playedFrom(player)!.index]["%title%"]).toBe(
			"Los Calientes",
		);

		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();
		await expect(
			page.locator('[role="row"][data-active="true"]'),
		).toContainText("Los Calientes");
	});
});

test.describe("an install with no play counts", () => {
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
		firstRun: true,
		settings: { "jean.settingsSeen": true },
	});

	test("the shelves that need them are simply not there", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();

		await expect(tab(page, "Most played")).toHaveCount(0);
		await expect(shelf(page, "Recently played")).toHaveCount(0);
		await expect(tab(page, "Remember these?")).toHaveCount(0);
	});

	test("and the screen still opens on something to press", async ({ page }) => {
		await page.goto("/");

		// Start somewhere is drawn at random and needs no listening history.
		await expect(tab(page, "Start somewhere")).toBeVisible();
		await expect(explore(page).getByRole("button").first()).toBeVisible();
	});
});

test.describe("where you are, in the sidebar", () => {
	const current = (page: Page) =>
		sidebar(page).locator('[aria-current="true"]');

	test("a library route does not also light up a playlist", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Home");

		await sidebar(page).getByRole("button", { name: "All music" }).click();
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("All music");

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await openSidebar(page);
		await expect(current(page)).toHaveCount(1);
		await expect(current(page)).toContainText("Rock en Español");
	});
});

test.describe("a shelf says it is playing", () => {
	test("it appears in the sidebar and in the status bar, and survives leaving it", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await expect(tab(page, "Most played")).toBeVisible();

		// Checked without opening the drawer: on a phone it would cover the card
		// the next line clicks.
		await expect(
			sidebar(page).getByRole("button", { name: "Most played" }),
		).toHaveCount(0);

		await albumInExplore(page, /^Jessico/).click();

		await expectPlayingFrom(page, "Most played");

		await openSidebar(page);
		const row = sidebar(page).getByRole("button", { name: /Most played/ });
		await expect(row).toBeVisible();
		await expect(row.getByLabel("Playing from here")).toBeVisible();

		const guid = player.playlists.find(
			(entry) => entry.title === "Rock en Español",
		)!.guid;
		await page.goto(`/#/${guid}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await openSidebar(page);
		await expect(
			sidebar(page).getByRole("button", { name: /Most played/ }),
		).toBeVisible();
	});
});

const holdTheSummary = async (page: Page) => {
	const answer = await page.request.post("/__control/holdSummary", {
		data: { hold: true },
	});
	expect(answer.ok(), "the fake holds the summary on request").toBe(true);
};

const releaseTheSummary = async (page: Page) => {
	const answer = await page.request.post("/__control/holdSummary", {
		data: {},
	});
	expect(answer.ok(), "the fake answers every summary it held").toBe(true);
};

const summaryAsks = (player: FakePlayer) =>
	requestsTo(player, "/api/library/summary").filter(
		(entry) => entry.method === "GET",
	);

const untilTheSummaryIsAsked = (player: FakePlayer) =>
	expect
		.poll(() => summaryAsks(player).length, {
			message: "Jean never asked for the summary",
		})
		.toBeGreaterThan(0);

interface ShelfPageSeen {
	emptyView: string | null;
}

const recordTheShelfPage = (page: Page) =>
	page.addInitScript((empty) => {
		const seen: ShelfPageSeen = { emptyView: null };
		Reflect.set(window, "__shelfPage", seen);
		new MutationObserver(() => {
			const main = document.querySelector("main")?.textContent ?? "";
			if (seen.emptyView === null && main.includes(empty))
				seen.emptyView = main;
		}).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	}, en["library.empty"]);

const shelfPageSeen = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__shelfPage") as ShelfPageSeen);

const busyInMain = (page: Page) =>
	page.locator('main[aria-busy="true"], main [aria-busy="true"]');

const theWait = (page: Page) =>
	busyInMain(page)
		.or(page.locator("main").getByText(en["library.reading"]))
		.first();

const expectTheShelfPageWaits = async (
	page: Page,
	player: FakePlayer,
	title: string,
) => {
	await expect(
		page.getByRole("heading", { level: 1, name: title }),
	).toBeVisible();
	await untilTheSummaryIsAsked(player);
	await expect(
		theWait(page),
		"the shelf page shows no wait while the summary is held",
	).toBeVisible();
};

const expectNothingEmptyWasShown = async (page: Page) => {
	const { emptyView } = await shelfPageSeen(page);
	expect(emptyView, "the shelf page said the library is empty").toBeNull();
};

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

// One pixel either way: a box laid out at a fractional offset rounds differently from one frame to
// the next, and a move worth seeing is a shelf's height, not a subpixel.
const PIXEL = 1;

const expectSameBox = (actual: Box | undefined, expected: Box, what: string) =>
	expect(
		actual !== undefined &&
			(["x", "y", "width", "height"] as const).every(
				(side) => Math.abs(actual[side] - expected[side]) <= PIXEL,
			),
		`${what}: ${JSON.stringify(actual)} where ${JSON.stringify(expected)} was`,
	).toBe(true);

const boxOf = async (locator: Locator): Promise<Box> => {
	const box = await locator.boundingBox();
	expect(box, "a box for something on screen").not.toBeNull();
	return box as Box;
};

const settled = async <T>(read: () => Promise<T>): Promise<T> => {
	let last = "";
	await expect
		.poll(
			async () => {
				const now = JSON.stringify(await read());
				const same = now === last;
				last = now;
				return same;
			},
			{ intervals: [250] },
		)
		.toBe(true);
	return JSON.parse(last) as T;
};

const SHELF_REGIONS = ["Recently added", "Recently played", "Explore"];

const drawnShelves = async (page: Page) => {
	await expect(busyInMain(page)).toHaveCount(0);
	const boxes: { name: string; box: Box }[] = [];
	for (const name of SHELF_REGIONS) {
		const region = page.getByRole("region", { name, exact: true });
		if ((await region.count()) > 0)
			boxes.push({ name, box: await boxOf(region) });
	}
	return boxes;
};

interface Skeleton {
	box: Box;
	notes: number;
	hidden: boolean;
}

const skeletonsUnderTheHeader = (page: Page) =>
	page.evaluate((loading) => {
		const main = document.querySelector("main");
		if (!main) return [];
		const header = main.querySelector("header");
		const isOutermost = (element: Element) => {
			const above = element.parentElement?.closest('[aria-busy="true"]');
			return !above || above === main;
		};
		return [...main.querySelectorAll('[aria-busy="true"]')]
			.filter((element) => isOutermost(element) && !header?.contains(element))
			.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				const notes = [...element.querySelectorAll("*")].filter(
					(node) =>
						node.childElementCount === 0 &&
						node.textContent?.trim() === loading,
				);
				return {
					box: { x, y, width, height },
					notes: notes.length,
					hidden: notes.every((note) => {
						const box = note.getBoundingClientRect();
						return box.width <= 1 && box.height <= 1;
					}),
				};
			})
			.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
	}, en["skeleton.loading"]);

const untilSkeletons = async (page: Page, atLeast: number) => {
	await expect
		.poll(async () => (await skeletonsUnderTheHeader(page)).length, {
			message: "Home drew no skeleton for its shelves",
		})
		.toBeGreaterThanOrEqual(atLeast);
	return settled(() => skeletonsUnderTheHeader(page));
};

const expectOneHiddenNoteEach = (skeletons: Skeleton[]) =>
	expect(
		skeletons.map(({ notes, hidden }) => ({ notes, hidden })),
		"each skeleton is one busy element carrying one hidden Loading",
	).toEqual(skeletons.map(() => ({ notes: 1, hidden: true })));

const expectOnlyTheBandBelow = (skeletons: Skeleton[], lastShelf: Box) =>
	expect(
		skeletons.filter(
			({ box }) => box.y < lastShelf.y + lastShelf.height - PIXEL,
		),
		"a skeleton nobody guessed among the shelves",
	).toEqual([]);

interface HomeWait {
	busyAt: number | null;
	barShownAt: number | null;
}

const recordTheHomeWait = (page: Page) =>
	page.addInitScript(() => {
		const wait: HomeWait = { busyAt: null, barShownAt: null };
		Reflect.set(window, "__homeWait", wait);
		const isBar = (element: Element) =>
			element.getAttribute("aria-hidden") === "true" &&
			element.childElementCount === 0 &&
			!(element instanceof SVGElement);
		const isShown = (element: Element) => {
			const box = element.getBoundingClientRect();
			return (
				box.width > 0 &&
				box.height > 0 &&
				element.checkVisibility({
					opacityProperty: true,
					visibilityProperty: true,
				})
			);
		};
		const sample = () => {
			const busy = [
				...document.querySelectorAll(
					'main[aria-busy="true"], main [aria-busy="true"]',
				),
			];
			if (busy.length > 0) {
				wait.busyAt ??= performance.now();
				if (
					wait.barShownAt === null &&
					busy.some((one) =>
						[...one.querySelectorAll("*")].some(
							(element) => isBar(element) && isShown(element),
						),
					)
				)
					wait.barShownAt = performance.now();
			}
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});

const homeWaitSeen = (page: Page) =>
	page.evaluate(() => Reflect.get(window, "__homeWait") as HomeWait);

const stampDaysAgo = (days: number) => {
	const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
	);
};

const albumOf = (entry: { track: Record<string, unknown> }) =>
	String(entry.track["%album%"]);

const firstOrdinalOf = (player: FakePlayer, album: string) =>
	player.ordinalOrder().findIndex((entry) => albumOf(entry) === album);

const countAPlay = async (page: Page, ordinal: number) => {
	const answer = await page.request.post("/__control/play", {
		data: { ordinal },
	});
	expect(answer.ok(), "the fake counts a play by ordinal").toBe(true);
};

const albumsOn = async (region: Locator) =>
	(await region.getByRole("button").allInnerTexts()).filter(
		(text) => text.trim() !== "",
	);

test.describe("Recently added before the summary arrives", () => {
	const ARRIVED = {
		"Los Calientes": 1,
		Tautou: 3,
		"Rotten Apple": 5,
		"Break Blossom": 7,
		"A Quick One Before The Eternal Worm Devours Connecticut": 9,
	};
	const ALBUMS =
		/Jessico|Deja Entendu|Jar Of Flies|Lafcadio|Deathconsciousness/;

	const retagged: Record<string, Record<string, string>> = Object.fromEntries(
		Object.entries(ARRIVED).map(([title, days]) => [
			title,
			{ "%added%": stampDaysAgo(days) },
		]),
	);
	for (const [title, tags] of Object.entries(PLAYED_LATELY))
		retagged[title] = { ...retagged[title], ...tags };

	test.use({ retagged, fooJean: { holdSummary: true } });

	const holdsAPlaceholder = (region: Locator) =>
		region.evaluate((element) =>
			[
				...element.querySelectorAll('[aria-hidden="true"]:not(svg, button *)'),
			].some((block) => {
				const box = block.getBoundingClientRect();
				return box.width > 0 && box.height > 0;
			}),
		);

	test("with nothing kept, Home is quiet for 100 ms, then the whole layout waits as skeletons, and every shelf lands in its skeleton's place", {
		tag: "@iphone",
	}, async ({ page, player }) => {
		await recordTheHomeWait(page);
		await page.goto("/");
		await untilTheSummaryIsAsked(player);
		await expect(
			viewHeader(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();

		const skeletons = await untilSkeletons(page, 4);
		expectOneHiddenNoteEach(skeletons);
		const [added, recent, tabs] = skeletons;
		expectOnlyTheBandBelow(skeletons.slice(3), tabs.box);
		expect(
			await viewHeader(page).locator('[aria-busy="true"]').count(),
			"the header's numbers are not drawn as skeletons",
		).toBeGreaterThan(0);
		expect(await holdsAPlaceholder(page.locator("main"))).toBe(true);
		expect(
			await page.locator("main").getByRole("button", { name: ALBUMS }).count(),
			"a record was drawn before the summary arrived",
		).toBe(0);
		const header = await settled(() => boxOf(viewHeader(page)));

		const { busyAt, barShownAt } = await homeWaitSeen(page);
		expect(busyAt, "Home never drew its wait").not.toBeNull();
		expect(barShownAt, "no skeleton bar was ever shown").not.toBeNull();
		expect(
			(barShownAt as number) - (busyAt as number),
			"a skeleton bar was shown within 100 ms of Home starting to wait",
		).toBeGreaterThanOrEqual(100);

		await releaseTheSummary(page);
		await expect(
			page
				.getByRole("region", { name: "Recently added" })
				.getByRole("button", { name: /Jessico/ }),
		).toBeVisible();
		const landed = await settled(() => drawnShelves(page));

		expectSameBox(
			await boxOf(viewHeader(page)),
			header,
			"the header moved when the summary landed",
		);
		expect(landed.map(({ name }) => name)).toEqual(SHELF_REGIONS);
		expectSameBox(landed[0].box, added.box, "Recently added left its place");
		expectSameBox(landed[1].box, recent.box, "Recently played left its place");
		expectSameBox(landed[2].box, tabs.box, "Explore left its place");
	});

	test("its page opened by address waits for the summary, and is never drawn empty", async ({
		page,
		player,
	}) => {
		await recordTheShelfPage(page);
		await page.goto(`/#/${shelfRoute("added")}`);
		await expectTheShelfPageWaits(page, player, "Recently added");

		await releaseTheSummary(page);
		await scrollUntilMounted(page, rowByTitle(page, "Los Calientes"));
		await expect(rowByTitle(page, "Los Calientes")).toBeAttached();
		await expectNothingEmptyWasShown(page);
	});
});

test.describe("Time for an upgrade before the summary arrives", () => {
	test.use({ fooJean: { holdSummary: true } });

	test("its page opened by address waits for the summary, and is never drawn empty while it does", async ({
		page,
		player,
	}) => {
		await recordTheShelfPage(page);
		await page.goto(`/#/${shelfRoute("upgrade")}`);
		await expectTheShelfPageWaits(page, player, "Time for an upgrade");
		await expectNothingEmptyWasShown(page);

		await releaseTheSummary(page);
		await expect(busyInMain(page)).toHaveCount(0);
		await expect(
			page.locator("main").getByText(en["library.reading"]),
		).toHaveCount(0);
	});
});

test.describe("Home before the summary arrives, on a device that has drawn it", () => {
	const reloadWaiting = async (page: Page) => {
		await page.reload();
		await expect(
			viewHeader(page).getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	};

	test.describe("whose shelves have not changed since", () => {
		test.use({ retagged: PLAYED_LATELY });

		test("waits as the shelves it last drew, and nothing moves when they land", {
			tag: "@iphone",
		}, async ({ page, player }) => {
			await page.goto("/");
			await expect(shelf(page, "Recently played")).toBeVisible();
			const drawn = await settled(() => drawnShelves(page));
			expect(drawn.map(({ name }) => name)).toEqual([
				"Recently played",
				"Explore",
			]);

			await holdTheSummary(page);
			const asked = summaryAsks(player).length;
			await reloadWaiting(page);
			await expect
				.poll(() => summaryAsks(player).length)
				.toBeGreaterThan(asked);

			const skeletons = await untilSkeletons(page, drawn.length);
			expectOneHiddenNoteEach(skeletons);
			for (const [at, { name, box }] of drawn.entries())
				expectSameBox(
					skeletons[at]?.box,
					box,
					`the skeleton for ${name} is not where it was drawn`,
				);
			expectOnlyTheBandBelow(
				skeletons.slice(drawn.length),
				drawn[drawn.length - 1].box,
			);

			await releaseTheSummary(page);
			await expect(shelf(page, "Recently played")).toBeVisible();
			const landed = await settled(() => drawnShelves(page));
			expect(landed.map(({ name }) => name)).toEqual(
				drawn.map(({ name }) => name),
			);
			for (const [at, { name, box }] of drawn.entries())
				expectSameBox(landed[at].box, box, `${name} moved when it landed`);
		});
	});

	test.describe("that has lost a shelf since", () => {
		test.use({ retagged: PLAYED_LATELY });

		test("waits with the lost shelf's skeleton, then removes it and moves what was below it up", {
			tag: "@iphone",
		}, async ({ page, player }) => {
			await page.goto("/");
			await expect(shelf(page, "Recently played")).toBeVisible();
			const [recent, explore] = await settled(() => drawnShelves(page));
			expect([recent.name, explore.name]).toEqual([
				"Recently played",
				"Explore",
			]);

			await holdTheSummary(page);
			const order = player.ordinalOrder();
			const last = albumOf(order[order.length - 1]);
			const structure = player.libraryFeed.structure;
			const removed = await page.request.post("/__control/library", {
				data: { remove: order.length - firstOrdinalOf(player, last) },
			});
			expect(removed.ok()).toBe(true);

			await reloadWaiting(page);
			const skeletons = await untilSkeletons(page, 2);
			expectSameBox(
				skeletons[0].box,
				recent.box,
				"Recently played was not guessed where it was drawn",
			);
			expectSameBox(
				skeletons[1].box,
				explore.box,
				"Explore was not guessed where it was drawn",
			);

			await expect
				.poll(() => player.libraryFeed.structure, {
					message: "the library never moved past the tracks removed",
				})
				.toBeGreaterThan(structure);
			await releaseTheSummary(page);
			await expect(
				page
					.getByRole("region", { name: "Explore" })
					.getByRole("button")
					.first(),
			).toBeVisible();
			const landed = await settled(() => drawnShelves(page));

			expect(landed.map(({ name }) => name)).toEqual(["Explore"]);
			expect(
				landed[0].box.y,
				"Explore did not move up into the place Recently played left",
			).toBeCloseTo(recent.box.y, 0);
		});
	});

	test.describe("that has gained a shelf since", () => {
		test("waits as the shelves it last drew, then draws the new one in its place", {
			tag: "@iphone",
		}, async ({ page, player }) => {
			await page.goto("/");
			await expect(tab(page, "Most played")).toBeVisible();
			const drawn = await settled(() => drawnShelves(page));
			expect(drawn.map(({ name }) => name)).toEqual(["Explore"]);
			const [explore] = drawn;

			await holdTheSummary(page);
			for (const album of [
				"Jar Of Flies",
				"Jessico",
				"Deja Entendu",
				"Deathconsciousness",
			])
				await countAPlay(page, firstOrdinalOf(player, album));

			await reloadWaiting(page);
			const skeletons = await untilSkeletons(page, 1);
			expectSameBox(
				skeletons[0].box,
				explore.box,
				"Explore was not guessed where it was drawn",
			);
			expectOnlyTheBandBelow(skeletons.slice(1), explore.box);

			await releaseTheSummary(page);
			await expect(shelf(page, "Recently played")).toBeVisible();
			const landed = await settled(() => drawnShelves(page));

			expect(landed.map(({ name }) => name)).toEqual([
				"Recently played",
				"Explore",
			]);
			expect(
				landed[0].box.y,
				"Recently played was not drawn where the shelves begin",
			).toBeCloseTo(explore.box.y, 0);
			expect(landed[1].box.y).toBeGreaterThan(explore.box.y + PIXEL);
		});
	});
});

test.describe("Recently played while Home is open", () => {
	test.use({ retagged: PLAYED_LATELY });

	test("a play at the player puts its album first, without a reload", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		const recent = page.getByRole("region", {
			name: "Recently played",
			exact: true,
		});
		await expect(
			recent.getByRole("button", { name: /^Jessico/ }),
		).toBeVisible();
		expect(await albumsOn(recent)).not.toContainEqual(
			expect.stringMatching(/^Lafcadio/),
		);

		await countAPlay(page, firstOrdinalOf(player, "Lafcadio"));

		await expect
			.poll(async () => (await albumsOn(recent))[0])
			.toMatch(/^Lafcadio/);
	});
});

test.describe("a cover already drawn on another screen", () => {
	test("is not asked for again on Home", async ({ page, player }) => {
		const paths = new Set(
			player
				.ordinalOrder()
				.filter((entry) => albumOf(entry) === "Jessico")
				.map((entry) => entry.path),
		);
		const asks = () =>
			coversFromTheComponent(player).filter((track) => paths.has(track));

		await page.goto(`/#/${albumRoute("Babasónicos", "Jessico")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Jessico" }),
		).toBeVisible();
		await expect.poll(() => asks().length).toBeGreaterThan(0);
		await untilQuiet(player);
		const before = asks();

		await openSidebar(page);
		await sidebar(page).getByRole("button", { name: "Home" }).click();
		const card = albumInExplore(page, /^Jessico/);
		await expect(card).toBeVisible();
		await expect
			.poll(() =>
				card
					.locator("img")
					.evaluate(
						(image: HTMLImageElement) =>
							image.complete && image.naturalWidth > 0,
					),
			)
			.toBe(true);

		await expectSettlesAt(player, asks, before);
	});
});

test.describe("a summary the player fails to answer", () => {
	test.use({ fooJean: { failSummary: { status: 500, times: 1 } } });

	test("Home goes on waiting, says nothing, and lands on the ask that follows", async ({
		page,
		player,
	}) => {
		test.setTimeout(60_000);
		const failures = [
			en["home.nothingYet"],
			en["library.readFailed"],
			en["action.tryAgain"],
		];
		await page.addInitScript((phrases) => {
			const said: string[] = [];
			Reflect.set(window, "__said", said);
			new MutationObserver(() => {
				const text = document.body?.textContent ?? "";
				for (const phrase of phrases)
					if (text.includes(phrase) && !said.includes(phrase))
						said.push(phrase);
				const toasts = document.querySelector("[data-toasts]")?.textContent;
				if (toasts && !said.includes(toasts)) said.push(toasts);
			}).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		}, failures);

		const answeredAt: number[] = [];
		const askedAt: number[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === "/api/library/summary")
				askedAt.push(Date.now());
		});
		page.on("response", (response) => {
			if (new URL(response.url()).pathname === "/api/library/summary")
				answeredAt.push(Date.now());
		});

		await page.goto("/");
		await expect.poll(() => answeredAt.length).toBeGreaterThan(0);
		expect(
			(await skeletonsUnderTheHeader(page)).length,
			"Home stopped waiting when the summary failed",
		).toBeGreaterThan(0);

		await expect(albumInExplore(page, /^Jessico/)).toBeVisible({
			timeout: 30_000,
		});
		expect(
			await page.evaluate(() => Reflect.get(window, "__said") as string[]),
			"Home said something about a summary it was still waiting for",
		).toEqual([]);
		await expectSettlesAt(player, () => summaryAsks(player).length, 2);
		expect(
			askedAt[1] - answeredAt[0],
			"the summary was asked again before five seconds had passed",
		).toBeGreaterThanOrEqual(4_900);
	});
});

test.describe("a shelf's page", () => {
	test("lists its albums' tracks in the library's order, not the shelf's", async ({
		page,
		player,
	}) => {
		const albums = new Set([
			"Deja Entendu",
			"Jessico",
			"Deathconsciousness",
			"Jar Of Flies",
		]);
		const titles = player
			.ordinalOrder()
			.filter((entry) => albums.has(albumOf(entry)))
			.map((entry) => String(entry.track["%title%"]));

		await page.goto(`/#/${shelfRoute("top")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Most played" }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(titles.length),
		);
		await inSequence(titles.slice(0, 10), (title: string, at: number) =>
			expect(trackRow(page, at)).toContainText(title),
		);
	});
});

type SummaryAnswer = {
	shelves: { id: string; albums: { ordinals: number[] }[] }[];
};

const MOST_PLAYED = "top";

const openTheShelf = async (page: Page) => {
	const answered = recordLibraryTraffic(page);
	await page.goto(`/#/${shelfRoute(MOST_PLAYED)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Most played" }),
	).toBeVisible();
	const summary = await latestAnswer<SummaryAnswer>(
		answered,
		"GET /api/library/summary",
	);
	const shelf = summary.shelves.find((one) => one.id === MOST_PLAYED);
	expect(shelf, "the summary carries no Most played shelf").toBeDefined();
	const ordinals = (shelf?.albums ?? [])
		.flatMap((album) => album.ordinals)
		.sort((a, b) => a - b);
	return { answered, ordinals };
};

test.describe("a shelf page's rows", () => {
	test("are its albums' ordinals, asked in one body, and nothing else of the library is read", async ({
		page,
		player,
	}) => {
		const { answered, ordinals } = await openTheShelf(page);

		await expectTheSetAskedOnce(answered, player, ordinals);
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(ordinals.length),
		);
		await expect(trackRow(page, 0)).toContainText(
			String(player.ordinalOrder()[ordinals[0]].track["%title%"]),
		);
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("draw as skeletons and play by their position on the shelf's page", async ({
			page,
			player,
			isMobile,
		}) => {
			const { ordinals } = await openTheShelf(page);
			await untilRowsAreHeld(player, ordinals);

			await expectPendingRowsPlayByPosition(page, player, isMobile, ordinals);
		});
	});
});
