import type { Page } from "./fixtures.ts";
import { expect, requestsTo, scrollTop, test, times } from "./fixtures.ts";

// Far enough down that getting there crosses thousands of rows the view has
// never been near.
const FAR = 25000;

// Rows on screen once the list has stopped moving.
const settle = async (page: Page) => {
	await page.waitForTimeout(1500);
	return page.locator('main [role="row"]').count();
};

test.describe("artwork loading", () => {
	test.use({ librarySize: 30441, motion: "allow" });

	test("a jump across the library asks for the covers it lands on, not the ones it passes", async ({
		page,
		player,
	}) => {
		await page.goto("/#/p7");
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		// Let the first screenful arrive, so what follows measures the jump rather
		// than the load.
		await expect
			.poll(() => requestsTo(player, "artwork").length)
			.toBeGreaterThan(0);
		await page.waitForTimeout(500);
		player.requests.length = 0;

		// Following playback flies the list there, mounting and unmounting every
		// row in between. Native lazy loading counts each of those as visible.
		await page.evaluate(
			(index: number) =>
				fetch(`/api/player/play/p7/${index}`, { method: "POST" }),
			FAR,
		);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(1_000_000);

		const rows = await settle(page);
		const asked = requestsTo(player, "artwork").length;

		// A little over one screenful: the destination is measured rather than
		// computed, so the list settles through a row or two on arrival.
		expect(
			asked,
			`${asked} artwork requests for ${rows} rows on screen`,
		).toBeLessThan(rows * 2);
	});

	test("a cover already answered for is not asked for again", async ({
		page,
		player,
	}) => {
		await page.goto("/#/p7");
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await expect
			.poll(() => requestsTo(player, "artwork").length)
			.toBeGreaterThan(0);
		await page.waitForTimeout(500);

		await page.evaluate(() =>
			(document.querySelector("main") as HTMLElement).scrollBy(0, 4000),
		);
		await settle(page);

		const seen = requestsTo(player, "artwork").length;
		player.requests.length = 0;

		// Back over rows that have all been answered for once, including the ones
		// with no cover at all.
		await page.evaluate(() =>
			(document.querySelector("main") as HTMLElement).scrollTo(0, 0),
		);
		await settle(page);

		const again = requestsTo(player, "artwork").length;
		expect(
			again,
			`${seen} covers on the way down, ${again} on the way back`,
		).toBe(0);
	});
});

// beefweb addresses artwork per row -- a playlist by index, the library by path
// -- so a record's tracks are one URL each for one picture and the browser has
// no way to know. There is no thumbnail endpoint: the full image comes back
// whatever size it is drawn at.
test.describe("one cover per album, not per track", () => {
	test.use({ settings: { "jean.layout": "compact" } });

	const TRACKS = 54; // the captured fixture, in 12 albums
	const ALBUMS = 12;

	const walkTheList = async (page: Page) => {
		await times(12, async () => {
			await page.evaluate(() =>
				(document.querySelector("main") as HTMLElement).scrollBy(0, 300),
			);
			// Past the queue's settle gate, or the rows go by without ever asking.
			await page.waitForTimeout(400);
		});
		await page.waitForTimeout(1500);
	};

	test("walking the whole list costs one request an album", async ({
		page,
		player,
	}) => {
		await page.goto("/#/p7");
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await walkTheList(page);

		const asked = requestsTo(player, "artwork").length;
		expect(
			asked,
			`${asked} requests for ${TRACKS} tracks in ${ALBUMS} albums`,
		).toBeLessThanOrEqual(ALBUMS + 3);
	});

	test("the rows of one album point at one URL", async ({ page }) => {
		await page.goto("/#/p7");
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await walkTheList(page);

		// Distinct srcs rather than a count of requests: a count alone would also
		// pass if the covers simply had not loaded.
		const { rows, covers } = await page.evaluate(() => {
			const drawn = [
				...document.querySelectorAll<HTMLImageElement>('main [role="row"] img'),
			];
			return {
				rows: drawn.length,
				covers: new Set(drawn.map((img) => img.src)).size,
			};
		});

		expect(rows).toBeGreaterThan(8);
		expect(covers, `${covers} covers across ${rows} rows`).toBeLessThan(
			rows / 2,
		);
	});
});
