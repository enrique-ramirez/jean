import type { Page } from "./fixtures.ts";
import { expect, test, viewHeader } from "./fixtures.ts";

// The autoplaylist fallback reads the same synthesised library -- the fixture
// replaces both sources -- so every one of these holds either way.

const heading = (page: Page) =>
	viewHeader(page).getByRole("heading", { level: 1 });

const door = (page: Page, id: string) =>
	viewHeader(page).locator(`[data-door="${id}"]`);

// The figure drawn under a given noun, or null when the header draws none.
// `textContent` rather than `innerText`: on a phone the tracks card is hidden by
// CSS, and what the header decided to draw is still the thing under test.
const figure = async (page: Page, noun: string) => {
	const label = viewHeader(page).getByText(new RegExp(`^${noun}s?$`));
	if ((await label.count()) === 0) return null;
	const count = await label
		.locator("xpath=preceding-sibling::span")
		.textContent();
	return (count ?? "").trim();
};

// The genre bars sit outside the header on purpose: see
// `features/home/CLAUDE.md`.
const genres = (page: Page) => page.getByRole("region", { name: "Genres" });

// The bars themselves. Scoped to the list, because the section's heading is a
// link too -- it opens the full index.
const genreBars = (page: Page) =>
	genres(page).getByRole("list").getByRole("link");

const settled = async (page: Page) => {
	await expect(heading(page)).toBeVisible();
	await expect(viewHeader(page).getByText("still counting")).toHaveCount(0);
};

test.describe("a folder of four songs", () => {
	test.use({
		libraryShape: { tracks: 4, albums: 1, artists: 1, genres: 1, seconds: 200 },
	});

	test("counts in the singular where the count is one", async ({ page }) => {
		await page.goto("/");
		await settled(page);

		expect(await figure(page, "track")).toBe("4");
		expect(await figure(page, "album")).toBe("1");
		expect(await figure(page, "artist")).toBe("1");
		await expect(
			viewHeader(page).getByText("album", { exact: true }),
		).toHaveCount(1);
		await expect(
			viewHeader(page).getByText("albums", { exact: true }),
		).toHaveCount(0);
	});

	test("measures 13 minutes in minutes, not in days", async ({ page }) => {
		await page.goto("/");
		await settled(page);

		await expect(heading(page)).toContainText("13 minutes");
		await expect(heading(page)).not.toContainText("day");
	});
});

test.describe("one artist on repeat", () => {
	test.use({
		libraryShape: {
			tracks: 400,
			albums: 12,
			artists: 1,
			genres: 1,
			seconds: 210,
		},
	});

	test("a library with no variety in it still describes itself", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		expect(await figure(page, "track")).toBe("400");
		expect(await figure(page, "album")).toBe("12");
		expect(await figure(page, "artist")).toBe("1");

		await expect(genreBars(page)).toHaveCount(1);
		await expect(genres(page)).toContainText("400");
	});
});

test.describe("a wide, varied library", () => {
	test.use({
		libraryShape: {
			tracks: 6000,
			albums: 500,
			artists: 300,
			genres: 40,
			seconds: 250,
			years: [1961, 2024],
		},
	});

	test("big numbers are grouped, and the span covers the whole range", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		expect(await figure(page, "track")).toBe("6,000");
		expect(await figure(page, "album")).toBe("500");
		expect(await figure(page, "artist")).toBe("300");
		await expect(viewHeader(page)).toContainText("1961");
		await expect(viewHeader(page)).toContainText("2024");
	});

	test("the tracks card goes on a phone and the other two stay", async ({
		page,
	}, testInfo) => {
		await page.goto("/");
		await settled(page);

		// The headline already carries the size of the library, so the tracks card
		// is the one a phone drops.
		const onPhone = testInfo.project.name === "mobile";
		await expect(door(page, "tracks")).toBeVisible({ visible: !onPhone });
		await expect(door(page, "albums")).toBeVisible();
		await expect(door(page, "artists")).toBeVisible();
	});

	test("the cards fit the screen, and never push the page sideways", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		const shape = await viewHeader(page)
			.locator('[data-door="albums"]')
			.evaluate((card) => {
				const row = card.parentElement as HTMLElement;
				const shown = [...row.children].filter(
					(child) => (child as HTMLElement).offsetParent !== null,
				);
				return {
					lines: new Set(
						shown.map((child) => Math.round(child.getBoundingClientRect().top)),
					).size,
					overflows: row.scrollWidth > row.clientWidth + 1,
					pushesDocument:
						document.documentElement.scrollWidth >
						document.documentElement.clientWidth,
				};
			});

		expect(shape.lines).toBe(1);
		expect(shape.overflows).toBe(false);
		expect(shape.pushesDocument).toBe(false);
	});

	test("only the biggest genres are drawn, however many there are", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		// Fourteen is a cap, not a count: a library with four genres draws four.
		await expect(genreBars(page)).toHaveCount(14);
	});
});

test.describe("a rip with no year tags", () => {
	test.use({
		libraryShape: { tracks: 60, albums: 6, omit: ["%year%"] },
	});

	test("says nothing about years rather than inventing a span", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		await expect(viewHeader(page)).not.toContainText("–");
		expect(await figure(page, "album")).toBe("6");
	});
});

test.describe("a library the player reports no durations for", () => {
	test.use({
		libraryShape: { tracks: 60, albums: 6, omit: ["%length_seconds%"] },
	});

	test("falls back to naming itself rather than claiming zero", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);

		// Something has to be the h1, so this is the one figure with a fallback
		// rather than an absence.
		await expect(heading(page)).toHaveText("Your library");
		expect(await figure(page, "track")).toBe("60");
	});
});

test.describe("a library with no album or genre tags at all", () => {
	test.use({
		libraryShape: { tracks: 40, omit: ["%album%", "%genre%"] },
	});

	test("draws the cards it can fill and no others", async ({ page }) => {
		await page.goto("/");
		await settled(page);

		expect(await figure(page, "track")).toBe("40");
		expect(await figure(page, "album")).toBeNull();
		expect(await figure(page, "artist")).toBeNull();
		await expect(genres(page)).toHaveCount(0);
	});

	test("the last card standing is drawn even on a phone", async ({ page }) => {
		await page.goto("/");
		await settled(page);

		// A phone drops the tracks card only when another can take its place, which
		// is `:not(:only-child)` rather than a branch.
		await expect(door(page, "tracks")).toBeVisible();
	});
});

test.describe("a fresh install with no playlists", () => {
	test.use({
		withoutPlaylists: true,
		libraryShape: { tracks: 40, albums: 4 },
	});

	test("the header counts music, never playlists", async ({ page }) => {
		test.skip(
			Boolean(process.env.JEAN_NO_LIBRARY_API),
			"without playlists there is no autoplaylist either, so the fallback has no library to read",
		);
		await page.goto("/");
		await settled(page);

		expect(await figure(page, "playlist")).toBeNull();
		expect(await figure(page, "track")).toBe("40");
	});
});

test.describe("a library two people tagged", () => {
	test.use({
		libraryShape: { tracks: 20, albums: 2, artists: 1, mixedCase: true },
	});

	test("one artist spelled two ways is counted once", async ({ page }) => {
		await page.goto("/");
		await settled(page);

		// `Artist 1` and `ARTIST  1` differ in case and in whitespace, which is the
		// drift `sameTagValue` absorbs.
		expect(await figure(page, "artist")).toBe("1");
		expect(await figure(page, "album")).toBe("2");
	});
});
