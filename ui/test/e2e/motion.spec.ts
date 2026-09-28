import type { FakePlayer, Page } from "./fixtures.ts";
import { expect, openLibrary, statusBar, test } from "./fixtures.ts";

const TOGGLE = 'footer button[aria-label="Pause"]';

const toggle = (page: Page) =>
	statusBar(page).getByRole("button", { name: "Pause" });

const shape = (page: Page) =>
	page.evaluate((selector: string) => {
		const element = document.querySelector(selector) as HTMLElement;
		const style = getComputedStyle(element);
		const box = element.getBoundingClientRect();
		// offsetWidth ignores transforms and getBoundingClientRect does not, so the
		// two agreeing means nothing is being scaled or rotated.
		return {
			scale: style.scale,
			rotate: style.rotate,
			painted: Number(box!.width.toFixed(2)),
			laidOut: element.offsetWidth,
		};
	}, TOGGLE);

// `read` is stringified into the page, so it has to be self-contained.
const overFrames = <T>(
	page: Page,
	count: number,
	read: () => T,
): Promise<T[]> =>
	page.evaluate(
		({ frames, source }) =>
			new Promise<T[]>((resolve) => {
				const sample = new Function(`return (${source})`)() as () => T;
				const seen: T[] = [];
				const tick = () => {
					seen.push(sample());
					if (seen.length < frames) requestAnimationFrame(tick);
					else resolve(seen);
				};
				requestAnimationFrame(tick);
			}),
		{ frames: count, source: read.toString() },
	);

const boxOfToggle = () => {
	const element = document.querySelector(
		'footer button[aria-label="Pause"]',
	) as HTMLElement;
	const box = element.getBoundingClientRect();
	return `${box!.width.toFixed(3)}x${box!.height.toFixed(3)}`;
};

// Only the animations that end: the toggle's spin and the arrow's nod repeat
// forever, and are what the samples below are about.
const entrancesFinished = (page: Page) =>
	page.evaluate(async () => {
		await new Promise(requestAnimationFrame);
		await Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().endTime !== Infinity,
				)
				.map((animation) => animation.finished.catch(() => undefined)),
		);
	});

const startPlaying = async (page: Page) => {
	await openLibrary(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Play", exact: true })
		.click();
	await toggle(page).waitFor();
	await entrancesFinished(page);
};

test("the toggle comes to rest when motion is reduced", async ({ page }) => {
	await startPlaying(page);

	// Duration alone does not stop an infinite animation: it runs absurdly fast
	// and the element settles wherever the last cycle left it.
	const at = await shape(page);
	expect(at.scale).toBe("none");
	expect(at.rotate).toBe("none");
	expect(at.painted).toBeCloseTo(at.laidOut, 1);

	const frames = await overFrames(page, 8, boxOfToggle);
	expect(new Set(frames).size).toBe(1);
});

test.describe("with motion allowed", () => {
	test.use({ motion: "allow" });

	test("it really is animating, so the test above means something", async ({
		page,
	}) => {
		await startPlaying(page);

		const frames = await overFrames(page, 8, boxOfToggle);
		expect(new Set(frames).size).toBeGreaterThan(1);

		// A rotated square has a wider bounding box than the square itself -- but
		// the rotation passes through 0deg on every cycle, where the two are equal.
		// Read at one instant this asserts which phase the sample happened to land
		// on; over a span it asserts the rotation.
		const painted = await overFrames(page, 30, () => {
			const element = document.querySelector(
				'footer button[aria-label="Pause"]',
			) as HTMLElement;
			return {
				painted: Number(element.getBoundingClientRect().width.toFixed(2)),
				laidOut: element.offsetWidth,
			};
		});
		expect(
			painted.some((at) => at.painted > at.laidOut),
			"no sampled frame was wider than the button's own box",
		).toBe(true);
	});
});

test.describe("the now-playing arrow", () => {
	test.use({ motion: "allow" });

	const pill = (page: Page) =>
		page.getByRole("button", { name: "Now playing" });

	const arrowAndPill = () => {
		const arrow = document.querySelector('[data-visible="true"] svg');
		const pilled = document.querySelector('[data-visible="true"]');
		return {
			arrow: arrow ? getComputedStyle(arrow).transform : null,
			box: pilled ? pilled.getBoundingClientRect().top.toFixed(2) : null,
		};
	};

	// Played from the player's side rather than by clicking a row: the pill only
	// exists while the playing track is out of view, and clicking a row would
	// scroll it back in.
	const showPill = async (page: Page, player: FakePlayer) => {
		await openLibrary(page);
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
		player.playItem("p7", 40);
		await expect(statusBar(page)).toContainText("Goodnite, Noises Everywhere");

		// The follow is an animated scroll, so racing it means scrolling to the top
		// and being carried back. Scrolled from inside the poll rather than once
		// after a guessed wait: an animation still running at the guess carries the
		// view away again and the poll never converges.
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const scroller = document.querySelector("main") as HTMLElement;
					scroller.scrollTo(0, 0);
					await new Promise((settle) => setTimeout(settle, 120));
					return scroller.scrollTop;
				}),
			)
			.toBe(0);
		await expect(pill(page)).toBeVisible();
		// Sampling during the pill's entrance would measure the slide rather than
		// the arrow's nod.
		await entrancesFinished(page);
	};

	test("the arrow moves and the pill it sits in does not", async ({
		page,
		player,
	}) => {
		await showPill(page, player);
		const seen = await overFrames(page, 20, arrowAndPill);

		expect(
			seen.every((frame) => frame.arrow !== null && frame.box !== null),
			"the pill went missing part way through the sample",
		).toBe(true);

		const moved = new Set(seen.map((frame) => frame.arrow));
		expect(moved.size, "the arrow never moved").toBeGreaterThan(1);

		// Playwright will not click a box that is still moving, and neither will a
		// thumb, so the animation is on the icon rather than on the pill.
		const boxes = new Set(seen.map((frame) => frame.box));
		expect(boxes.size, `the pill moved through ${boxes.size} positions`).toBe(
			1,
		);
	});

	// Any easing on a two-stop keyframe brings the element to a dead stop at 0%,
	// 50% and 100%, and the eye reads the rest as two resting positions.
	test("it never holds still, and it leans rather than bounces", async ({
		page,
		player,
	}) => {
		await showPill(page, player);
		const seen = await overFrames(page, 48, arrowAndPill);
		// `matrix(a, b, c, d, tx, ty)` -- the vertical offset is the last of them.
		const ys = seen.map((frame) => {
			const matrix = frame.arrow?.match(/matrix\(([^)]*)\)/);
			if (!matrix)
				throw new Error("the arrow had no transform on a sampled frame");
			return Number(matrix[1].split(",")[5]);
		});
		const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));

		// A frame that moved less than this drew nothing new. A few are allowed for
		// the frame straddling each turnaround and for a stray long runner frame.
		const still = steps.filter((step) => step < 0.02).length;
		expect(
			still / steps.length,
			`${still} of ${steps.length} frames were still`,
		).toBeLessThan(0.1);

		// The arrow is 14px, so the lean has to stay small.
		const travel = Math.max(...ys) - Math.min(...ys);
		expect(travel).toBeLessThan(3);
	});

	test("it points the way it is pointing", async ({ page, player }) => {
		await showPill(page, player);

		await expect(pill(page)).toHaveAttribute("data-direction", "down");
		await expect(pill(page).locator("svg")).toBeVisible();
	});

	test("and it stops when the system says stop", async ({ page, player }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await showPill(page, player);
		const seen = await overFrames(page, 12, arrowAndPill);
		// A pill that stopped matching mid-sample answers null on every frame, and
		// a set of nulls has one member: the transform has to have been read.
		expect(seen.every((frame) => frame.arrow !== null)).toBe(true);
		expect(new Set(seen.map((frame) => frame.arrow)).size).toBe(1);
	});
});
