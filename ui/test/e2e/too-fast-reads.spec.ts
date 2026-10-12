import type { FakePlayer, Locator } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openLibrary,
	requestsTo,
	test,
	toastRegion,
	trackRow,
} from "./fixtures.ts";
import { openPanels, panelTab, playRow } from "./nowPlaying.ts";

// `foo_jean` rate-limits both one-track reads and answers `429` with a
// `Retry-After`. A read refused that way was never put to the player, so asking
// again once the wait is over is safe, and giving up leaves the screen empty
// for as long as the track plays.

const FIZZ_LYRIC = "Wait a minute, let me finish";

const PUBLISHED = {
	retagged: {
		"Los Calientes": { "%publisher%": "Discos Uno" },
		Fizz: {
			"%publisher%": "Discos Dos",
			"$meta(unsynced lyrics)": FIZZ_LYRIC,
		},
	},
};

const playingReads = (player: FakePlayer) =>
	requestsTo(player, "/api/track/playing").filter(
		(entry) => entry.method === "GET",
	);

const readsFromNow = (player: FakePlayer) => {
	const before = playingReads(player).length;
	return () => playingReads(player).length - before;
};

const expectOnTab = (panel: Locator, tab: string, text: string) =>
	expect(async () => {
		await panelTab(panel, tab).click();
		await expect(panel).toContainText(text, { timeout: 1_000 });
	}).toPass();

test.describe("a playing-track read the player refuses as too fast", () => {
	test.use(PUBLISHED);

	// Two refusals in a row: one alone is covered by the retry any failed read
	// gets, which is not what this case is about.
	test("is asked again after the wait, and the details and lyrics arrive", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await expectOnTab(panel, "Details", "Discos Uno");
		const reads = readsFromNow(player);
		Object.assign(player.fooJean, {
			failPlayingTrack: 429,
			playingTrackKnobsFor: 2,
		});

		player.next();

		await expectOnTab(panel, "Lyrics", FIZZ_LYRIC);
		await expectOnTab(panel, "Details", "Discos Dos");
		await expectSettlesAt(player, reads, 3);
	});

	test("every time, is asked a bounded number of times", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await expectOnTab(panel, "Details", "Discos Uno");
		const reads = readsFromNow(player);
		player.fooJean.failPlayingTrack = 429;

		player.next();

		await expectSettlesAt(player, reads, 4);
	});
});

const RATED = {
	settings: { "jean.columns": ["duration", "rating"] },
	retagged: { Deléctrico: { "%rating%": "3" } },
};

const DELECTRICO_ROW = 2;

test.describe("a rating's read back the player refuses as too fast", () => {
	test.use({ ...RATED, fooJean: { failWrites: 504 } });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	// A write that timed out is settled by reading the rating back. The player
	// kept three stars here, so the person who pressed four is told, and only
	// once the refused read has been asked again.
	test("is asked again after the wait, and says the rating did not land", async ({
		page,
	}) => {
		let refused = 0;
		await page.route(
			(url) => url.pathname === "/api/track/library",
			(route) => {
				if (refused > 0) return route.continue();
				refused += 1;
				return route.fulfill({
					status: 429,
					headers: { "Retry-After": "1" },
					contentType: "application/json",
					body: JSON.stringify({ error: "too many track reads" }),
				});
			},
		);

		await openLibrary(page);
		await expect(
			trackRow(page, DELECTRICO_ROW).getByRole("group", {
				name: "3 of 5 stars",
			}),
		).toBeVisible();
		await trackRow(page, DELECTRICO_ROW)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();

		await expect(toastRegion(page)).toContainText(
			"We couldn’t rate Deléctrico with 4 stars",
		);
		expect(refused).toBe(1);
	});
});
