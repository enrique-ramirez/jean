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

// The captured player's own list, so this is the player's answer rather than a
// number picked here. foobar2000 offers several shuffle flavours and 'tracks'
// is the one people mean.
const SHUFFLE_TRACKS = 4;

// Rock en Español is the Jessico album: twelve tracks, playlist indices 0-11.
const ALBUM = { route: "/#/p5", title: "Rock en Español", count: 12 };

// Not parameterised over the layouts, unlike play!.spec and finder.spec: every
// control here lives in the view header or the status bar, and neither of those
// changes between compact and album. Doubling it would double the runtime for
// no new coverage.
const headerShuffle = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Shuffle" });
// One switch, in one of two places: the status bar on a desktop, the
// now-playing screen on a phone -- where shuffle went when the compact strip
// was cut back to Play and volume. Asks the page which it is rather than taking
// the project, so a spec reads the same on both and the answer comes from the
// app rather than from a constant that can drift away from it.
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
		// Two requests and no bookkeeping: play/{plref}/{index} makes that playlist
		// active and the mode draws its next track from it, so the mode does the
		// shuffling and this only has to open the door.
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

		// The same call, not a second implementation: the binding is registered by
		// the component that draws the button, so there is one answer to what
		// shuffling this view means.
		await page.keyboard.press("s");

		await expect.poll(() => playedIndex(player)).not.toBeNull();
		expect(playedIndex(player)).toBeLessThan(ALBUM.count);
		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS]);
		expect(requestsTo(player, "/player/play/")).toHaveLength(1);
	});

	test("it starts somewhere different each time", async ({ page, player }) => {
		// Guards the difference between "shuffle" and "play", which is otherwise
		// invisible: replacing the random pick with 0 would leave every other
		// assertion here passing.
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
		// Waited on the player rather than on aria-pressed. The button fires the
		// order change and the play concurrently, so until both have landed the
		// stream can still be describing the state before them -- the toggle
		// flickers back to unpressed for a beat and settles true. Harmless in the
		// app; a coin flip to press a second button against.
		await expect.poll(() => player.player.playbackMode).toBe(SHUFFLE_TRACKS);

		await headerShuffle(page).click();
		await expect.poll(() => requestsTo(player, "/player/play/").length).toBe(2);

		// The property, not the request count: it turns shuffle on rather than
		// flipping it, so nothing it sends may ever ask for another order. Asking
		// for shuffle twice would be harmless and is not what this is guarding.
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

test.describe("search results have shuffle again", () => {
	test("between Play and Save, now that results become a real playlist", async ({
		page,
	}) => {
		// It was removed while playing a result played it in place: the order draws
		// from the active playlist, so shuffling started inside the results and
		// then wandered the library!. Now the results are the active playlist.
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

		// The compact status bar is Play and volume and nothing else. Everything
		// else moved to the now-playing screen, where it is a full-sized target
		// rather than a 32px one wedged around Play -- and Play stays rightmost,
		// closest to a right thumb.
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
			// What is left, in order: the way into the screen, volume, then Play.
			expect(barLabels[0]).toBe("Show current track");
			expect(barLabels[barLabels.length - 1]).toMatch(/^(Play|Pause)$/);
		} else {
			// Left of the transport rather than among it: the mode the buttons to
			// its right operate in, not a fourth button. Asserted as position rather
			// than a full list, since the middle button is Play or Pause depending
			// on what the player is doing and that is not what this is about.
			expect(barLabels[1]).toBe("Shuffle");
			expect(barLabels[2]).toBe("Previous track");
			expect(barLabels).toContain("Next track");
		}

		// Either way there is exactly one of it, and it is reachable.
		const transport = await globalControls(page, isCompact);
		await expect(
			transport.getByRole("button", { name: "Shuffle" }),
		).toBeVisible();

		if (isCompact) {
			// Skipping came back with the screen -- it left the phone's status bar
			// and did not leave the phone.
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
		// Asked of the page rather than of the status bar: on a phone the switch
		// is on the now-playing screen, and reaching it hides the bar. Both
		// surfaces say the same words for the same reason.
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

		// Not "off" -- back to what was set before, so a repeat setting survives a
		// shuffle detour.
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

		// Global player state, so there is one of these rather than one per view --
		// which is what made the old placement read as "shuffle these tracks".
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

		// The order is found by name because the enum differs between players and
		// versions. With none matching there is nothing to turn on, so a button
		// labelled Shuffle would be promising something it cannot do.
		// Everything the playlist view owns happens first: on a phone `modeShuffle`
		// opens the now-playing screen, which replaces that view entirely -- and a
		// forced click on a header that is no longer mounted waits out the whole
		// test timeout rather than failing.
		await expect(headerShuffle(page)).toBeDisabled();
		await headerShuffle(page)
			.click({ force: true })
			.catch(() => {});
		await page.waitForTimeout(200);
		expect(requestsTo(player, "/player/play/")).toEqual([]);

		await expect(await modeShuffle(page)).toBeDisabled();
	});
});
