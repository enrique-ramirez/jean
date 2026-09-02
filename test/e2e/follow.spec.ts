import type { Page } from "./fixtures.ts";
import {
	expect,
	isRowOnScreen,
	openLibrary,
	requestsTo,
	scrollTo,
	scrollTop,
	statusBar,
	test,
	times,
	trackRow,
} from "./fixtures.ts";

// Far enough down the 54-track fixture to be well past the fold on both the
// desktop and the phone viewport.
const FAR = { index: 40, title: "Goodnite, Noises Everywhere" };

// Where the view came to rest. Polling "is the row visible yet" is not the same
// question: an animated jump brings the row on screen well before it stops
// moving, so measuring where it landed at that moment measures a frame of the
// animation instead. Two equal readings mean nothing is still running.
const settle = async (page: Page) => {
	await page.waitForTimeout(900);
	const first = await scrollTop(page);
	await page.waitForTimeout(300);
	expect(await scrollTop(page)).toBe(first);
	return first;
};

// How far the playing row's middle is from the view's, in pixels. Zero is
// centred; a whole row height away is not.
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

// Centred, unless the list has run out of room to centre it. Near either end
// the scroll clamps and the track simply cannot reach the middle -- asserting
// otherwise would be asserting that scrollTop can go negative. What still has
// to hold there is that it is on screen at all.
const expectCentredOrClamped = async (page: Page, index: number) => {
	const distance = await offCentre(page);
	expect(distance, `track ${index} was not mounted`).not.toBeNull();

	const { top, max } = await page.evaluate(() => {
		const scroller = document.querySelector("main");
		return {
			top: scroller!.scrollTop,
			max: scroller!.scrollHeight - scroller!.clientHeight,
		};
	});

	if (top <= 1 || top >= max - 1) {
		expect(
			await isRowOnScreen(page, index),
			`track ${index} clamped off screen`,
		).toBe(true);
		return;
	}
	expect(
		distance!,
		`track ${index} settled ${Math.round(distance!)}px off centre`,
	).toBeLessThan(2);
};

// The first fully visible row at or past the middle of the view. Which index
// that is depends on the layout and the viewport, so it is measured.
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

// The shared openLibrary waits for row 0 to be *attached*, which overscan makes
// true well above the fold. Everything below measures where the view came to
// rest, so it has to start from one that has settled at the top.
const openAtTheTop = async (page: Page) => {
	await openLibrary(page);
	await expect(isRowOnScreen(page, 0)).resolves.toBe(true);
};

test.describe("following playback", () => {
	test("the view scrolls to a track the player changed to", async ({
		page,
		player,
	}) => {
		await openAtTheTop(page);
		expect(await isRowOnScreen(page, FAR.index)).toBe(false);

		// Driven on the player rather than through the UI, because that is the case
		// this has to get right: the track ended, or someone pressed next on the
		// desktop. Nothing was clicked here, so the only thing that can move the
		// view is the SSE push.
		player.playItem("p7", FAR.index);

		await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
		await expect(trackRow(page, FAR.index)).toHaveAttribute(
			"data-active",
			"true",
		);
		// Nothing was played from here -- the scroll is a reaction, not a request.
		expect(requestsTo(player, "/player/play/")).toEqual([]);
	});

	test("a playlist growing under you does not drag the view back", async ({
		page,
		player,
	}) => {
		await openAtTheTop(page);
		player.playItem("p7", FAR.index);
		await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
		// The follow animation is still running at this point -- the row comes into
		// view well before it stops moving -- and scrolling away mid-flight just
		// gets undone by the next frame of it.
		await settle(page);

		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);

		// Rows arriving is what re-runs the follow, and at library size they arrive
		// in chunks -- so without a record of which track has already been followed,
		// every chunk drags the view back to it and the list cannot be read while it
		// loads. Appending one track is that same event with one chunk instead of
		// sixteen, and it is the only way to provoke it against a 54-track fixture.
		player.copyItems("p5", "p7", [0]);
		// Item changes are not pushed by a real player, so the growth has to be
		// announced the way a landing chunk announces itself. See state.js.
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
		// The track really did change -- the status bar proves the push landed. So
		// the view staying put is the setting working, not the update never
		// arriving, which is the way this test would otherwise pass for free.
		await expect(statusBar(page)).toContainText(FAR.title);
		await page.waitForTimeout(400);

		expect(await scrollTop(page)).toBe(0);
		expect(await isRowOnScreen(page, FAR.index)).toBe(false);
	});
});

test.describe("the jump survives a coasting list", () => {
	test.use({ settings: { "jean.followPlayback": false } });
	test.skip(({ isMobile }) => isMobile, "wheel is a pointer input");

	// Both the key and the wheel are dispatched from inside the page, one frame
	// apart. Driving them over the wire instead means two round trips against a
	// 240ms animation, and under parallel workers those land after it has already
	// finished -- so the test passes whether or not the cancelling works. That
	// version was not wrong so much as unreliable, which is worse: it failed
	// correctly when run alone and passed in a full run.
	//
	// A dispatched wheel event does not scroll anything, which is the point. All
	// that is under test is whether the listener treats it as a decision.
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

		// Momentum from a flick that ended before the jump was even asked for. One
		// pixel used to be enough to kill the animation and leave the view parked
		// between where it started and where it was going, with the track not
		// merely off centre but not rendered at all.
		await jumpAndWheel(page, 1);

		await settle(page);
		expect(await isRowOnScreen(page, FAR.index)).toBe(true);
	});

	test("a real scroll still takes it back", async ({ page, player }) => {
		await openAtTheTop(page);
		player.playItem("p7", FAR.index);
		await expect(statusBar(page)).toContainText(FAR.title);

		// What an uninterrupted jump settles on, measured rather than assumed, so
		// the interrupted one can be compared against something real.
		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);
		await jumpAndWheel(page, 0);
		const uninterrupted = await settle(page);
		expect(uninterrupted).toBeGreaterThan(0);

		await scrollTo(page, 0);
		await expect.poll(() => scrollTop(page)).toBe(0);
		// Deliberate, and well past the threshold. An animation that keeps hauling
		// the view back while someone is scrolling feels broken, so this must win.
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
		// The whole point of the chunked load and the virtualiser is this size, and
		// scroll offsets are arithmetic over a list 1.4 million pixels tall. None of
		// the other specs would notice if that arithmetic broke past a few thousand.
		await page.goto("/#/p7");
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

// The two layouts are not one code path with a different stylesheet. Album mode
// virtualises groups rather than rows, so the index handed to the virtualiser is
// not the index being centred; on a phone the cover stacks above its tracks
// instead of sitting beside them, which changes every group's height; and the
// row heights differ between them. Both projects run every spec, so each
// assertion below is made four times -- list and album, desktop and phone.
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

			// Back up the list. Minimal scrolling used to tuck this one under the
			// sticky toolbar -- in view by the letter, and needing a nudge of the
			// wheel to be seen. Centre has no edge to land on, so direction stops
			// mattering.
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

			// Centred somewhere with room on both sides first, so "it did not move"
			// is a different sentence from "it was at the top and could not".
			player.playItem("p7", FAR.index);
			await expect.poll(() => isRowOnScreen(page, FAR.index)).toBe(true);
			const resting = await settle(page);
			expect(resting).toBeGreaterThan(0);

			// This used to re-centre on every one of these, so the list crept by a
			// row per track and whatever you were reading moved out from under you.
			await times(3, async (step) => {
				const next = FAR.index + 1 + step;
				player.next();
				await expect(trackRow(page, next)).toHaveAttribute(
					"data-active",
					"true",
				);
				await page.waitForTimeout(500);
				expect(
					await isRowOnScreen(page, next),
					`track ${next} left the screen`,
				).toBe(true);
				expect(await scrollTop(page), `the view moved for track ${next}`).toBe(
					resting,
				);
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

			// Staying put is only right while the row is on screen. Away from it,
			// the next track has to come back -- otherwise not scrolling stops being
			// restraint and becomes the view never following at all.
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
		}) => {
			test.skip(
				test.info().project.name === "mobile",
				"double-click is a pointer gesture",
			);

			await openAtTheTop(page);
			await scrollTo(page, 300);
			await expect.poll(() => scrollTop(page)).toBe(300);

			// Read off the page rather than named: which index is halfway down the
			// view depends on the layout's row heights and on the viewport.
			const index = await rowInTheMiddle(page);
			expect(index, "no fully visible row past the middle").not.toBeNull();

			await trackRow(page, index!).dblclick();
			await expect(trackRow(page, index!)).toHaveAttribute(
				"data-active",
				"true",
			);
			await page.waitForTimeout(600);

			// The whole complaint: asking for a track you are looking at should not
			// take the list away from you.
			expect(await scrollTop(page)).toBe(300);
		});

		test("the last track is reachable even though it cannot be centred", async ({
			page,
			player,
		}) => {
			await openAtTheTop(page);

			// The end of the list is where centring is impossible and the scroll
			// clamps. That is also where the original offset bug hid: the clamp
			// absorbed the error, so those tracks looked fine while the middle of the
			// list did not.
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

		// The bug this covers: the virtualiser was told nothing about the view
		// header and toolbar above the list, so every scrollToIndex landed short by
		// their combined height. It read as "centring is a bit off" on a tall
		// window, as "it does not scroll at all" on a short one -- there the error
		// was the whole distance -- and as "it works sometimes" near the end of the
		// list, where the clamp absorbed it.
		test("n centres it", async ({ page, player }) => {
			test.skip(
				test.info().project.name === "mobile",
				"n is a keyboard shortcut",
			);

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

			// The pill only exists while the playing track is off screen, which is
			// itself the assertion: it is measured against the scroll container
			// rather than inferred from what the virtualiser rendered.
			const pill = page.getByRole("button", { name: "Now playing" });
			await expect(pill).toBeVisible();
			await pill.click();
			await settle(page);

			await expectCentredOrClamped(page, FAR.index);
			await expect(pill).toBeHidden();
		});
	});
});
