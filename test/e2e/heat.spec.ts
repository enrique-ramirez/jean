import type { Page } from "./fixtures.ts";
import { expect, inSequence, openLibrary, test } from "./fixtures.ts";

const HOTTEST = 14; // 163 plays
const WARM = 12; // 107 plays, played this year
const COOL = 13; // 72 plays, last heard in 2024
const NEVER = 15; // never played, and the last-played field reads N/A
const RECENT = 0; // 108 plays, played yesterday

// Everything visible is derived in CSS from these two custom properties. The
// row is waited for rather than assumed: the virtualiser mounts what is near
// the viewport, and how much that is differs between the two projects.
const shading = async (page: Page, row: number) => {
	await expect(page.locator(`[data-row="${row}"]`)).toBeAttached();
	return page.evaluate((index: number) => {
		const element = document.querySelector(`[data-row="${index}"]`);
		if (!element) throw new Error(`no row ${index} on screen`);
		const style = getComputedStyle(element);
		return {
			heat: Number(style.getPropertyValue("--heat")),
			patina: Number(style.getPropertyValue("--patina")),
			washPainted: getComputedStyle(element, "::before").display !== "none",
		};
	}, row);
};

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
	});

	test("a track never played is not drawn as the oldest thing in the list", async ({
		page,
	}) => {
		// N/A in the last-played field is "no date", not "the beginning of time":
		// read as a date it would fade a never-played row further than anything
		// that was genuinely put down years ago.
		const [never, cool] = await Promise.all([
			shading(page, NEVER),
			shading(page, COOL),
		]);

		expect(never.patina).toBeLessThan(cool.patina);
	});

	test("the colour cools with the years since a track was last heard", async ({
		page,
	}) => {
		const [recent, cool] = await Promise.all([
			shading(page, RECENT),
			shading(page, COOL),
		]);

		expect(cool!.patina).toBeGreaterThan(recent!.patina);
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

		// The top of this list's own scale rather than a number: nothing in Rock en
		// Español is shaded more heavily than the track that leads it.
		const inPlaylist = await shading(page, 0);
		await inSequence([1, 2, 3, 4, 5], async (row: number) => {
			const other = await shading(page, row);
			expect(inPlaylist.heat, `row ${row} is hotter`).toBeGreaterThan(
				other.heat,
			);
		});

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
		await expect(
			page.getByRole("menuitemcheckbox", { name: "Artwork" }),
		).toBeVisible();
	});
});

// `TrackRow` exposes `--row-gutter` and the wash is derived from it rather than
// stated again: hardcoded, the two drift the moment a layout sets its own
// padding, and the wash stops sitting on the view's content line. Asserted by
// switching layout rather than by re-computing the stylesheet's own `calc()` in
// JavaScript, which would only be checking the browser against itself.
test.describe("the wash and the row gutter", () => {
	test.beforeEach(({ page }) => openWithEveryRow(page));

	const leadOf = (page: Page) =>
		page.evaluate(() => {
			const row = document.querySelector('[data-row="0"]') as HTMLElement;
			const wash = getComputedStyle(row, "::before");
			const box = row.getBoundingClientRect();
			const content = (
				row.firstElementChild as HTMLElement
			).getBoundingClientRect();
			return content.left - (box.left + Number.parseFloat(wash.left));
		});

	test("the content sits the same distance inside it in either layout", async ({
		page,
	}) => {
		const list = await leadOf(page);
		expect(list, "the wash starts on top of the row's content").toBeGreaterThan(
			0,
		);

		// The album layout's gutter is three times the list's.
		await page.getByRole("button", { name: "Albums", exact: true }).click();
		await expect(page.locator('[data-row="0"]')).toBeAttached();

		const albums = await leadOf(page);
		expect(
			Math.abs(albums - list),
			`the content sat ${Math.round(list)}px inside the wash as a list and ${Math.round(albums)}px as albums`,
		).toBeLessThan(1);
	});
});
