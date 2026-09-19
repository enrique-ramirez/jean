import type { Page } from "./fixtures.ts";
import { expect, openLibrary, test } from "./fixtures.ts";

// `#/all` for anything shaped: `libraryShape` replaces the media library and leaves the captured
// playlists alone, so `p7` there is still the real five.
//
// The covers of a set, drawn as one picture. Everything here is counted in **albums**, never tracks.

const mosaic = (page: Page) => page.locator("main header [data-tiles]");

const tiles = (page: Page) => mosaic(page).locator("[data-artwork]");

const drawn = async (page: Page) => {
	await expect(mosaic(page)).toBeVisible();
	await expect(mosaic(page)).toHaveAttribute("data-ready", "true");
};

const expectShape = async (page: Page, count: string, badge: string | null) => {
	await drawn(page);
	await expect(mosaic(page)).toHaveAttribute("data-tiles", count);
	if (badge === null) {
		await expect(mosaic(page).getByText(/album/)).toHaveCount(0);
	} else {
		await expect(mosaic(page).getByText(badge)).toBeVisible();
	}
};

test.describe("how many covers", () => {
	test.describe("one album", () => {
		test.use({ libraryShape: { tracks: 21, albums: 1 } });

		test("draws it once, and says nothing about a count", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, "1", null);
		});
	});

	test.describe("two albums", () => {
		test.use({ libraryShape: { tracks: 24, albums: 2 } });

		test("still draws one, and says how many there are", async ({ page }) => {
			await page.goto("/#/all");
			// One cover cannot stand for two, so the figure is what makes it honest.
			await expectShape(page, "1", "2 albums");
		});
	});

	test.describe("four albums", () => {
		test.use({ libraryShape: { tracks: 40, albums: 4 } });

		test("draws four, and the picture is the whole answer", async ({
			page,
		}) => {
			await page.goto("/#/all");
			await expectShape(page, "4", null);
		});
	});

	test.describe("five albums", () => {
		test.use({ libraryShape: { tracks: 50, albums: 5 } });

		test("draws four and says five", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, "4", "5 albums");
		});
	});

	test.describe("nine albums", () => {
		test.use({ libraryShape: { tracks: 90, albums: 9 } });

		test("draws nine, and again says nothing", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, "9", null);
		});
	});

	test.describe("more than nine", () => {
		test.use({ libraryShape: { tracks: 200, albums: 20 } });

		test("draws nine and says twenty", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, "9", "20 albums");
		});
	});

	test.describe("a library with nothing in it", () => {
		test.use({ libraryShape: { tracks: 0 } });

		test("draws a hold rather than an empty grid", async ({ page }) => {
			await page.goto("/#/all");
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

			// No grid at all, not a grid of one blank: there is no album to stand for
			// the set, so the header draws the same disc mark a single missing cover
			// gets, at the size of the whole picture.
			await expect(mosaic(page)).toHaveCount(0);
			const hold = page.locator("main header").locator("svg").first();
			await expect(hold).toBeVisible();
			const box = (await hold.boundingBox())!;
			expect(box.width).toBeGreaterThan(16);
		});
	});
});

test.describe("one album, one cover", () => {
	test("the tiles are different records, not the same one repeated", async ({
		page,
	}) => {
		await openLibrary(page);
		await drawn(page);

		const shown = await mosaic(page)
			.locator("img")
			.evaluateAll((images) =>
				(images as HTMLImageElement[]).map((image) => image.src),
			);

		expect(shown.length).toBeGreaterThan(1);
		// Identity is album artist and title, never the bytes: comparing pictures would
		// mean downloading them, which is the cost this avoids.
		expect(new Set(shown).size).toBe(shown.length);
	});
});

test.describe("while the covers are arriving", () => {
	test("it holds as one picture rather than as nine", async ({ page }) => {
		// Held open until the test lets go, rather than for a fixed number of
		// milliseconds the assertions below then race: everything here is about
		// what is on screen while the covers are still in flight, and a route that
		// answered part way through would end the state under test.
		let release = () => {};
		const inFlight = new Promise<void>((settle) => {
			release = settle;
		});
		await page.route("**/api/artwork**", async (route) => {
			await inFlight;
			await route.abort().catch(() => {});
		});

		try {
			await openLibrary(page);
			await expect(mosaic(page)).toBeVisible();

			// `Artwork`'s own placeholder is right for a single cover. Nine identical
			// disc icons in a grid reads as a fault rather than as covers on their
			// way, so the tiles stay hidden and one hold at the size of the whole
			// thing stands in.
			//
			// One, not nine. `Artwork` draws its own hold with the same class, which
			// is what this replaces, so the mosaic's is named rather than found by
			// class.
			const hold = mosaic(page).locator("[data-mosaic-hold]");
			await expect(hold).toHaveCount(1);
			await expect(mosaic(page)).not.toHaveAttribute("data-ready", "true");

			// Mounted from the first frame -- that is what makes them load -- and
			// hidden until the last has answered, so the covers arrive together as
			// one picture.
			const shown = await tiles(page)
				.first()
				.evaluate((tile) => getComputedStyle(tile).opacity);
			expect(Number(shown)).toBe(0);

			await expect(hold).toHaveCount(1);
			await expect(mosaic(page)).not.toHaveAttribute("data-ready", "true");
		} finally {
			release();
			await page.unroute("**/api/artwork**");
		}
	});
});
