import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

// Row heights, the scroll offset and the container's own rect are all
// fractional, so a row scrolled exactly to the bottom edge lands a few tenths of
// a pixel past it.
const EDGE_TOLERANCE_PX = 1;

export const isRowOnScreen = (page: Page, index: number) =>
	page.evaluate(
		({ row, slack }) => {
			const element = document.querySelector(`[role="row"][data-row="${row}"]`);
			if (!element) return false;
			const scroller = document.querySelector("main") as HTMLElement;
			const seen = element.getBoundingClientRect();
			const view = scroller.getBoundingClientRect();
			return seen.top >= view.top - slack && seen.bottom <= view.bottom + slack;
		},
		{ row: index, slack: EDGE_TOLERANCE_PX },
	);

// A step short of a screenful, so two consecutive steps overlap and no row can
// fall between them.
const SCREENFUL = 0.8;

// Frames the list may keep moving for before it is read anyway. A list that
// never comes to rest should fail on the assertion it was scrolled for, not on
// the test's own timeout with nothing said about why.
const STILLNESS_CAP_FRAMES = 90;

// Consecutive unchanged frames required to call the list settled, rather than
// one: a single match can be two samples either side of a change that is still
// in flight.
const STILL_FRAMES = 3;

const listHoldsStill = (page: Page) =>
	page.evaluate(
		([cap, stillFrames]: [number, number]) =>
			new Promise<void>((resolve) => {
				const scroller = document.querySelector("main") as HTMLElement;
				let last = "";
				let still = 0;
				let frames = 0;
				const tick = () => {
					const now = `${scroller.scrollTop}/${scroller.scrollHeight}`;
					still = now === last ? still + 1 : 0;
					last = now;
					frames += 1;
					if (still >= stillFrames || frames >= cap) resolve();
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		[STILLNESS_CAP_FRAMES, STILL_FRAMES] as [number, number],
	);

const scrollOneScreen = (page: Page) =>
	page.evaluate((fraction: number) => {
		const scroller = document.querySelector("main") as HTMLElement;
		const from = scroller.scrollTop;
		scroller.scrollBy(0, scroller.clientHeight * fraction);
		return scroller.scrollTop > from;
	}, SCREENFUL);

// TanStack Virtual mounts only the rows near the viewport, so a row further
// down does not exist to be located until the list has been scrolled to it. In
// album mode its total height is an estimate until the groups are measured:
// believing the list short, it mounts a far row for a moment and drops it when
// the measuring pass lands, so every read waits for the list to come to rest.
const REFUSALS_BEFORE_GIVING_UP = 2;

export const scrollUntilMounted = async (page: Page, locator: Locator) => {
	// Wait for the view before scrolling it. Without this the loop below scrolls
	// a container with nothing in it, which shows up only in a full parallel run.
	await expect(page.locator('[role="row"]').first()).toBeAttached();

	let refusals = 0;
	while (refusals < REFUSALS_BEFORE_GIVING_UP) {
		await listHoldsStill(page);
		if (await locator.count()) break;
		refusals = (await scrollOneScreen(page)) ? 0 : refusals + 1;
	}

	await expect(
		locator,
		"the row never mounted, and the list ran out of room to scroll",
	).toBeAttached();
};

export const scrollTop = (page: Page) =>
	page.evaluate(
		() => (document.querySelector("main") as HTMLElement).scrollTop,
	);

export const scrollTo = (page: Page, offset: number) =>
	page.evaluate(
		(to) => (document.querySelector("main") as HTMLElement).scrollTo(0, to),
		offset,
	);
