// The box Playwright hands back from boundingBox(), which it does not name.
type BoundingBox = { x: number; y: number; width: number; height: number };

import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	requestsTo,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";

const volume = (page: Page) => page.getByRole("slider", { name: "Volume" });
const seekBar = (page: Page) =>
	page.getByRole("slider", { name: "Playback position" });

// On a phone the volume slider is a column inside a popover rather than a row
// in the status bar, so it has to be opened before it exists.
const showVolume = async (page: Page) => {
	if (await volume(page).count()) return;
	await page.getByRole("button", { name: "Volume" }).click();
	await expect(volume(page)).toBeVisible();
};

const volumesSent = (player: FakePlayer) =>
	requestsTo(player, "/api/player")
		.map((entry) => entry.body?.volume)
		.filter((value) => value !== undefined);

// Driven with the real mouse rather than dispatched events: pointer capture and
// the element's own rect are what is under test.
const dragTo = async (
	page: Page,
	slider: Locator,
	fraction: number,
	steps = 20,
) => {
	const box = await slider.boundingBox();
	const vertical = box!.height > box!.width;
	const start = vertical
		? { x: box!.x + box!.width / 2, y: box!.y + box!.height }
		: { x: box!.x, y: box!.y + box!.height / 2 };
	const end = vertical
		? { x: box!.x + box!.width / 2, y: box!.y + box!.height * (1 - fraction) }
		: { x: box!.x + box!.width * fraction, y: box!.y + box!.height / 2 };

	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps });
	await page.mouse.up();
};

test.describe("the volume slider", () => {
	test.skip(({ isMobile }) => isMobile, "dragging a fader is a mouse gesture");

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await showVolume(page);
	});

	// Where the fader lands, in dB, after a drag to that fraction of its travel.
	const landsAt = async (page: Page, player: FakePlayer, fraction: number) => {
		const before = volumesSent(player).length;
		await dragTo(page, volume(page), fraction);
		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(before);
		return volumesSent(player).at(-1);
	};

	// The curve is linear in perceived loudness, where about +10 dB is twice as
	// loud. A linear-in-dB fader would land at -50 here.
	test("half the travel is half as loud, which is -10 dB", async ({
		page,
		player,
	}) => {
		const landed = await landsAt(page, player, 0.5);

		expect(landed).toBeGreaterThan(-13);
		expect(landed).toBeLessThan(-7.5);
	});

	test("a sixth of the travel is quiet, not silent", async ({
		page,
		player,
	}) => {
		const landed = await landsAt(page, player, 0.15);

		// Everything below roughly -40 dB is inaudible.
		expect(landed).toBeGreaterThan(-32);
		expect(landed).toBeLessThan(-23);
	});

	// Equal distances along the fader are equal ratios of loudness.
	test("ten points is worth about the same everywhere, near the top", async ({
		page,
		player,
	}) => {
		const seventy = await landsAt(page, player, 0.7);
		const eighty = await landsAt(page, player, 0.8);

		expect(eighty - seventy).toBeGreaterThan(0);
		expect(eighty - seventy).toBeLessThan(3);
	});

	test("the ends are the ends", async ({ page, player }) => {
		await dragTo(page, volume(page), 1);
		await expect.poll(() => volumesSent(player).at(-1)).toBe(0);

		await dragTo(page, volume(page), 0);
		await expect.poll(() => volumesSent(player).at(-1)).toBe(-100);
	});

	test("a drag sends far fewer requests than it has moves, and the last one wins", async ({
		page,
		player,
	}) => {
		// The fake answers in microseconds, so without added latency every pointer
		// move would find no request in flight and send its own.
		await page.request.post("/__control/latency", { data: { ms: 100 } });

		const MOVES = 40;
		await dragTo(page, volume(page), 0.6, MOVES);

		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0);
		// Let the tail of the queue land before counting.
		await page.waitForTimeout(400);
		const sent = volumesSent(player);

		// One in flight at a time, newest queued behind it: one request per pointer
		// event floods the player, and the responses can land out of order.
		expect(sent.length).toBeLessThan(MOVES / 2);

		// Whatever was queued during the last flight is still sent afterwards, so
		// the player ends on the value the drag finished on.
		await expect.poll(() => player.player.volume.value).toBe(sent.at(-1));
		expect(sent.at(-1)).toBeGreaterThan(-20);
		expect(sent.at(-1)).toBeLessThan(-5);
	});

	test("it cannot be selected, so a press cannot turn into a native drag", async ({
		page,
	}) => {
		// Otherwise the browser starts a text selection across whatever sits beside
		// the control, and dragging a selection paints a translucent snapshot of it
		// that follows the pointer instead of the thumb.
		const style = await volume(page).evaluate((element: HTMLElement) => {
			const computed = getComputedStyle(element);
			return {
				userSelect: computed.userSelect,
				webkitUserSelect: computed.webkitUserSelect,
			};
		});
		expect(
			style.userSelect === "none" || style.webkitUserSelect === "none",
		).toBe(true);
	});

	test("the reported value is a percentage of the fader, not of the decibels", async ({
		page,
	}) => {
		// -100..0 dB is the player's range; a slider that reported it raw would say
		// 77% for a volume most of the way down.
		await dragTo(page, volume(page), 0.5);

		const reported = async () =>
			Number(await volume(page).getAttribute("aria-valuenow"));
		await expect.poll(reported).toBeGreaterThan(45);
		await expect.poll(reported).toBeLessThan(55);
	});
});

test.describe("the seek bar", () => {
	test.skip(({ isMobile }) => isMobile, "scrubbing is a mouse gesture");

	test("it is not seekable until something is playing", async ({ page }) => {
		await openLibrary(page);
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "false");
	});

	test("scrubbing commits once, on release", async ({ page, player }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "true");

		const positions = () =>
			requestsTo(player, "/api/player")
				.map((entry) => entry.body?.position)
				.filter((value) => value !== undefined);

		await dragTo(page, seekBar(page), 0.5, 30);

		// Los Calientes is 4:37, so halfway is a bit under two and a half minutes.
		await expect.poll(() => positions()).toHaveLength(1);
		const landed = positions()[0];
		expect(landed).toBeGreaterThan(125);
		expect(landed).toBeLessThan(155);
	});

	test("it cannot be selected either", async ({ page }) => {
		await openLibrary(page);
		const style = await seekBar(page).evaluate((element: HTMLElement) => {
			const computed = getComputedStyle(element);
			return {
				userSelect: computed.userSelect,
				webkitUserSelect: computed.webkitUserSelect,
			};
		});
		expect(
			style.userSelect === "none" || style.webkitUserSelect === "none",
		).toBe(true);
	});
});

// Driven through CDP rather than dispatched as DOM events: what is under test
// is the browser's own decision about who the gesture belongs to. Without
// `touch-action: none` on the track it reads the finger as panning the page,
// sends `pointercancel` and stops delivering moves. A dispatched `pointermove`
// would sail past that and pass either way.
test.describe("dragging the fader with a finger", () => {
	test.skip(({ isMobile }) => !isMobile, "this is the touch gesture");

	const swipe = async (
		page: Page,
		box: BoundingBox,
		from: number,
		to: number,
	) => {
		const at = (fraction: number) => ({
			x: box.x + box.width / 2,
			// The column runs bottom-up: the top of the track is the maximum.
			y: box.y + box.height * (1 - fraction),
		});

		// More steps than the default: what is under test here is that every move
		// arrives, not what the gesture is read as at the end of it.
		await touchDrag(page, at(from), at(to), 12);
	};

	test("the target is big enough to aim at", async ({ page }) => {
		await openLibrary(page);
		await showVolume(page);

		// A thumb is about 44px of contact. Just off the slider is the popover,
		// which does not claim the gesture, so the browser reads the same downward
		// drag as a page pan and takes it.
		const box = await volume(page).boundingBox();
		expect(
			box!.width,
			`the fader is ${Math.round(box!.width)}px of thumb`,
		).toBeGreaterThanOrEqual(44);
	});

	test("the value follows the finger the whole way", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await showVolume(page);

		const box = (await volume(page).boundingBox())!;
		await swipe(page, box, 0.9, 0.25);

		// The swipe crosses most of the track, so a cancelled pointer stream shows
		// up as a value far from the target rather than as a rounding difference.
		await expect
			.poll(() => volume(page).getAttribute("aria-valuenow"), {
				message: "the fader did not follow the finger to the end of the swipe",
			})
			.toBeTruthy();

		const landed = Number(await volume(page).getAttribute("aria-valuenow"));
		expect(
			Math.abs(landed - 25),
			`fader landed at ${landed}%, aimed at 25%`,
		).toBeLessThan(8);

		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0);
	});
});
