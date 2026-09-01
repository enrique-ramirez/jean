// The box Playwright hands back from boundingBox(), which it does not name.
type BoundingBox = { x: number; y: number; width: number; height: number };

// CDP's own vocabulary for a touch phase.
type TouchEventType = "touchStart" | "touchMove" | "touchEnd" | "touchCancel";

import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	requestsTo,
	test,
	times,
	trackRow,
} from "./fixtures.ts";

// The two drag controls. Both go through useDragFraction and both write through
// something that refuses to send one request per pointer event -- which is the
// part worth testing, because a slider that works and floods the player looks
// exactly like a slider that works.

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

// Every value the app has sent for the player's volume, in order.
const volumesSent = (player: FakePlayer) =>
	requestsTo(player, "/api/player")
		.map((entry) => entry.body?.volume)
		.filter((value) => value !== undefined);

// A drag across a fraction of the track, in `steps` moves, ending where it
// says. Driven with the real mouse rather than dispatched events, because
// pointer capture and the element's own rect are what is under test.
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

	// The curve is the feature, and it is a specific one: linear in *perceived
	// loudness*, where about +10 dB is twice as loud. A linear-in-dB fader would
	// land at -50 here and pass every other assertion in this file.
	test("half the travel is half as loud, which is -10 dB", async ({
		page,
		player,
	}) => {
		const landed = await landsAt(page, player, 0.5);

		expect(landed).toBeGreaterThan(-13);
		expect(landed).toBeLessThan(-7.5);
	});

	// The complaint that produced this curve, and the reason it is asserted in
	// absolute terms rather than as a ratio: the fader used to reach -72 dB here,
	// which is not a low volume, it is no volume. A quiet setting has to stay
	// audible or the bottom third of the control does nothing at all.
	test("a sixth of the travel is quiet, not silent", async ({
		page,
		player,
	}) => {
		const landed = await landsAt(page, player, 0.15);

		// Everything below roughly -40 dB is inaudible. This has to clear it
		// comfortably, not squeak past it.
		expect(landed).toBeGreaterThan(-32);
		expect(landed).toBeLessThan(-23);
	});

	// The property the whole curve exists for, and the one a spot check cannot
	// see: equal distances along the fader are equal *ratios* of loudness, so ten
	// points is worth the same amount of volume wherever it is taken from!. On the
	// old curve the same ten points crossed 5 dB up here and 17 dB of inaudible
	// nothing down at the bottom.
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
		// The fake answers in microseconds, so every pointer move would find no
		// request in flight and send its own -- which is what a control with no
		// coalescing at all does. A hundred milliseconds is an unremarkable round
		// trip to a player on the same network, and it is what makes the queue
		// observable.
		await page.request.post("/__control/latency", { data: { ms: 100 } });

		const MOVES = 40;
		await dragTo(page, volume(page), 0.6, MOVES);

		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0);
		// Let the tail of the queue land before counting.
		await page.waitForTimeout(400);
		const sent = volumesSent(player);

		// One request per pointer event floods the player, and the responses can
		// land out of order -- so the last value to arrive wins rather than the
		// last one sent. One in flight at a time, newest queued behind it.
		expect(sent.length).toBeLessThan(MOVES / 2);

		// And it converges: whatever was queued during the last flight is still
		// sent afterwards, so the player ends on the value the drag finished on.
		await expect.poll(() => player.player.volume.value).toBe(sent.at(-1));
		expect(sent.at(-1)).toBeGreaterThan(-20);
		expect(sent.at(-1)).toBeLessThan(-5);
	});

	test("it cannot be selected, so a press cannot turn into a native drag", async ({
		page,
	}) => {
		// Without this the browser starts a text selection running out across
		// whatever sits beside the control, and dragging a selection paints a
		// translucent snapshot of it that follows the pointer instead of the thumb.
		// It reads as the slider coming loose, and as intermittent, because it
		// depends on where the press landed and what was already selected.
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

		// Not one per move: scrubbing a track would otherwise fire a request per
		// pointer event and the player would stutter chasing them. Los Calientes is
		// 4:37, so halfway is a bit under two and a half minutes.
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

// A finger, not a mouse. The rest of this file drives the faders with the
// pointer and skips on mobile, which quietly encoded the assumption that
// dragging one is a mouse gesture -- and on a phone the volume column is a
// thing people drag with a thumb all day.
//
// Driven through CDP rather than dispatched as DOM events, because what is
// under test is the browser's own decision about who the gesture belongs to!.
// Without `touch-action: none` on the track it decides the finger is panning
// the page, sends `pointercancel`, and stops delivering moves -- so the thumb
// stops wherever it had got to and the value lands short. A dispatched
// `pointermove` would sail past that and pass either way.
test.describe("dragging the fader with a finger", () => {
	test.skip(({ isMobile }) => !isMobile, "this is the touch gesture");

	const swipe = async (
		page: Page,
		box: BoundingBox,
		from: number,
		to: number,
	) => {
		const cdp = await page.context().newCDPSession(page);
		const at = (fraction: number) => ({
			x: box!.x + box!.width / 2,
			// The column runs bottom-up: the top of the track is the maximum.
			y: box!.y + box!.height * (1 - fraction),
		});

		const send = (type: TouchEventType, point: { x: number; y: number }) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints: type === "touchEnd" ? [] : [{ x: point.x, y: point.y }],
			});

		await send("touchStart", at(from));
		await times(12, (step) =>
			send("touchMove", at(from + ((to - from) * (step + 1)) / 12)),
		);
		await send("touchEnd", at(to));
		await cdp.detach();
	};

	test("the target is big enough to aim at", async ({ page }) => {
		await openLibrary(page);
		await showVolume(page);

		// A thumb is about 44px of contact, and the column was 26px wide. What
		// makes the miss expensive rather than merely annoying is where it lands:
		// just off the slider is the popover, which does not claim the gesture, so
		// the browser reads the same downward drag as a page pan and takes it.
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

		// Landed near where the finger let go, not stranded partway. The gesture
		// crosses most of the track, so a cancelled pointer stream shows up as a
		// value far from the target rather than as a rounding difference.
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

		// And it reached the player. How the writes are coalesced is the mouse
		// drag's test above -- the same `useCoalescedWrite` is under both, and
		// proving it twice would only mean setting the latency up twice.
		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0);
	});
});
