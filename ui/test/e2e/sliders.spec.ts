// The box Playwright hands back from boundingBox(), which it does not name.
type BoundingBox = { x: number; y: number; width: number; height: number };

import type { FakePlayer, Page } from "./fixtures.ts";
import {
	dragTo,
	expect,
	expectSettlesAt,
	openLibrary,
	statusBar,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";

const volume = (page: Page) => page.getByRole("slider", { name: "Volume" });
const seekBar = (page: Page) =>
	page.getByRole("slider", { name: "Playback position" });

const volumeButton = (page: Page) =>
	page.getByRole("button", { name: "Volume" });

// The status bar is a notice with neither control in it until the player's first
// snapshot lands, and the library it sits under is ready well before that. Read
// too early, a desktop run finds no fader and clicks for the popover button the
// wide layout never draws.
const showVolume = async (page: Page) => {
	await expect(volume(page).or(volumeButton(page)).first()).toBeVisible();
	if (await volume(page).count()) return;
	await volumeButton(page).click();
	await expect(volume(page)).toBeVisible();
};

const bodiesTo = (player: FakePlayer, route: string) =>
	player.requests
		.filter((entry) => entry.method === "POST" && entry.path === route)
		.map((entry) => entry.body ?? {});

const volumesSent = (player: FakePlayer) =>
	bodiesTo(player, "/api/volume")
		.map((body) => body.value)
		.filter((value) => value !== undefined);

test.describe("the volume slider", () => {
	test.skip(({ isMobile }) => isMobile, "dragging a fader is a mouse gesture");

	test.beforeEach(async ({ page }) => {
		await openLibrary(page);
		await showVolume(page);
	});

	const landsAt = async (page: Page, player: FakePlayer, fraction: number) => {
		const before = volumesSent(player).length;
		await dragTo(page, volume(page), fraction);
		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(before);
		return volumesSent(player).at(-1);
	};

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
		await page.request.post("/__control/latency", { data: { ms: 100 } });

		const MOVES = 40;
		await dragTo(page, volume(page), 0.6, MOVES);

		await expectSettlesAt(player, () => volumesSent(player).length > 0, true);
		const sent = volumesSent(player);

		expect(sent.length).toBeLessThan(MOVES / 2);

		expect(player.player.volume.value).toBe(sent.at(-1));
		expect(sent.at(-1)).toBeGreaterThan(-20);
		expect(sent.at(-1)).toBeLessThan(-5);
	});

	test("the reported value is a percentage of the fader, not of the decibels", async ({
		page,
	}) => {
		await dragTo(page, volume(page), 0.5);

		const reported = async () =>
			Number(await volume(page).getAttribute("aria-valuenow"));
		await expect.poll(reported).toBeGreaterThan(45);
		await expect.poll(reported).toBeLessThan(55);
	});
});

test.describe("the mute button", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"the phone keeps the mute button in the volume popover",
	);

	test("two presses before the first is drawn mute and then unmute", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		const mute = statusBar(page).getByRole("button", {
			name: "Mute",
			exact: true,
		});
		await expect(mute).toBeVisible();

		await mute.evaluate((button: HTMLElement) => {
			button.click();
			button.click();
		});

		await expectSettlesAt(player, () => bodiesTo(player, "/api/volume"), [
			{ muted: true },
			{ muted: false },
		]);
		expect(player.player.volume.isMuted).toBe(false);
		await expect(mute).toBeVisible();
	});
});

const LOS_CALIENTES_LENGTH = "4:37";

test.describe("what the seek bar tells a screen reader", () => {
	test("the position reads as elapsed and total time, not a count of seconds", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "true");

		await expect(seekBar(page)).toHaveAttribute(
			"aria-valuetext",
			new RegExp(`^\\d+:\\d\\d of ${LOS_CALIENTES_LENGTH}$`),
		);
	});
});

// A bar a few hundred pixels wide under a track a few minutes long moves a handful of pixels a
// second. Redrawn on every frame, it costs a render and two style writes sixty times a second for
// a movement nobody can see, for as long as anything plays.
test.describe("the seek bar while a track plays", () => {
	const WATCHED_MS = 2500;
	const HALF_A_DEVICE_PIXEL = 0.5;

	test("is redrawn only once it has somewhere to move", async ({ page }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "true");
		await expect(seekBar(page)).toHaveAttribute("aria-valuenow", "1");

		const fill = seekBar(page).locator("span").nth(1);
		await fill.evaluate((element: HTMLElement) => {
			const drawn: number[] = [];
			const read = () =>
				Number(/scaleX\(([^)]+)\)/.exec(element.style.transform)?.[1]);
			new MutationObserver(() => drawn.push(read())).observe(element, {
				attributes: true,
				attributeFilter: ["style"],
			});
			Object.assign(window, { seekBarDrawn: drawn });
		});

		await page.waitForTimeout(WATCHED_MS);

		const moves = await fill.evaluate((element: HTMLElement) => {
			const { seekBarDrawn } = window as unknown as { seekBarDrawn: number[] };
			const devicePixels =
				(element.parentElement as HTMLElement).getBoundingClientRect().width *
				window.devicePixelRatio;
			return seekBarDrawn
				.slice(1)
				.map((at, index) => Math.abs(at - seekBarDrawn[index]) * devicePixels);
		});

		expect(moves.length, "the bar never moved").toBeGreaterThan(2);
		expect(
			Math.min(...moves),
			`the bar was redrawn to move ${moves.map((move) => move.toFixed(3))} device pixels`,
		).toBeGreaterThanOrEqual(HALF_A_DEVICE_PIXEL);
	});
});

test.describe("the seek bar", () => {
	test.skip(({ isMobile }) => isMobile, "scrubbing is a mouse gesture");

	test("it is not seekable until something is playing", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		await dragTo(page, seekBar(page), 0.5, 10);

		await expectSettlesAt(
			player,
			() => bodiesTo(player, "/api/playback/seek"),
			[],
		);
		await expect(seekBar(page)).toHaveAttribute("aria-valuenow", "0");
	});

	test("scrubbing commits once, on release", async ({ page, player }) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "true");

		const positions = () =>
			bodiesTo(player, "/api/playback/seek")
				.map((body) => body.seconds)
				.filter((value) => value !== undefined);

		await dragTo(page, seekBar(page), 0.5, 30);

		// Los Calientes is 4:37, so halfway is a bit under two and a half minutes.
		await expectSettlesAt(player, () => positions().length, 1);
		const landed = positions()[0];
		expect(landed).toBeGreaterThan(125);
		expect(landed).toBeLessThan(155);
	});

	test("scrubbing leaves no selection dragging under the pointer", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(seekBar(page)).toHaveAttribute("data-seekable", "true");

		await dragTo(page, seekBar(page), 0.5, 10);

		expect(
			await page.evaluate(() => window.getSelection()?.isCollapsed ?? true),
		).toBe(true);
	});
});

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
			y: box.y + box.height * (1 - fraction),
		});

		await touchDrag(page, at(from), at(to), 12);
	};

	test("the target is big enough to aim at", async ({ page }) => {
		await openLibrary(page);
		await showVolume(page);

		// Just off the slider is the popover, which does not claim the gesture, so
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

		await expect
			.poll(
				async () =>
					Math.abs(
						Number(await volume(page).getAttribute("aria-valuenow")) - 25,
					),
				{
					message:
						"the fader did not follow the finger to the end of the swipe",
				},
			)
			.toBeLessThan(8);

		await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0);
	});
});
