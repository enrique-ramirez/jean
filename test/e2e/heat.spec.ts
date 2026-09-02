import type { Page } from "./fixtures.ts";
import { expect, inSequence, openLibrary, test } from "./fixtures.ts";

// Facts about the captured library, which is why the fixture is what it is.
// Play counts run 0-186, so the scale has real range; Deja Entendu carries a
// never-played track among tracks played 150+ times, so the two ends of the
// scale sit side by side in one screenful; and Lafcadio was never played at all.
const HOTTEST = 14; // 163 plays
const WARM = 12; // 107 plays, played this year
const COOL = 13; // 72 plays, last heard in 2024
const NEVER = 15; // never played, and the last-played field reads N/A
const RECENT = 0; // 108 plays, played yesterday

// Both values are written onto the row as custom properties and everything
// visible is derived from them in CSS, so this is the shading itself rather
// than a proxy for it.
const shading = (page: Page, row: number) =>
	page.evaluate((index: number) => {
		const element = document.querySelector(`[data-row="${index}"]`);
		// Thrown rather than returned as null: every caller reads a field off this
		// straight away, so a missing row should say which one rather than fail as
		// "cannot read properties of null" one line later.
		if (!element) throw new Error(`no row ${index} on screen`);
		const style = getComputedStyle(element);
		return {
			heat: Number(style.getPropertyValue("--heat")),
			patina: Number(style.getPropertyValue("--patina")),
			washPainted: getComputedStyle(element, "::before").display !== "none",
		};
	}, row);

// Every row read below is inside the first screenful plus overscan, in both
// layouts and on both viewports, so none of these tests has to scroll -- but
// they do have to wait for the furthest one down to be mounted before reading
// it, which is more than opening the playlist promises.
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

		// Logarithmic, not linear: play counts are skewed hard enough that on a
		// linear scale one outlier takes the whole range and everything else sits
		// at the bottom, so a well-played track is most of the way up the scale
		// rather than the fraction of the ceiling it happens to be.
		expect(warm!.heat).toBeGreaterThan(0.8);
	});

	test("a track never played is flat, not faded", async ({ page }) => {
		const never = await shading(page, NEVER);

		// Patina says "you have not heard this in years", which would be a lie
		// about a track nobody has ever played. It stays plain instead.
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
		// The legend promises this in so many words: measured against the most
		// played track in *this* list, so it rescales when you open another one.
		// Los Calientes is the same track either way -- one of many in the library,
		// and the most played in Rock en Español.
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
		// The wash is gone, not merely transparent -- a row still carrying a heat
		// value it does not paint would look identical here and be wrong.
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
	// Unseeded, so this is genuinely a first run. Every other spec marks it as
	// already met, because otherwise the popover opens over the toolbar in tests
	// that never asked about it.
	test.use({ firstRun: true, settings: { "jean.settingsSeen": true } });

	const legend = (page: Page) =>
		page.getByRole("dialog").filter({ hasText: "Play-count shading" });

	test("once, on first sight, and then never again", async ({ page }) => {
		await openWithEveryRow(page);

		// Not a modal on first run: it introduces itself where it happens, anchored
		// to its own control, the first time the shading is actually on screen.
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
	// hangs from, so `right: 0` put its own left edge outside the window: the
	// title lost its first characters and the cool end of the scale it exists to
	// explain was off screen entirely.
	test("and fits inside the window it opens on", async ({ page }) => {
		await openWithEveryRow(page);
		await expect(legend(page)).toBeVisible();

		const box = await legend(page).boundingBox();
		const { width } = page.viewportSize()!;

		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);

		// Inside the window and still whole: a legend clipped to fit would satisfy
		// the arithmetic above and explain nothing. Both ends of the scale are the
		// two things a swatch cannot say, so both have to be readable.
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

		// Anywhere outside it counts, not just the button -- a thing you have to
		// acknowledge twice is worse than one you can wave away. The heading rather
		// than a track row because the popover is anchored under the flame and
		// physically covers the first rows, so clicking one of those is a click on
		// the legend.
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

		// A thing you can only be told once is a thing most people never learn.
		await page.getByRole("button", { name: "View options" }).click();
		await page
			.getByRole("menuitem", { name: "What the shading means" })
			.click();

		await expect(legend(page)).toBeVisible();
	});
});

test.describe("an install with no play counts", () => {
	// No playback-statistics component, so the field resolves to '?' on every row
	// exactly as it would on a real player. A bare install must get a coherent
	// app, not a dead control.
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

		// And the list is still a list.
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
		// The menu is open and still useful -- the explanation is the only thing
		// missing from it, not the menu itself. Column toggles are checkboxes
		// rather than plain items, which is why they are asked for by that role.
		await expect(
			page.getByRole("menuitemcheckbox", { name: "Artwork" }),
		).toBeVisible();
	});
});

// The wash is inset from the row's own gutter rather than from a number stated
// twice. Hardcoded, the two drift the moment a layout sets its own padding --
// album rows did, and the wash kept the list layout's inset, so it began inside
// the content and left the track number stranded outside the tint.
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

			// The layout gets to choose its own gutter -- that is the point of the
			// custom property -- so this asserts the relationship, not a number.
			expect(geometry.gutter).toBeGreaterThan(0);
			expect(geometry.lead).toBeGreaterThan(0);

			const expected = Math.max(0, geometry.gutter - geometry.lead);
			expect(geometry.washLeft).toBeCloseTo(expected, 1);
			expect(geometry.washRight).toBeCloseTo(expected, 1);
			expect(geometry.washTop).toBeCloseTo(2, 1);

			// The wash takes the content line and the row's text sits inside it.
			// Three things want that line and only two can have it.
			expect(geometry.washLeft).toBeLessThan(geometry.gutter);
		});
	});
});
