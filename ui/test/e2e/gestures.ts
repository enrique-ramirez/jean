import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, times } from "./fixtures.ts";

// A finger dragged between two points, driven through CDP rather than
// dispatched as DOM events: what these tests are usually about is the browser's
// own decision about who the gesture belongs to, and a dispatched `touchmove`
// sails past that and passes either way. Why every point is stamped and why the
// session is one per page rather than one per drag: test/README.md.
const sessions = new WeakMap<Page, Promise<CDPSession>>();

const sessionFor = (page: Page) => {
	const held = sessions.get(page);
	if (held) return held;
	const session = page.context().newCDPSession(page);
	sessions.set(page, session);
	return session;
};

export const touchDrag = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 4,
) => {
	const cdp = await sessionFor(page);
	const at = Date.now() / 1000;
	let tick = 0;
	const send = (
		type: "touchStart" | "touchMove" | "touchEnd",
		point: { x: number; y: number },
	) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [point],
			timestamp: at + 0.02 * tick++,
		});

	await send("touchStart", from);
	await times(steps, (step) => {
		const at = (step + 1) / steps;
		return send("touchMove", {
			x: from.x + (to.x - from.x) * at,
			y: from.y + (to.y - from.y) * at,
		});
	});
	await send("touchEnd", to);
};

export const restingBox = async (target: Locator) => {
	let last = "null";
	await expect
		.poll(async () => {
			const now = JSON.stringify(await target.boundingBox());
			const isStill = now !== "null" && now === last;
			last = now;
			return isStill;
		})
		.toBe(true);
	return JSON.parse(last) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
};

// Across the middle of an action sheet, further than a flick has to travel. React hands a touch on
// a portalled sheet to the ancestors of the component that drew it, wherever the sheet is on the
// page, so a drag across it reaches their gesture handlers.
export const dragAcrossTheSheet = async (
	page: Page,
	sheet: Locator,
	towards: "left" | "right" = "left",
) => {
	const box = await restingBox(sheet);
	await dragSideways(page, box, box.y + box.height / 2, towards);
};

const dragSideways = (
	page: Page,
	box: { x: number; width: number },
	y: number,
	towards: "left" | "right",
) => {
	const right = { x: box.x + box.width * 0.85, y };
	const left = { x: box.x + box.width * 0.2, y };
	const [from, to] = towards === "left" ? [right, left] : [left, right];
	return touchDrag(page, from, to);
};

// The room a drag from the scrim needs above the sheet: further than a flick has to travel.
const SCRIM_ROOM_PX = 100;

// A drag that begins on the dimmed scrim above an action sheet and never crosses the sheet. The
// sheet sits at the bottom of the viewport, so the scrim on show is what lies above it.
export const dragFromTheScrim = async (
	page: Page,
	sheet: Locator,
	towards: "left" | "right" | "down",
) => {
	const box = await restingBox(sheet);
	expect(box.y, "the scrim on show above the sheet").toBeGreaterThan(
		SCRIM_ROOM_PX,
	);

	if (towards !== "down") return dragSideways(page, box, box.y / 2, towards);

	const x = box.x + box.width / 2;
	return touchDrag(page, { x, y: box.y * 0.2 }, { x, y: box.y * 0.8 });
};

// Inside the strip at the top of an action sheet that a thumb drags it away by.
const GRABBER_INSET = 8;

export const dragTheSheetAwayByItsTopEdge = async (
	page: Page,
	sheet: Locator,
) => {
	const box = await restingBox(sheet);
	const x = box.x + box.width / 2;
	await touchDrag(
		page,
		{ x, y: box.y + GRABBER_INSET },
		{ x, y: box.y + box.height },
	);
};

// Enough moves that the browser paints the sheet between them.
const GRABBER_DRAG_STEPS = 12;

// Straight down from the grabber at the top of a bottom sheet, by `distance` pixels.
export const fromTheGrabber = async (
	page: Page,
	sheet: Locator,
	distance: number,
) => {
	const box = await restingBox(sheet);
	const x = box.x + box.width / 2;
	const y = box.y + GRABBER_INSET;
	await touchDrag(page, { x, y }, { x, y: y + distance }, GRABBER_DRAG_STEPS);
};

// How far the sheet ever stood from where it rested when this was called, sampled every frame
// until read. A box read after the finger lifts sees only where the sheet came back to.
export const watchHowFarItMoves = async (sheet: Locator) => {
	const watch = await sheet.evaluateHandle((element) => {
		const rest = element.getBoundingClientRect().top;
		const seen = { furthest: 0, watching: true };
		const sample = () => {
			if (!seen.watching) return;
			const offset = Math.abs(element.getBoundingClientRect().top - rest);
			seen.furthest = Math.max(seen.furthest, offset);
			requestAnimationFrame(sample);
		};
		sample();
		return seen;
	});
	return () =>
		watch.evaluate((seen) => {
			seen.watching = false;
			return seen.furthest;
		});
};

// Driven with the real mouse rather than dispatched events: pointer capture and
// the element's own rect are what is under test.
export const dragTo = async (
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

// Drags one element over another and stops there, still holding: a drop target
// arms on an animation frame rather than on the move, so a caller waits for it to
// light up before releasing, and one caller releases somewhere else on purpose.
export const dragFrom = async (page: Page, source: Locator, onto: Locator) => {
	const from = await source.boundingBox();
	const to = await restingBox(onto);

	await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 16,
	});
};

// Press-and-hold, which is touch's right-click. Dispatched rather than driven by
// page.touchscreen, which has no way to hold. The synthetic click at the end is
// part of the gesture: a hold that stopped swallowing it would also activate
// whatever it opened the menu over.
export const pressAndHold = async (page: Page, target: Locator) => {
	const box = (await target.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	const touch = {
		pointerType: "touch",
		isPrimary: true,
		button: 0,
		clientX: box.x + box.width / 2,
		clientY: box.y + box.height / 2,
	};

	await target.dispatchEvent("pointerdown", touch);
	await page.waitForTimeout(520); // past the 420ms hold
	await target.dispatchEvent("pointerup", touch);
	await target.dispatchEvent("click", { ...touch, detail: 1 });
};
