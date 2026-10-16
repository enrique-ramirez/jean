import assert from "node:assert/strict";
import test from "node:test";

import type { Virtualizer } from "@tanstack/react-virtual";

import {
	MAX_SCROLL_HEIGHT,
	scaledObserveElementOffset,
	scaledScrollToFn,
	scrollScale,
	toContentOffset,
	toScrollTop,
} from "../../src/shared/ui/scaledScroll.ts";

const ROW = 46;
const ROWS = 1_000_000;
const OVER = ROWS * ROW;
const JUST_UNDER = Math.floor(MAX_SCROLL_HEIGHT / ROW) * ROW;
const MARGIN = 120;
const VIEWPORT = 800;

type ScrollCall = { top?: number; behavior?: string };

type Listener = () => void;

function fakeScroller({
	total,
	margin = MARGIN,
	count = Math.round(total / ROW),
}: {
	total: number;
	margin?: number;
	count?: number;
}) {
	const listeners = new Map<string, Set<Listener>>();
	const calls: ScrollCall[] = [];
	const element = {
		scrollTop: 0,
		clientHeight: VIEWPORT,
		get scrollHeight() {
			return (
				instance.options.scrollMargin + Math.min(state.total, MAX_SCROLL_HEIGHT)
			);
		},
		addEventListener(type: string, listener: Listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(listener);
		},
		removeEventListener(type: string, listener: Listener) {
			listeners.get(type)?.delete(listener);
		},
		scrollTo(options: ScrollCall) {
			calls.push(options);
		},
	};
	const state = { total };
	const instance = {
		scrollElement: element,
		targetWindow: { setTimeout, clearTimeout },
		scrollRect: { width: 400, height: VIEWPORT },
		options: {
			count,
			estimateSize: () => ROW,
			scrollMargin: margin,
			horizontal: false,
			isRtl: false,
			useScrollendEvent: true,
			isScrollingResetDelay: 150,
		},
		getTotalSize: () => state.total,
	};
	const fire = (type: string) => {
		for (const listener of listeners.get(type) ?? []) listener();
	};
	return {
		element,
		state,
		calls,
		instance: instance as unknown as Virtualizer<HTMLElement, Element>,
		options: instance.options,
		bottom: () => element.scrollHeight - element.clientHeight,
		scrollTo(top: number) {
			element.scrollTop = top;
			fire("scroll");
		},
		settle: () => fire("scrollend"),
	};
}

function observe(scroller: ReturnType<typeof fakeScroller>) {
	const seen: { offset: number; isScrolling: boolean }[] = [];
	const unsubscribe = scaledObserveElementOffset(
		scroller.instance,
		(offset, isScrolling) => {
			seen.push({ offset, isScrolling });
		},
	);
	return { seen, unsubscribe, last: () => seen.at(-1)?.offset };
}

function assertNear(
	actual: number | undefined,
	expected: number,
	label: string,
) {
	assert.ok(
		actual !== undefined && Math.abs(actual - expected) <= 1,
		`${label}: expected ${expected} within 1 px, got ${actual}`,
	);
}

test("the cap is 15,000,000 px", () => {
	assert.equal(MAX_SCROLL_HEIGHT, 15_000_000);
});

test("at or under the cap a scrollTop and its content offset are the same number", () => {
	for (const total of [0, 100 * ROW, JUST_UNDER, MAX_SCROLL_HEIGHT]) {
		assert.equal(scrollScale(total), 1, `scale at ${total}`);
		for (const offset of [
			0,
			1,
			ROW,
			12_345.5,
			total / 2,
			total - VIEWPORT,
			total,
		]) {
			assert.equal(
				toContentOffset(offset, total),
				offset,
				`toContentOffset(${offset}) at ${total}`,
			);
			assert.equal(
				toScrollTop(offset, total),
				offset,
				`toScrollTop(${offset}) at ${total}`,
			);
		}
	}
});

test("over the cap a pixel of scroll moves more than a pixel of content, from the same top", () => {
	assert.ok(scrollScale(MAX_SCROLL_HEIGHT + ROW) > 1);
	assert.equal(toContentOffset(0, OVER), 0);
	assert.equal(toScrollTop(0, OVER), 0);
	assert.ok(toContentOffset(1_000, OVER) > 1_000);
	assert.ok(toScrollTop(1_000, OVER) < 1_000);
});

test("over the cap a content offset survives the trip to a scrollTop and back within a pixel", () => {
	for (let row = 0; row < ROWS; row += 997) {
		assertNear(
			toContentOffset(toScrollTop(row * ROW, OVER), OVER),
			row * ROW,
			`row ${row}`,
		);
	}
	const lastRow = (ROWS - 1) * ROW;
	assertNear(
		toContentOffset(toScrollTop(lastRow, OVER), OVER),
		lastRow,
		"last row",
	);
	for (let offset = 0; offset <= OVER; offset += 9_973) {
		assertNear(
			toContentOffset(toScrollTop(offset, OVER), OVER),
			offset,
			`offset ${offset}`,
		);
	}
});

test("under the cap the virtualiser hears the scroller's own scrollTop", () => {
	const scroller = fakeScroller({ total: 100 * ROW });
	const { last } = observe(scroller);
	for (const top of [0, MARGIN / 2, MARGIN, 1_234.5, scroller.bottom()]) {
		scroller.scrollTo(top);
		assert.equal(last(), top);
	}
});

test("under the cap a scroll the virtualiser asks for is the scrollTop it gets, adjustments included", () => {
	const scroller = fakeScroller({ total: JUST_UNDER });
	scaledScrollToFn(4_600, { adjustments: 23 }, scroller.instance);
	scaledScrollToFn(MARGIN, {}, scroller.instance);
	assert.deepEqual(
		scroller.calls.map((call) => call.top),
		[4_623, MARGIN],
	);
});

test("over the cap the header above the list scrolls one for one", () => {
	const scroller = fakeScroller({ total: OVER });
	const { last } = observe(scroller);
	scroller.scrollTo(0);
	assert.equal(last(), 0);
	scroller.scrollTo(MARGIN);
	assertNear(last(), MARGIN, "the list's top at the scroller's top");

	scaledScrollToFn(MARGIN, {}, scroller.instance);
	assertNear(scroller.calls.at(-1)?.top, MARGIN, "scrolling to row 0");
});

test("over the cap the bottom of the scroller shows the list's last row", () => {
	const scroller = fakeScroller({ total: OVER });
	const { last } = observe(scroller);
	scroller.scrollTo(scroller.bottom());
	assertNear(last(), MARGIN + OVER - VIEWPORT, "offset at the bottom");
});

test("over the cap scrolling to the last row lands at the bottom of the scroller", () => {
	const scroller = fakeScroller({ total: OVER });
	scaledScrollToFn(MARGIN + OVER - VIEWPORT, {}, scroller.instance);
	assertNear(
		scroller.calls.at(-1)?.top,
		scroller.bottom(),
		"scrollTop for the last row",
	);
});

// @tanstack/virtual-core adjustments are measured in content pixels: a row that measured 10 px taller than
// estimated moves the content 10 px, which over the cap is fewer scroll pixels.
test("over the cap an adjustment moves the scroll by its share of the content, not its own size", () => {
	const scroller = fakeScroller({ total: OVER });
	const offset = MARGIN + 500_000 * ROW;
	scaledScrollToFn(offset, { adjustments: 4_600 }, scroller.instance);
	scaledScrollToFn(offset + 4_600, {}, scroller.instance);
	const [adjusted, direct] = scroller.calls.map((call) => call.top);
	assertNear(adjusted, direct ?? Number.NaN, "adjusted against direct");
});

test("a smooth scroll stays smooth", () => {
	for (const total of [100 * ROW, OVER]) {
		const scroller = fakeScroller({ total });
		scaledScrollToFn(
			MARGIN + 50 * ROW,
			{ behavior: "smooth" },
			scroller.instance,
		);
		assert.equal(scroller.calls.at(-1)?.behavior, "smooth", `at ${total}`);
	}
});

test("the scale follows the list's drawn height, not its row count", () => {
	const grouped = 50_000_000;
	const scroller = fakeScroller({ total: grouped, count: ROWS });
	const { last } = observe(scroller);
	scroller.scrollTo(scroller.bottom());
	assertNear(
		last(),
		MARGIN + grouped - VIEWPORT,
		"offset at the bottom of a grouped list",
	);
});

// @tanstack/virtual-core subscribes once per scroll element.
test("a total or margin that changes after subscribing is read at the next scroll", () => {
	const scroller = fakeScroller({ total: 100 * ROW, margin: 0 });
	const { last } = observe(scroller);
	scroller.state.total = OVER;
	scroller.options.scrollMargin = MARGIN;
	scroller.scrollTo(scroller.bottom());
	assertNear(
		last(),
		MARGIN + OVER - VIEWPORT,
		"offset at the bottom after growing",
	);
	scroller.scrollTo(MARGIN);
	assertNear(last(), MARGIN, "row 0 after the header was measured");
});

test("a scroll reports itself in motion and its end reports it settled", () => {
	const scroller = fakeScroller({ total: OVER });
	const { seen } = observe(scroller);
	scroller.scrollTo(MARGIN + 1_000);
	scroller.settle();
	assert.deepEqual(
		seen.map((report) => report.isScrolling),
		[true, false],
	);
});

test("after unsubscribing a scroll reaches nobody", () => {
	const scroller = fakeScroller({ total: OVER });
	const { seen, unsubscribe } = observe(scroller);
	scroller.scrollTo(MARGIN);
	assert.equal(seen.length, 1);
	assert.equal(typeof unsubscribe, "function");
	unsubscribe?.();
	scroller.scrollTo(MARGIN + 1_000);
	scroller.settle();
	assert.equal(seen.length, 1);
});
