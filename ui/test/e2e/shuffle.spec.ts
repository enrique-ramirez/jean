import type { FakePlayer, Page } from "./fixtures.ts";
import {
	closeNowPlaying,
	expect,
	expectSettlesAt,
	globalControls,
	modesSent,
	OFFERS_NO_SHUFFLE,
	orderButton,
	playedFrom,
	playerDeclaring,
	playRequests,
	requestsTo,
	rowByTitle,
	STOCK_ORDERS,
	searchFor,
	test,
	times,
	trackPlayed,
	untilTheInstallIsKnown,
	viewHeader,
} from "./fixtures.ts";

// Rock en Español is the Jessico album: twelve tracks, playlist indices 0-11.
const ALBUM = { title: "Rock en Español" };

const albumGuid = (player: FakePlayer) =>
	player.playlists.find((entry) => entry.title === ALBUM.title)!.guid;

const openAlbum = async (page: Page, player: FakePlayer) => {
	await page.goto(`/#/${albumGuid(player)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: ALBUM.title }),
	).toBeVisible();
};

const playedFromPath = (path: string) =>
	Number(/\/items\/(\d+)\/play$/.exec(path)?.[1]);

const headerShuffle = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Shuffle" });

const skipWithoutAKeyboard = () =>
	test.skip(test.info().project.name === "mobile", "no keyboard on the phone");

// A compact viewport has the order button on the now-playing screen only, and that screen covers
// the view header. So it is opened for as long as the button is needed and closed again.
const withTheOrderButton = async (
	page: Page,
	isCompact: boolean,
	use: () => Promise<void>,
) => {
	await globalControls(page, isCompact);
	await use();
	if (isCompact) await closeNowPlaying(page);
};

const expectOrderShown = (page: Page, isCompact: boolean, order: string) =>
	withTheOrderButton(page, isCompact, () =>
		expect(orderButton(page, isCompact)).toHaveAccessibleName(
			`Playback order: ${order}`,
		),
	);

const chooseOrder = (page: Page, isCompact: boolean, order: string) =>
	withTheOrderButton(page, isCompact, async () => {
		await orderButton(page, isCompact).click();
		await page
			.getByRole("menu")
			.getByRole("menuitemradio", { name: order, exact: true })
			.click();
		await expect(page.getByRole("menu")).toHaveCount(0);
		await expect(orderButton(page, isCompact)).toHaveAccessibleName(
			`Playback order: ${order}`,
		);
	});

// Settled, so an order sent late or a second track started is seen.
const expectOneTrackStarted = async (player: FakePlayer, modes: string[]) => {
	await expect.poll(() => playRequests(player).length).toBe(1);
	await expectSettlesAt(player, () => modesSent(player), modes);
	expect(playRequests(player)).toHaveLength(1);
};

test.describe("the header shuffle starts a shuffled run", () => {
	test.beforeEach(async ({ page, player }) => {
		await openAlbum(page, player);
	});

	test("it plays a track from this playlist and turns the mode on", async ({
		page,
		player,
		isMobile,
	}) => {
		// The play route makes that playlist active and the order draws the next
		// track from it, so the player does the shuffling.
		await headerShuffle(page).click();

		// Resolved back to a song rather than compared to a range: every index this
		// twelve-track album could send falls inside [0, 12), so a bounds check
		// passes for a shuffle that started somewhere else entirely.
		await expect.poll(() => trackPlayed(player)).not.toBeNull();
		expect(playedFrom(player)?.id).toBe(albumGuid(player));
		await expect(rowByTitle(page, trackPlayed(player) as string)).toBeVisible();

		await expectSettlesAt(player, () => modesSent(player), ["shuffleTracks"]);
		expect(playRequests(player)).toHaveLength(1);
		expect(player.playQueue).toEqual([]);
		expect(requestsTo(player, "/playqueue/")).toEqual([]);
		await expectOrderShown(page, isMobile, "Shuffle tracks");
	});

	test("s does the same thing as the button", async ({ page, player }) => {
		skipWithoutAKeyboard();

		await expect(headerShuffle(page)).toBeEnabled();
		await page.keyboard.press("s");

		await expect.poll(() => trackPlayed(player)).not.toBeNull();
		expect(playedFrom(player)?.id).toBe(albumGuid(player));
		await expect(rowByTitle(page, trackPlayed(player) as string)).toBeVisible();
		await expectSettlesAt(player, () => modesSent(player), ["shuffleTracks"]);
		expect(playRequests(player)).toHaveLength(1);
	});

	test("it starts somewhere different each time", async ({ page, player }) => {
		// Replacing the random pick with 0 would leave every other assertion in this
		// file passing.
		await times(6, async (press) => {
			await headerShuffle(page).click();
			await expect.poll(() => playRequests(player).length).toBe(press + 1);
		});

		const picked = new Set(
			playRequests(player).map((entry) => playedFromPath(entry.path)),
		);
		// Six draws from twelve landing on one track is a 1-in-250,000 coincidence.
		expect(picked.size).toBeGreaterThan(1);
	});

	// Jean's own reading of the order is taken before the second press: the player holding
	// Shuffle tracks says nothing about whether the page pressed has learned it.
	test("pressing it again does not walk back out of shuffle, and sends no order", async ({
		page,
		player,
		isMobile,
	}) => {
		await headerShuffle(page).click();
		await expectOneTrackStarted(player, ["shuffleTracks"]);
		await expectOrderShown(page, isMobile, "Shuffle tracks");

		await headerShuffle(page).click();
		await expect.poll(() => playRequests(player).length).toBe(2);

		await expectSettlesAt(player, () => modesSent(player), ["shuffleTracks"]);
		expect(player.player.playbackMode).toBe(
			STOCK_ORDERS.indexOf("Shuffle (tracks)"),
		);
		await expectOrderShown(page, isMobile, "Shuffle tracks");
	});

	test("it turns on Shuffle tracks after Shuffle albums and then In order were chosen from the list", async ({
		page,
		player,
		isMobile,
	}) => {
		await chooseOrder(page, isMobile, "Shuffle albums");
		await chooseOrder(page, isMobile, "In order");

		await headerShuffle(page).click();

		await expectOneTrackStarted(player, [
			"shuffleAlbums",
			"inOrder",
			"shuffleTracks",
		]);
	});
});

// Random as well as a shuffle by albums: Random is itself an order plain Shuffle turns on where
// Shuffle tracks is missing, and here it is not the one.
for (const [declared, shown] of [
	["Shuffle (albums)", "Shuffle albums"],
	["Random", "Random"],
] as const) {
	test.describe(`with Shuffle tracks offered and the player in ${shown}`, () => {
		test.use({ playerState: playerDeclaring(STOCK_ORDERS, declared) });

		test("the header's Shuffle sends Shuffle tracks once and starts one track", async ({
			page,
			player,
			isMobile,
		}) => {
			await openAlbum(page, player);
			await expectOrderShown(page, isMobile, shown);

			await headerShuffle(page).click();

			await expectOneTrackStarted(player, ["shuffleTracks"]);
			expect(player.player.playbackMode).toBe(
				STOCK_ORDERS.indexOf("Shuffle (tracks)"),
			);
		});

		test("s sends Shuffle tracks once and starts one track", async ({
			page,
			player,
		}) => {
			skipWithoutAKeyboard();
			await openAlbum(page, player);
			await expectOrderShown(page, false, shown);

			await page.keyboard.press("s");

			await expectOneTrackStarted(player, ["shuffleTracks"]);
		});
	});
}

test.describe("with the player already in Shuffle tracks", () => {
	test.use({ playerState: playerDeclaring(STOCK_ORDERS, "Shuffle (tracks)") });

	test("s starts one track and sends no order", async ({ page, player }) => {
		skipWithoutAKeyboard();
		await openAlbum(page, player);
		await expectOrderShown(page, false, "Shuffle tracks");

		await page.keyboard.press("s");

		await expectOneTrackStarted(player, []);
	});
});

test.describe("shuffle in the search results header", () => {
	test("sits between Play and Save as playlist", async ({ page }) => {
		await page.goto("/#/search");
		await searchFor(page, "babasonicos");

		const labels = await viewHeader(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.textContent.trim()),
			);

		expect(labels).toEqual(["Play", "Shuffle", "Save as playlist"]);
	});
});

// An install whose player declares fewer orders than the stock seven shifts every position after
// the gap, so Random is found by its name. In the second it is declared after two shuffles by
// group, which are never what plain Shuffle turns on.
for (const [offer, declared] of [
	["Random and no other shuffling order", ["Default", "Random"]],
	[
		"Shuffle folders, Shuffle albums and Random, and no Shuffle tracks",
		["Default", "Shuffle (folders)", "Shuffle (albums)", "Random"],
	],
] as const) {
	test.describe(`a player that offers ${offer}`, () => {
		test.use({ playerState: playerDeclaring(declared) });

		test.beforeEach(async ({ page, player }) => {
			await openAlbum(page, player);
		});

		test("the header's Shuffle shuffles with Random, and the player lands on its own Random", async ({
			page,
			player,
			isMobile,
		}) => {
			// A click on a disabled button waits out the whole test instead of failing.
			await expect(headerShuffle(page)).toBeEnabled();
			await headerShuffle(page).click();

			await expectOneTrackStarted(player, ["random"]);
			expect(player.player.playbackMode).toBe(declared.indexOf("Random"));
			await expectOrderShown(page, isMobile, "Random");
		});

		test("s shuffles with Random, and the player lands on its own Random", async ({
			page,
			player,
		}) => {
			skipWithoutAKeyboard();

			await expect(headerShuffle(page)).toBeEnabled();
			await page.keyboard.press("s");

			await expectOneTrackStarted(player, ["random"]);
			expect(player.player.playbackMode).toBe(declared.indexOf("Random"));
		});
	});
}

// The order is found by name, because the enum differs between players and versions. With
// neither Shuffle tracks nor Random among the names there is nothing plain Shuffle turns on,
// whatever else shuffles.
for (const [offer, playerState] of [
	["no shuffling order", OFFERS_NO_SHUFFLE],
	[
		"Shuffle albums and Shuffle folders, and neither Shuffle tracks nor Random",
		playerDeclaring(["Default", "Shuffle (albums)", "Shuffle (folders)"]),
	],
] as const) {
	test.describe(`a player that offers ${offer}`, () => {
		test.use({ playerState });

		test.beforeEach(async ({ page, player }) => {
			await openAlbum(page, player);
			await untilTheInstallIsKnown(player);
		});

		test("the header's Shuffle is disabled rather than lying", async ({
			page,
			player,
		}) => {
			await expect(headerShuffle(page)).toBeDisabled();
			await headerShuffle(page)
				.click({ force: true })
				.catch(() => {});

			await expectSettlesAt(player, () => playRequests(player), []);
			expect(modesSent(player)).toEqual([]);
		});

		test("s sends no order and starts nothing", async ({ page, player }) => {
			skipWithoutAKeyboard();

			await page.keyboard.press("s");

			await expectSettlesAt(player, () => playRequests(player), []);
			expect(modesSent(player)).toEqual([]);
		});
	});
}
