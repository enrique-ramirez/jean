import type { Page } from "./fixtures.ts";
import { expect, test } from "./fixtures.ts";

// `#/all` for anything shaped: `libraryShape` replaces the media library and the `#Jean Library`
// autoplaylist, and leaves the captured playlists alone -- so `p7` there is still the real five.
//
// The covers of a set, drawn as one picture. Everything here is counted in **albums**, never tracks:
// counted in tracks, a 21-track single-album playlist drew the same cover four times, and a two-album
// one drew four copies of the first while the second never appeared.

const mosaic = (page: Page) => page.locator("main header [data-tiles]");

const tiles = (page: Page) => mosaic(page).locator("[data-artwork]");

// The mosaic has answered for every cover it is going to draw.
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
			// Twenty-one tracks used to draw four tiles, all of them the same record.
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

	test.describe("an empty playlist", () => {
		test.use({ withoutPlaylists: true });

		test("draws a hold rather than an empty grid", async ({ page }) => {
			await page.goto("/");
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		});
	});
});

test.describe("one album, one cover", () => {
	test("the tiles are different records, not the same one repeated", async ({
		page,
	}) => {
		// The captured library: five albums, each with its own sleeve.
		await page.goto("/#/p7");
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
		await page.route("**/api/artwork/**", async (route) => {
			await new Promise((settle) => setTimeout(settle, 1500));
			await route.abort();
		});

		await page.goto("/#/p7");
		await expect(mosaic(page)).toBeVisible();

		// `Artwork`'s own placeholder is right for a single cover. Nine identical disc
		// icons in a grid reads as a fault rather than as covers on their way, so the
		// tiles stay hidden and one hold at the size of the whole thing stands in.
		await expect(mosaic(page)).not.toHaveAttribute("data-ready", "true");
		// One, not nine. `Artwork` draws its own hold with the same class, which is
		// what this replaces, so the mosaic's is named rather than found by class.
		await expect(mosaic(page).locator("[data-mosaic-hold]")).toHaveCount(1);

		// Mounted from the first frame -- that is what makes them load -- and hidden
		// until the last has answered, so the covers arrive together as one picture.
		const shown = await tiles(page)
			.first()
			.evaluate((tile) => getComputedStyle(tile).opacity);
		expect(Number(shown)).toBe(0);
	});
});
