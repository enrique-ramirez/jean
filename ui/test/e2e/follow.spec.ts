import { albumRoute } from "../../src/domain/track/routes.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	playRequests,
	statusBar,
	test,
	times,
	trackRow,
} from "./fixtures.ts";
import { isRowOnScreen, scrollTo, scrollTop } from "./scrolling.ts";

// Far enough down the 54-track fixture to be well past the fold on both the
// desktop and the phone viewport.
const FAR = { index: 40, title: "Goodnite, Noises Everywhere" };

// Where the view came to rest. An animated jump brings the row on screen well
// before it stops moving, so "is the row visible yet" is not the same question.
//
// Watched frame by frame from inside the page rather than sampled after a fixed
// wait and asserted to have stopped: an animation still running at the guess
// failed the test instead of being waited for, and the guess was long enough to
// dominate this file's running time. The floor is there because the animation
// takes a render to start, and ten still frames before it does would report the
// offset it was leaving.
const SETTLE_FLOOR_MS = 500;

const settle = (page: Page) =>
	page.evaluate(
		(floor: number) =>
			new Promise<number>((resolve) => {
				const scroller = document.querySelector("main") as HTMLElement;
				const until = performance.now() + floor;
				let last = Number.NaN;
				let still = 0;
				const tick = () => {
					const now = scroller.scrollTop;
					still = now === last ? still + 1 : 0;
					last = now;
					if (still >= 10 && performance.now() >= until) resolve(now);
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		SETTLE_FLOOR_MS,
	);

const offCentre = (page: Page) =>
	page.evaluate(() => {
		const scroller = document.querySelector("main");
		const row = scroller!.querySelector('[data-active="true"]');
		if (!row) return null;
		const seen = row.getBoundingClientRect();
		const view = scroller!.getBoundingClientRect();
		return Math.abs(
			(seen.top + seen.bottom) / 2 - (view.top + view.bottom) / 2,
		);
	});

// Centred, unless the list has run out of room. Near either end the scroll
// clamps and the track cannot reach the middle; what still has to hold there is
// that it is on screen at all.
//
// Retrying, and it reports what it saw: read once it races the tail of the
// animation, and every caller here is asserting where the view finished rather
// than where it passed through.
const expectCentredOrClamped = async (page: Page, index: number) => {
	await expect
		.poll(async () => {
			const distance = await offCentre(page);
			if (distance === null) return `track ${index} was not mounted`;

			const { top, max } = await page.evaluate(() => {
				const scroller = document.querySelector("main");
				return {
					top: scroller!.scrollTop,
					max: scroller!.scrollHeight - scroller!.clientHeight,
				};
			});

			if (top <= 1 || top >= max - 1)
				return (await isRowOnScreen(page, index))
					? "at rest"
					: `track ${index} clamped off screen`;

			return distance < 2
				? "at rest"
				: `track ${index} sat ${Math.round(distance)}px off centre`;
		})
		.toBe("at rest");
};

const rowInTheMiddle = (page: Page) =>
	page.evaluate(() => {
		const scroller = document.querySelector("main");
		const view = scroller!.getBoundingClientRect();
		const middle = (view.top + view.bottom) / 2;
		for (const row of scroller!.querySelectorAll("[data-row]")) {
			const seen = row.getBoundingClientRect();
			if (
				seen.top >= view.top &&
				seen.bottom <= view.bottom &&
				seen.bottom >= middle
			)
				return Number(row.getAttribute("data-row"));
		}
		return null;
	});

// The shared openLibrary waits for row 0 to be attached, which overscan makes
// true well above the fold. Everything below measures where the view came to
// rest, so it has to start from one settled at the top.
const openAtTheTop = async (page: Page) => {
	await openLibrary(page);
	await expect.poll(() => isRowOnScreen(page, 0)).toBe(true);
};

test.describe("following playback", () => {
	test("the view scrolls to a track the player changed to", async ({
		page,
		player,
	}) => {
		await openAtTheTop(page);
		expect(await isRowOnScreen(page, FAR.index)).toBe(false);

		// Driven on the player rather than through the UI: nothing is clicked here,
		// so the only thing that can move the view is the next poll.
		player.playItem("p7", FAR.index);

		await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
		await expect(trackRow(page, FAR.index)).toHaveAttribute(
			"data-active",
			"true",
		);
		expect(playRequests(player)).toEqual([]);
	});

	test("a playlist growing under you does not drag the view back", async ({
		page,
		player,
	}) => {
		await openAtTheTop(page);
		player.playItem("p7", FAR.index);
		await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
		// The follow animation is still running at this point, and scrolling away
		// mid-flight is undone by the next frame of it.
		await settle(page);

		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);

		// Rows arriving is what re-runs the follow, and at library size they arrive
		// in chunks. Appending one track is that same event with one chunk instead
		// of sixteen, and the only way to provoke it against a 54-track fixture.
		player.copyItems("p5", "p7", [0]);
		// Item changes are not pushed by a real player, so the growth has to be
		// announced the way a landing chunk announces itself. See state.ts.
		player.notifyPlaylists();
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "55");

		expect(await scrollTop(page)).toBe(0);
		expect(await isRowOnScreen(page, FAR.index)).toBe(false);
	});
});

test.describe("with following turned off", () => {
	test.use({ settings: { "jean.followPlayback": false } });

	test("the view stays where it was", async ({ page, player }) => {
		await openAtTheTop(page);

		player.playItem("p7", FAR.index);
		// The status bar proves the push landed, so the view staying put is the
		// setting working rather than the update never arriving.
		await expect(statusBar(page)).toContainText(FAR.title);

		expect(await settle(page)).toBe(0);
		expect(await isRowOnScreen(page, FAR.index)).toBe(false);
	});
});

test.describe("the jump survives a coasting list", () => {
	test.use({ settings: { "jean.followPlayback": false }, motion: "allow" });
	test.skip(({ isMobile }) => isMobile, "wheel is a pointer input");

	// Both the key and the wheel are dispatched from inside the page, one frame
	// apart. Driving them over the wire is two round trips against a 240ms
	// animation, which under parallel workers land after it has finished.
	//
	// A dispatched wheel event scrolls nothing; all that is under test is whether
	// the listener treats it as a decision.
	const jumpAndWheel = async (page: Page, deltaY: number) =>
		page.evaluate((delta) => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "n", bubbles: true }),
			);
			requestAnimationFrame(() => {
				document
					.querySelector("main")!
					.dispatchEvent(
						new WheelEvent("wheel", { deltaY: delta, bubbles: true }),
					);
			});
		}, deltaY);

	test("a stray wheel tick does not strand it", async ({ page, player }) => {
		await openAtTheTop(page);
		player.playItem("p7", FAR.index);
		await expect(statusBar(page)).toContainText(FAR.title);
		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);

		// Momentum from a flick that ended before the jump was asked for.
		await jumpAndWheel(page, 1);

		await settle(page);
		expect(await isRowOnScreen(page, FAR.index)).toBe(true);
	});

	test("a real scroll still takes it back", async ({ page, player }) => {
		await openAtTheTop(page);
		player.playItem("p7", FAR.index);
		await expect(statusBar(page)).toContainText(FAR.title);

		// What an uninterrupted jump settles on, so the interrupted one has
		// something measured to be compared against.
		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);
		await jumpAndWheel(page, 0);
		const uninterrupted = await settle(page);
		expect(uninterrupted).toBeGreaterThan(0);

		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);
		// Well past the threshold, so the scroll wins over the animation.
		await jumpAndWheel(page, 400);
		const interrupted = await settle(page);

		expect(interrupted).toBeLessThan(uninterrupted - 50);
	});
});

test.describe("at library scale", () => {
	test.use({ librarySize: 30441 });

	test("the jump lands on a track 23,000 rows down", async ({
		page,
		player,
	}) => {
		// Scroll offsets here are arithmetic over a list 1.4 million pixels tall.
		await openLibrary(page);
		await expect
			.poll(() => page.getByRole("grid").getAttribute("aria-rowcount"), {
				timeout: 30000,
			})
			.toBe("30441");

		player.playItem("p7", 23618);
		await expect
			.poll(() => isRowOnScreen(page, 23618), { timeout: 15000 })
			.toBe(true);
	});
});

// Album mode virtualises groups rather than rows, so the index handed to the
// virtualiser is not the index being centred; on a phone the cover stacks above
// its tracks instead of sitting beside them, changing every group's height; and
// the row heights differ between the two layouts.
["compact", "album"].forEach((layout) => {
	test.describe(`following playback in ${layout} layout`, () => {
		test.use({ settings: { "jean.layout": layout } });

		test("centres the playing track, whichever direction it came from", async ({
			page,
			player,
		}) => {
			await openAtTheTop(page);

			player.playItem("p7", FAR.index);
			await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
			await settle(page);
			await expectCentredOrClamped(page, FAR.index);

			// Back up the list: centre has no edge to land on, so a row arrived at
			// from below must not end up tucked under the sticky toolbar.
			player.playItem("p7", 15);
			await expect.poll(() => isRowOnScreen(page, 15)).toBe(true);
			await settle(page);
			await expectCentredOrClamped(page, 15);
		});

		test("it leaves the view alone while the track advances on screen", async ({
			page,
			player,
		}) => {
			await openAtTheTop(page);

			// Centred with room on both sides first, so "it did not move" is a
			// different sentence from "it was at the top and could not".
			player.playItem("p7", FAR.index);
			await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
			const resting = await settle(page);
			expect(resting).toBeGreaterThan(0);

			await times(3, async (step) => {
				const next = FAR.index + 1 + step;
				player.next();
				await expect(trackRow(page, next)).toHaveAttribute(
					"data-active",
					"true",
				);
				const at = await settle(page);
				expect(
					await isRowOnScreen(page, next),
					`track ${next} left the screen`,
				).toBe(true);
				// A tolerance rather than equality: the offset is fractional at the
				// phone's device pixel ratio.
				expect(
					Math.abs(at - resting),
					`the view moved for track ${next}`,
				).toBeLessThan(2);
			});
		});

		test("it centres again once the track advances off screen", async ({
			page,
			player,
		}) => {
			await openAtTheTop(page);
			player.playItem("p7", FAR.index);
			await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
			await settle(page);

			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);
			expect(await isRowOnScreen(page, FAR.index + 1)).toBe(false);

			player.next();
			await expect.poll(() => isRowOnScreen(page, FAR.index + 1)).toBe(true);
			await settle(page);
			await expectCentredOrClamped(page, FAR.index + 1);
		});

		test("playing a row you can already see leaves the view alone", async ({
			page,
			isMobile,
		}) => {
			test.skip(isMobile, "double-click is a pointer gesture");

			await openAtTheTop(page);
			await scrollTo(page, 300);
			// Read back rather than asserted: in album layout on a phone the covers
			// stack and the content can be shorter than 300 plus the viewport, in
			// which case the browser clamps and 300 is never reachable.
			const parked = await settle(page);
			expect(parked, "the list had nowhere to scroll to").toBeGreaterThan(0);

			// Which index is halfway down the view depends on the layout's row
			// heights and on the viewport, so it is read off the page.
			const index = await rowInTheMiddle(page);
			expect(index, "no fully visible row past the middle").not.toBeNull();

			await trackRow(page, index!).dblclick();
			await expect(trackRow(page, index!)).toHaveAttribute(
				"data-active",
				"true",
			);

			expect(Math.abs((await settle(page)) - parked)).toBeLessThan(2);
		});

		test("the last track is reachable even though it cannot be centred", async ({
			page,
			player,
		}) => {
			await openAtTheTop(page);

			// The end of the list is where centring is impossible and the scroll
			// clamps, absorbing any offset error with it.
			player.playItem("p7", 53);
			await expect.poll(() => isRowOnScreen(page, 53)).toBe(true);
			await settle(page);
			expect(await isRowOnScreen(page, 53)).toBe(true);
		});
	});

	test.describe(`jumping to the playing track in ${layout} layout`, () => {
		// Following is off so the only thing moving the view is the key under test.
		// With it on, the follow animation is still in flight when the test scrolls
		// away and the two fight over the scroll position.
		test.use({
			settings: { "jean.layout": layout, "jean.followPlayback": false },
		});

		// The virtualiser has to be told about the view header and toolbar above
		// the list, or every scrollToIndex lands short by their combined height.
		test("n centres it", async ({ page, player, isMobile }) => {
			test.skip(isMobile, "n is a keyboard shortcut");

			await openAtTheTop(page);
			player.playItem("p7", FAR.index);
			await expect(statusBar(page)).toContainText(FAR.title);

			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);

			await page.keyboard.press("n");
			await settle(page);

			await expectCentredOrClamped(page, FAR.index);
		});

		test("the now-playing pill takes you back", async ({ page, player }) => {
			await openAtTheTop(page);
			player.playItem("p7", FAR.index);
			await expect(statusBar(page)).toContainText(FAR.title);

			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);

			// The pill only exists while the playing track is off screen, measured
			// against the scroll container rather than against what was rendered.
			const pill = page.getByRole("button", { name: "Now playing" });
			await expect(pill).toBeVisible();
			await pill.click();
			await settle(page);

			await expectCentredOrClamped(page, FAR.index);
			await expect(pill).toBeHidden();
		});
	});
});

// On a list with a set of its own the playing row is the playing track's place
// in that set, read from the state's `libraryOrdinal` rather than found by a sweep of the whole
// library's paths. The record is the last in the library, so its tracks' ordinals run from 41 and
// none of them is a place on this page: a row lit at the ordinal itself is a row the page does not
// have.
test.describe("on an album's page", () => {
	test.use({ settings: { "jean.followPlayback": false } });

	const ALBUM = "Deathconsciousness";
	const ARTIST = "Have a Nice Life";
	const PLAYING = { row: 53, title: "Earthmover", place: 12 };

	test("lights the playing track at its place in the record, the pill takes you there, and nothing reads the whole library", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${albumRoute(ARTIST, ALBUM)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();

		player.playItem("p7", PLAYING.row);
		await expect(statusBar(page)).toContainText(PLAYING.title);

		const playing = trackRow(page, PLAYING.place);
		await expect(playing).toContainText(PLAYING.title);
		await expect(playing).toHaveAttribute("data-active", "true");
		await expect(
			page.locator('main [role="row"][data-active="true"]'),
		).toHaveCount(1);

		const pill = page.getByRole("button", { name: "Now playing" });
		await expect(pill).toBeVisible();
		await pill.click();
		await settle(page);
		await expectCentredOrClamped(page, PLAYING.place);
	});
});
