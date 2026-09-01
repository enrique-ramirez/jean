import type { PlayerOption } from "../../src/api/types.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
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
const modeShuffle = (page: Page) =>
	statusBar(page).getByRole("button", { name: "Shuffle" });

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
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");
		// One track, once -- not a queue built one request at a time.
		expect(requestsTo(player, "/player/play/")).toHaveLength(1);
		expect(player.playQueue).toEqual([]);
		expect(requestsTo(player, "/playqueue/")).toEqual([]);
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
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");
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

	test("it is in the transport, on both surfaces", async ({ page }) => {
		const labels = await statusBar(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			);

		// Left of the transport rather than among it: the mode the buttons to its
		// right operate in, not a fourth button. Asserted as position rather than a
		// full list, since the middle button is Play or Pause depending on what the
		// player is doing and that is not what this is about.
		expect(labels[0]).toBe("Shuffle");
		expect(labels[1]).toBe("Previous track");
		expect(labels).toContain("Next track");
	});

	test("it sets the playback order and starts nothing", async ({
		page,
		player,
	}) => {
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "false");

		await modeShuffle(page).click();

		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS]);
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");
		expect(requestsTo(player, "/player/play/")).toEqual([]);
		expect(player.playQueue).toEqual([]);
		await expect(statusBar(page)).toContainText("Nothing playing");
	});

	test("turning it off returns to the order you had", async ({
		page,
		player,
	}) => {
		await modeShuffle(page).click();
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");

		await modeShuffle(page).click();

		// Not "off" -- back to what was set before, so a repeat setting survives a
		// shuffle detour.
		await expect.poll(() => orderRequests(player)).toEqual([SHUFFLE_TRACKS, 0]);
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "false");
	});

	test("it is the same switch from every view", async ({ page }) => {
		await modeShuffle(page).click();
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");

		// Global player state, and the status bar is on every screen -- so there is
		// one of these rather than one per view, which is what made the old
		// placement read as "shuffle these tracks".
		await page.goto(ALBUM.route);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM.title }),
		).toBeVisible();
		await expect(modeShuffle(page)).toHaveAttribute("aria-pressed", "true");
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
		await expect(modeShuffle(page)).toBeDisabled();
		await expect(headerShuffle(page)).toBeDisabled();

		await headerShuffle(page)
			.click({ force: true })
			.catch(() => {});
		await page.waitForTimeout(200);
		expect(requestsTo(player, "/player/play/")).toEqual([]);
	});
});
