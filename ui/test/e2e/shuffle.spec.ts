import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	globalControls,
	nowPlayingScreen,
	OFFERS_NO_SHUFFLE,
	openLibrary,
	openNowPlaying,
	playedFrom,
	playRequests,
	requestsTo,
	rowByTitle,
	searchFor,
	statusBar,
	test,
	times,
	trackPlayed,
	viewHeader,
} from "./fixtures.ts";

// The fake player's own order indices, which is how it stores the mode.
const SHUFFLE_TRACKS = 4;
const REPEAT_PLAYLIST = 1;

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

// One switch in one of two places: the status bar on a desktop, the now-playing
// screen on a phone. Chosen by the viewport rather than by counting what has
// rendered -- the desktop transport arrives with the first poll, and a
// count taken before it lands reads zero and quietly sends the whole test to
// the other surface.
const modeShuffle = async (page: Page, isMobile: boolean) => {
	const transport = await globalControls(page, isMobile);
	const switched = transport.getByRole("button", { name: "Shuffle" });
	await expect(switched).toBeVisible();
	return switched;
};

const modesSent = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) => entry.method === "POST" && entry.path === "/api/playback/mode",
		)
		.map((entry) => entry.body?.mode);

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
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(playRequests(player)).toHaveLength(1);
		expect(player.playQueue).toEqual([]);
		expect(requestsTo(player, "/playqueue/")).toEqual([]);
	});

	test("s does the same thing as the button", async ({ page, player }) => {
		test.skip(
			test.info().project.name === "mobile",
			"no keyboard on the phone",
		);

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

	test("pressing it again does not walk back out of shuffle", async ({
		page,
		player,
		isMobile,
	}) => {
		await headerShuffle(page).click();
		await expect.poll(() => player.player.playbackMode).toBe(SHUFFLE_TRACKS);

		await headerShuffle(page).click();
		await expect.poll(() => playRequests(player).length).toBe(2);

		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(modesSent(player).every((mode) => mode === "shuffleTracks")).toBe(
			true,
		);
		expect(player.player.playbackMode).toBe(SHUFFLE_TRACKS);
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

test.describe("the status bar shuffle is the mode", () => {
	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
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
		isMobile,
	}) => {
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"false",
		);

		await (await modeShuffle(page, isMobile)).click();

		await expectSettlesAt(player, () => modesSent(player), ["shuffleTracks"]);
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expectSettlesAt(player, () => playRequests(player), []);
		expect(player.playQueue).toEqual([]);
		// Asked of the page rather than of the status bar: on a phone the switch is
		// on the now-playing screen, and reaching it hides the bar.
		await expect(page.getByText("Nothing playing").first()).toBeVisible();
	});

	test("it is the same switch from every view", async ({
		page,
		player,
		isMobile,
	}) => {
		await (await modeShuffle(page, isMobile)).click();
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// Navigating away closes the now-playing screen on a phone, so this also
		// checks the mode survives the trip rather than belonging to the screen.
		await openAlbum(page, player);
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});
});

// Started from Repeat (playlist) rather than from Default: `usePlaybackOrder`
// holds the order to come back to in a ref, and from 0 the test passes whether
// or not that ref survived -- turning shuffle off writes 0 either way.
test.describe("shuffle remembers the order it interrupted", () => {
	test.use({
		playerState: {
			playbackMode: REPEAT_PLAYLIST,
			options: [
				{
					id: "playbackOrder",
					name: "Playback order",
					type: "enum",
					value: REPEAT_PLAYLIST,
					enumNames: [
						"Default",
						"Repeat (playlist)",
						"Repeat (track)",
						"Random",
						"Shuffle (tracks)",
						"Shuffle (albums)",
						"Shuffle (folders)",
					],
				},
			],
		},
	});

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("turning it off returns to the order you had", async ({
		page,
		player,
		isMobile,
	}) => {
		await (await modeShuffle(page, isMobile)).click();
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await (await modeShuffle(page, isMobile)).click();

		await expectSettlesAt(player, () => modesSent(player), [
			"shuffleTracks",
			"repeatAll",
		]);
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("and still does after the now-playing screen has been closed and reopened", async ({
		page,
		player,
		isMobile,
	}) => {
		// On a compact viewport the status bar unmounts while the screen is up and
		// the switch a thumb reaches is the screen's own, so a hook that kept the
		// remembered order inside the control would forget it here and drop the
		// player back to Default.
		await (await modeShuffle(page, isMobile)).click();
		await expect(await modeShuffle(page, isMobile)).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await (await modeShuffle(page, isMobile)).click();

		await expectSettlesAt(player, () => modesSent(player), [
			"shuffleTracks",
			"repeatAll",
		]);
	});
});

// An install whose player declares fewer orders than the stock seven shifts
// every position after the gap: Random is this player's second order, where the
// stock list puts it fourth.
test.describe("a player that offers Random and no other shuffle", () => {
	test.use({
		playerState: {
			playbackMode: 0,
			options: [
				{
					id: "playbackOrder",
					name: "Playback order",
					type: "enum",
					value: 0,
					enumNames: ["Default", "Random"],
				},
			],
		},
	});

	test("the switch shuffles with Random, and the player lands on its own Random", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await (await modeShuffle(page, isMobile)).click();

		await expectSettlesAt(player, () => modesSent(player), ["random"]);
		expect(player.player.playbackMode).toBe(1);
	});
});

test.describe("a player that offers no shuffle", () => {
	test.use({ playerState: OFFERS_NO_SHUFFLE });

	test("both shuffles are disabled rather than lying", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAlbum(page, player);

		// The order is found by name, because the enum differs between players and
		// versions; with none matching there is nothing to turn on.
		// The header comes first: on a phone `modeShuffle` opens the now-playing
		// screen, and a forced click on a header that is no longer mounted waits out
		// the whole test timeout rather than failing.
		await expect(headerShuffle(page)).toBeDisabled();
		await headerShuffle(page)
			.click({ force: true })
			.catch(() => {});
		await expectSettlesAt(player, () => playRequests(player), []);

		await expect(await modeShuffle(page, isMobile)).toBeDisabled();
	});
});
