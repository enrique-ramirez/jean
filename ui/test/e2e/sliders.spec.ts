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

	// DeaDBeeF's fader stops at -50 dB where foobar2000's runs to -100, and the loudness curve
	// approaches zero without reaching it. Mapped naively the bottom of the travel is 2^-5 of full
	// scale rather than nothing, so the thumb never reaches the end and a drag there springs back.
	test.describe("a player whose silence is -50 dB", () => {
		test.use({
			playerState: {
				volume: { type: "db", min: -50, max: 0, value: -50, isMuted: false },
			},
		});

		test("the bottom of the travel is the player's own silence", async ({
			page,
			player,
		}) => {
			await expect(volume(page)).toHaveAttribute("aria-valuenow", "0");

			await dragTo(page, volume(page), 0);
			await expect.poll(() => volumesSent(player).at(-1)).toBe(-50);

			await dragTo(page, volume(page), 1);
			await expect.poll(() => volumesSent(player).at(-1)).toBe(0);
		});
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
