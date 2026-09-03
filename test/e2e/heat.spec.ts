import type { Page } from "./fixtures.ts";
import { expect, inSequence, openLibrary, test } from "./fixtures.ts";

const HOTTEST = 14; // 163 plays
const WARM = 12; // 107 plays, played this year
const COOL = 13; // 72 plays, last heard in 2024
const NEVER = 15; // never played, and the last-played field reads N/A
const RECENT = 0; // 108 plays, played yesterday

// Everything visible is derived in CSS from these two custom properties.
const shading = (page: Page, row: number) =>
	page.evaluate((index: number) => {
		const element = document.querySelector(`[data-row="${index}"]`);
		if (!element) throw new Error(`no row ${index} on screen`);
		const style = getComputedStyle(element);
		return {
			heat: Number(style.getPropertyValue("--heat")),
			patina: Number(style.getPropertyValue("--patina")),
			washPainted: getComputedStyle(element, "::before").display !== "none",
		};
	}, row);

// The virtualiser only mounts rows near the viewport, so the furthest row read
// below has to be waited for.
const openWithEveryRow = async (page: Page) => {
	await openLibrary(page);
	await expect(page.locator(`[data-row="${NEVER}"]`)).toBeAttached();
};

const flame = (page: Page) =>
	page.getByRole("button", { name: "Show play-count heat" });

test.describe("play-count shading", () => {
	test.beforeEach(({ page }) => openWithEveryRow(page));

	test("warmer rows are the ones played more", async ({ page }) => {
		const [hottest, warm, cool, never] = await Promise.all(
			[HOTTEST, WARM, COOL, NEVER].map((row) => shading(page, row)),
		);

		expect(hottest!.heat).toBeGreaterThan(warm!.heat);
		expect(warm!.heat).toBeGreaterThan(cool!.heat);
		expect(cool!.heat).toBeGreaterThan(never!.heat);

		// The scale is logarithmic: on a linear one the single outlier takes the
		// whole range and everything else sits at the bottom.
		expect(warm!.heat).toBeGreaterThan(0.8);
	});

	test("a track never played is flat, not faded", async ({ page }) => {
		const never = await shading(page, NEVER);

		expect(never!.heat).toBe(0);
		expect(never!.patina).toBe(0);
	});

	test("the colour cools with the years since a track was last heard", async ({
		page,
	}) => {
		const [recent, cool] = await Promise.all([
			shading(page, RECENT),
			shading(page, COOL),
		]);

		expect(recent!.patina).toBeLessThan(0.1);
		expect(cool!.patina).toBeGreaterThan(recent!.patina);
		expect(cool!.patina).toBeLessThanOrEqual(1);
	});

	test("the scale is per list, not per library", async ({ page }) => {
		// Los Calientes is one of many in the library, and the most played in Rock
		// en Español.
		const inLibrary = await shading(page, RECENT);

		await page.goto("/#/p5");
		await expect(
			page.getByRole("heading", { level: 1, name: "Rock en Español" }),
		).toBeVisible();
		await expect(page.locator('[data-row="0"]')).toBeAttached();

		const inPlaylist = await shading(page, 0);
		expect(inPlaylist.heat).toBeCloseTo(1, 5);
		expect(inLibrary.heat).toBeLessThan(inPlaylist.heat);
	});
});

test.describe("turning the shading off", () => {
	test.beforeEach(({ page }) => openWithEveryRow(page));

	test("the flame toggles it, and the rows stop being painted", async ({
		page,
	}) => {
		expect((await shading(page, HOTTEST)).washPainted).toBe(true);
		await expect(flame(page)).toHaveAttribute("aria-pressed", "true");

		await flame(page).click();

		await expect(flame(page)).toHaveAttribute("aria-pressed", "false");
		// Gone rather than transparent: a row carrying a heat value it does not
		// paint would look identical here.
		await expect
			.poll(async () => (await shading(page, HOTTEST)).washPainted)
			.toBe(false);

		await flame(page).click();
		await expect
			.poll(async () => (await shading(page, HOTTEST)).washPainted)
			.toBe(true);
	});

	test("h does the same from the keyboard", async ({ page }) => {
		test.skip(
			test.info().project.name === "mobile",
			"no keyboard on the phone",
		);

		await page.keyboard.press("h");
		await expect(flame(page)).toHaveAttribute("aria-pressed", "false");
		await expect
			.poll(async () => (await shading(page, HOTTEST)).washPainted)
			.toBe(false);

		await page.keyboard.press("h");
		await expect(flame(page)).toHaveAttribute("aria-pressed", "true");
	});

	test("the choice survives a reload", async ({ page }) => {
		await flame(page).click();
		await expect(flame(page)).toHaveAttribute("aria-pressed", "false");

		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();

		await expect(flame(page)).toHaveAttribute("aria-pressed", "false");
	});
});

test.describe("the shading introduces itself", () => {
	// Unseeded: every other spec marks the legend as already seen, so it does not
	// open over the toolbar.
	test.use({ firstRun: true, settings: { "jean.settingsSeen": true } });

	const legend = (page: Page) =>
		page.getByRole("dialog").filter({ hasText: "Play-count shading" });

	test("once, on first sight, and then never again", async ({ page }) => {
		await openWithEveryRow(page);

		await expect(legend(page)).toBeVisible();
		await expect(legend(page)).toContainText("never played");

		await legend(page).getByRole("button", { name: "Got it" }).click();
		await expect(legend(page)).toBeHidden();

		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
		await expect(legend(page)).toBeHidden();
	});

	// On a phone the legend is wider than the room to the left of the flame it
	// hangs from.
	test("and fits inside the window it opens on", async ({ page }) => {
		await openWithEveryRow(page);
		await expect(legend(page)).toBeVisible();

		const box = await legend(page).boundingBox();
		const { width } = page.viewportSize()!;

		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);

		// A legend clipped to fit would satisfy the arithmetic above, so both ends
		// of the scale have to be readable as well.
		await inSequence(["never played", "played most"], async (end) => {
			const label = await legend(page)
				.getByText(end, { exact: true })
				.boundingBox();
			expect(label!.x).toBeGreaterThanOrEqual(0);
			expect(label!.x + label!.width).toBeLessThanOrEqual(width);
		});
	});

	test("any click at all dismisses it for good", async ({ page }) => {
		await openWithEveryRow(page);
		await expect(legend(page)).toBeVisible();

		// The heading rather than a track row: the popover is anchored under the
		// flame and covers the first rows, so clicking one is a click on the legend.
		await page.getByRole("heading", { level: 1, name: "Library" }).click();
		await expect(legend(page)).toBeHidden();

		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
		await expect(legend(page)).toBeHidden();
	});

	test("and keeps a permanent home in view options", async ({ page }) => {
		await openWithEveryRow(page);
		await legend(page).getByRole("button", { name: "Got it" }).click();
		await expect(legend(page)).toBeHidden();

		await page.getByRole("button", { name: "View options" }).click();
		await page
			.getByRole("menuitem", { name: "What the shading means" })
			.click();

		await expect(legend(page)).toBeVisible();
	});
});

test.describe("an install with no play counts", () => {
	// No playback-statistics component, so the field resolves to '?' on every row,
	// exactly as it would on a real player.
	test.use({
		withoutFields: ["%lastfm_play_count%", "%lastfm_last_played%"],
		firstRun: true,
		settings: { "jean.settingsSeen": true },
	});

	test("has no flame, no legend, and no shading", async ({ page }) => {
		await openWithEveryRow(page);

		await expect(flame(page)).toHaveCount(0);
		await expect(page.getByRole("dialog")).toHaveCount(0);

		const row = await shading(page, HOTTEST);
		expect(row.heat).toBe(0);
		expect(row.patina).toBe(0);

		await expect(page.locator('[role="row"]').first()).toContainText(
			"Los Calientes",
		);
	});

	test("view options offers no explanation of a thing that is not there", async ({
		page,
	}) => {
		await openWithEveryRow(page);

		await page.getByRole("button", { name: "View options" }).click();
		await expect(
			page.getByRole("menuitem", { name: "What the shading means" }),
		).toHaveCount(0);
		// Column toggles are menuitemcheckbox rather than menuitem.
		await expect(
			page.getByRole("menuitemcheckbox", { name: "Artwork" }),
		).toBeVisible();
	});
});

["compact", "album"].forEach((layout) => {
	test.describe(`the wash follows the row gutter in ${layout} layout`, () => {
		test.use({ settings: { "jean.layout": layout } });

		test("its edge sits on the content line, whatever the gutter is", async ({
			page,
		}) => {
			await openWithEveryRow(page);

			const geometry = await page.evaluate((index: number) => {
				const row = document.querySelector(
					`[data-row="${index}"]`,
				) as HTMLElement;
				const style = getComputedStyle(row);
				const wash = getComputedStyle(row, "::before");
				const px = (value: string) => Number.parseFloat(value);
				return {
					gutter: px(style.getPropertyValue("--row-gutter")),
					lead: px(style.getPropertyValue("--heat-lead")),
					washLeft: px(wash.left),
					washRight: px(wash.right),
					washTop: px(wash.top),
				};
			}, HOTTEST);

			// Each layout chooses its own gutter, so this asserts the relationship
			// rather than a number.
			expect(geometry.gutter).toBeGreaterThan(0);
			expect(geometry.lead).toBeGreaterThan(0);

			const expected = Math.max(0, geometry.gutter - geometry.lead);
			expect(geometry.washLeft).toBeCloseTo(expected, 1);
			expect(geometry.washRight).toBeCloseTo(expected, 1);
			expect(geometry.washTop).toBeCloseTo(2, 1);

			expect(geometry.washLeft).toBeLessThan(geometry.gutter);
		});
	});
});
