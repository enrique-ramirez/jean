import type { FakePlayer, Page } from "./fixtures.ts";
import { expect, statusBar, test } from "./fixtures.ts";

// The play/pause toggle is the app's one piece of continuous motion: while
// something plays it layers `scale` and `rotate` on coprime durations, for as
// long as it plays. That is deliberate. What it must also do is stop when the
// operating system says stop.
const TOGGLE = 'footer button[aria-label="Pause"]';

const toggle = (page: Page) =>
	statusBar(page).getByRole("button", { name: "Pause" });

const shape = (page: Page) =>
	page.evaluate((selector: string) => {
		const element = document.querySelector(selector) as HTMLElement;
		const style = getComputedStyle(element);
		const box = element.getBoundingClientRect();
		// The painted box against the laid-out one. offsetWidth ignores transforms
		// and getBoundingClientRect does not, so the two agreeing means nothing is
		// being scaled or rotated -- without this test having to know how big the
		// button is, which differs by breakpoint.
		return {
			scale: style.scale,
			rotate: style.rotate,
			painted: Number(box!.width.toFixed(2)),
			laidOut: element.offsetWidth,
		};
	}, TOGGLE);

// Samples something once per frame, for a given number of frames. On a timer
// instead, a sample slower than a frame can land twice in the same place and
// prove nothing about motion running at hundreds of milliseconds a cycle.
//
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

const startPlaying = async (page: Page) => {
	await page.goto("/#/p7");
	await page
		.getByRole("main")
		.getByRole("button", { name: "Play", exact: true })
		.click();
	await toggle(page).waitFor();
	await page.waitForTimeout(400);
};

test("the toggle comes to rest when motion is reduced", async ({ page }) => {
	await startPlaying(page);

	// Duration alone does not stop an infinite animation -- it runs it absurdly
	// fast and the element settles wherever the last cycle left it, which left
	// the primary transport control permanently oversized and visibly tilted for
	// exactly the people who asked for less movement.
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
		// Without this the assertion above would pass just as happily against a
		// button that never moved in the first place.
		await startPlaying(page);

		const frames = await overFrames(page, 8, boxOfToggle);
		expect(new Set(frames).size).toBeGreaterThan(1);

		// And it is genuinely transformed, not merely repainting: a rotated square
		// has a wider bounding box than the square itself.
		const at = await shape(page);
		expect(at.painted).toBeGreaterThan(at.laidOut);
	});
});

// The other piece of continuous motion, and the one with a rule to obey: the
// pill is a button, and a button that will not hold still is a button you
// cannot click. So the arrow moves and the pill does not.
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

	// Played from the player's side rather than by clicking a row, then scrolled
	// back to the top: following playback would otherwise scroll the track we
	// just started straight back into view, and the pill only exists while it is
	// out of it.
	const showPill = async (page: Page, player: FakePlayer) => {
		await page.goto("/#/p7");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
		player.playItem("p7", 40);
		await expect(statusBar(page)).toContainText("Goodnite, Noises Everywhere");

		// Let the follow finish before scrolling away from it. It is an animated
		// scroll, so racing it means scrolling to the top and being carried back.
		await page.waitForTimeout(1000);
		await page.evaluate(() =>
			(document.querySelector("main") as HTMLElement).scrollTo(0, 0),
		);
		await expect
			.poll(() =>
				page.evaluate(
					() => (document.querySelector("main") as HTMLElement).scrollTop,
				),
			)
			.toBe(0);
		await expect(pill(page)).toBeVisible();
		// And let it finish arriving. The pill slides in over 240ms, so sampling
		// straight away measures its entrance rather than the arrow's nod -- which
		// would make the "the pill does not move" assertion fail on the one bit of
		// movement it is supposed to allow.
		await page.waitForTimeout(400);
	};

	test("the arrow moves and the pill it sits in does not", async ({
		page,
		player,
	}) => {
		await showPill(page, player);
		const seen = await overFrames(page, 20, arrowAndPill);

		const moved = new Set(seen.map((frame) => frame.arrow));
		expect(moved.size, "the arrow never moved").toBeGreaterThan(1);

		// The whole reason this is on the icon rather than on the pill. Playwright
		// will not click a box that is still moving, and neither will a thumb.
		const boxes = new Set(seen.map((frame) => frame.box));
		expect(boxes.size, `the pill moved through ${boxes.size} positions`).toBe(
			1,
		);
	});

	// The complaint this curve was rebuilt for: it read as two frames, up and
	// down, rather than as movement. Neither the frame rate nor sub-pixel
	// rasterisation was the cause -- it was that *any* easing on a two-stop
	// keyframe brings the element to a dead stop at 0%, 50% and 100%, and the eye
	// turns the rest into two resting positions.
	//
	// So the thing to assert is not that the arrow moves, which the old curve did
	// too and which the test above already covers. It is that it never stops.
	test("it never holds still, which is what made it look like two frames", async ({
		page,
		player,
	}) => {
		await showPill(page, player);
		const seen = await overFrames(page, 48, arrowAndPill);
		// `matrix(a, b, c, d, tx, ty)` -- the vertical offset is the last of them.
		// The pill is on screen for the whole sample, so every frame has a
		// transform; a frame without one is the test's premise failing rather than
		// a value to skip.
		const ys = seen.map((frame) => {
			const matrix = frame.arrow?.match(/matrix\(([^)]*)\)/);
			if (!matrix)
				throw new Error("the arrow had no transform on a sampled frame");
			return Number(matrix[1].split(",")[5]);
		});
		const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));

		// A frame that moved less than this is a frame that drew nothing new.
		// Allowing a few covers the one frame that straddles each turnaround, where
		// the arrow genuinely does reverse, and a stray long frame from the runner.
		const still = steps.filter((step) => step < 0.02).length;
		expect(
			still / steps.length,
			`${still} of ${steps.length} frames were still`,
		).toBeLessThan(0.1);

		// And it is a lean, not a bounce. Asserted because the cheap way to make
		// small motion read as motion is to make it bigger, and that is the one
		// direction this must not go: the arrow is 14px.
		const travel = Math.max(...ys) - Math.min(...ys);
		expect(travel).toBeLessThan(3);
	});

	test("it points the way it is pointing", async ({ page, player }) => {
		await showPill(page, player);

		// Playing track below, list scrolled to the top: the arrow points down, and
		// the pill is a way back rather than a decoration.
		await expect(pill(page)).toHaveAttribute("data-direction", "down");
		await expect(pill(page).locator("svg")).toBeVisible();
	});

	test("and it stops when the system says stop", async ({ page, player }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await showPill(page, player);
		const seen = await overFrames(page, 12, arrowAndPill);
		expect(new Set(seen.map((frame) => frame.arrow)).size).toBe(1);
	});
});
