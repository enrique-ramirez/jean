import type { PlayerOption } from "../../src/shared/api/types.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	globalControls,
	nowPlayingScreen,
	openNowPlaying,
	playedFrom,
	requestsTo,
	statusBar,
	test,
	times,
	viewHeader,
} from "./fixtures.ts";

// foobar2000's playback order for shuffle-by-tracks, from the captured player.
const SHUFFLE_TRACKS = 4;

// Rock en Español is the Jessico album: twelve tracks, playlist indices 0-11.
const ALBUM = { route: "/#/p5", title: "Rock en Español", count: 12 };

const headerShuffle = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Shuffle" });
// One switch in one of two places: the status bar on a desktop, the now-playing
// screen on a phone. Asked of the page rather than of the project name.
const modeShuffle = async (page: Page) => {
	const onScreen = nowPlayingScreen(page).getByRole("button", {
		name: "Shuffle",
	});
	if (await onScreen.count()) return onScreen;
	const inStatusBar = statusBar(page).getByRole("button", { name: "Shuffle" });
	if (await inStatusBar.count()) return inStatusBar;
	await openNowPlaying(page);
	return onScreen;
};

const orderRequests = (player: FakePlayer) =>
	requestsTo(player, "/api/player").flatMap((entry) =>
		(entry.body?.options ?? [])
			.filter((option: PlayerOption) => option.id === "playbackOrder")
			.map((option: PlayerOption) => option.value),
	);

const playedIndex = (player: FakePlayer) => playedFrom(player)?.index ?? null;

test.describe("the header shuffle starts a shuffled run", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(ALBUM.route);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM.title }),
		).toBeVisible();
	});

	test("it plays a track from this playlist and turns the mode on", async ({
		page,
		player,
	}) => {
		// play/{plref}/{index} makes that playlist active and the order draws the
		// next track from it, so the player does the shuffling.
		await headerShuffle(page).click();

		await expect.poll(() => playedIndex(player)).not.toBeNull();
		expect(playedIndex(player)).toBeGreaterThanOrEqual(0);
		expect(playedIndex(player)).toBeLessThan(ALBUM.count);

		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS]);
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		// One track, once -- not a queue built one request at a time.
		expect(requestsTo(player, "/player/play/")).toHaveLength(1);
		expect(player.playQueue).toEqual([]);
		expect(requestsTo(player, "/playqueue/")).toEqual([]);
	});

	test("s does the same thing as the button", async ({ page, player }) => {
		test.skip(
			test.info().project.name === "mobile",
			"no keyboard on the phone",
		);

		await page.keyboard.press("s");

		await expect.poll(() => playedIndex(player)).not.toBeNull();
		expect(playedIndex(player)).toBeLessThan(ALBUM.count);
		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS]);
		expect(requestsTo(player, "/player/play/")).toHaveLength(1);
	});

	test("it starts somewhere different each time", async ({ page, player }) => {
		// Replacing the random pick with 0 would leave every other assertion in this
		// file passing.
		await times(6, async (press) => {
			await headerShuffle(page).click();
			await expect
				.poll(() => requestsTo(player, "/player/play/").length)
				.toBe(press + 1);
		});

		const picked = new Set(
			requestsTo(player, "/player/play/").map((entry) =>
				Number(entry.path.split("/").pop()),
			),
		);
		// Six draws from twelve landing on one track is a 1-in-250,000 coincidence.
		expect(picked.size).toBeGreaterThan(1);
	});

	test("pressing it again does not walk back out of shuffle", async ({
		page,
		player,
	}) => {
		await headerShuffle(page).click();
		// Waited on the player rather than on aria-pressed: the order change and the
		// play are sent concurrently, so the toggle can flicker back to unpressed
		// before it settles.
		await expect.poll(() => player.player.playbackMode).toBe(SHUFFLE_TRACKS);

		await headerShuffle(page).click();
		await expect.poll(() => requestsTo(player, "/player/play/").length).toBe(2);

		// The property rather than the request count: the button sets shuffle rather
		// than flipping it, and asking for it twice is harmless.
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			orderRequests(player).every((value) => value === SHUFFLE_TRACKS),
		).toBe(true);
		expect(player.player.playbackMode).toBe(SHUFFLE_TRACKS);
	});
});

test.describe("shuffle in the search results header", () => {
	test("sits between Play and Save as playlist", async ({ page }) => {
		await page.goto("/#/search");
		await page.getByLabel("Search your library").fill("babasonicos");
		await expect(
			page.getByRole("heading", { level: 1, name: "babasonicos" }),
		).toBeVisible();

		const labels = await viewHeader(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.textContent.trim()),
			);

		expect(labels).toEqual(["Play", "Shuffle", "Save as playlist"]);
	});
});

test.describe("the status bar shuffle is the mode", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("it is in the transport, and which transport depends on the surface", async ({
		page,
	}, testInfo) => {
		const isCompact = testInfo.project.name === "mobile";

		const barLabels = await statusBar(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			);

		if (isCompact) {
			expect(barLabels).not.toContain("Shuffle");
			expect(barLabels).not.toContain("Previous track");
			expect(barLabels).not.toContain("Next track");
			expect(barLabels.some((label) => label?.startsWith("Queue"))).toBe(false);
			expect(barLabels[0]).toBe("Show current track");
			expect(barLabels[barLabels.length - 1]).toMatch(/^(Play|Pause)$/);
		} else {
			// Asserted by position rather than as a full list: the middle button is
			// Play or Pause depending on what the player is doing.
			expect(barLabels[1]).toBe("Shuffle");
			expect(barLabels[2]).toBe("Previous track");
			expect(barLabels).toContain("Next track");
		}

		const transport = await globalControls(page, isCompact);
		await expect(
			transport.getByRole("button", { name: "Shuffle" }),
		).toBeVisible();

		if (isCompact) {
			await expect(
				transport.getByRole("button", { name: "Previous track" }),
			).toBeVisible();
			await expect(
				transport.getByRole("button", { name: "Next track" }),
			).toBeVisible();
		}
	});

	test("it sets the playback order and starts nothing", async ({
		page,
		player,
	}) => {
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"false",
		);

		(await modeShuffle(page)).click();

		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS]);
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(requestsTo(player, "/player/play/")).toEqual([]);
		expect(player.playQueue).toEqual([]);
		// Asked of the page rather than of the status bar: on a phone the switch is
		// on the now-playing screen, and reaching it hides the bar.
		await expect(page.getByText("Nothing playing").first()).toBeVisible();
	});

	test("turning it off returns to the order you had", async ({
		page,
		player,
	}) => {
		(await modeShuffle(page)).click();
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		(await modeShuffle(page)).click();

		// Back to the order that was set before rather than to "off", so a repeat
		// setting survives a shuffle detour.
		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS, 0]);
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("it is the same switch from every view", async ({ page }) => {
		(await modeShuffle(page)).click();
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// Navigating away closes the now-playing screen on a phone, so this also
		// checks the mode survives the trip rather than belonging to the screen.
		await page.goto(ALBUM.route);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM.title }),
		).toBeVisible();
		await expect(await modeShuffle(page)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});
});

test.describe("a player that offers no shuffle", () => {
	test.use({
		playerState: {
			playbackModes: ["Default", "Repeat (playlist)"],
			options: [
				{
					id: "playbackOrder",
					name: "Playback order",
					type: "enum",
					value: 0,
					enumNames: ["Default", "Repeat (playlist)"],
				},
			],
		},
	});

	test("both shuffles are disabled rather than lying", async ({
		page,
		player,
	}) => {
		await page.goto(ALBUM.route);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM.title }),
		).toBeVisible();

		// The order is found by name, because the enum differs between players and
		// versions; with none matching there is nothing to turn on.
		// The header comes first: on a phone `modeShuffle` opens the now-playing
		// screen, and a forced click on a header that is no longer mounted waits out
		// the whole test timeout rather than failing.
		await expect(headerShuffle(page)).toBeDisabled();
		await headerShuffle(page)
			.click({ force: true })
			.catch(() => {});
		await page.waitForTimeout(200);
		expect(requestsTo(player, "/player/play/")).toEqual([]);

		await expect(await modeShuffle(page)).toBeDisabled();
	});
});
