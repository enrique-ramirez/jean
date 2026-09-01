import type { Page } from "./fixtures.ts";
import { expect, requestsTo, scrollTop, test, times } from "./fixtures.ts";

// Far enough down a library-sized playlist that getting there crosses thousands
// of rows. The view has never been near it, so nothing about these covers is
// already known.
const FAR = 25000;

// The covers on screen when the list stops moving, which is the number every
// assertion here is really about.
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

		// Following playback flies the list there, mounting and unmounting every row
		// in between. Native lazy loading counted each of those as visible and
		// started a request for it, so the covers for a screenful arrived behind
		// hundreds for rows nobody saw -- and so did everything else Jean asked the
		// player for, on the same handful of connections.
		await page.evaluate(
			(index: number) =>
				fetch(`/api/player/play/p7/${index}`, { method: "POST" }),
			FAR,
		);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(1_000_000);

		const rows = await settle(page);
		const asked = requestsTo(player, "artwork").length;

		// A little over one screenful is the honest bound: the destination is
		// measured rather than computed, so the list settles through a row or two.
		// Hundreds would mean the ones it flew past are being fetched as well.
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

		// Back over rows that have all been answered for once -- including the ones
		// with no cover at all, which is most of a real library and was most of the
		// traffic.
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

// The other half of the traffic, and a different question from the one above.
// That one is about *when* a cover is asked for; this is about how many covers
// there are. Artwork is addressed per row -- a playlist by index, the library by
// path -- so a record's tracks are one URL each for one picture and the browser
// has no way to know. There is no thumbnail to ask for either: the full image
// comes back whatever size it is drawn at.
test.describe("one cover per album, not per track", () => {
	test.use({ settings: { "jean.layout": "compact" } });

	// The captured fixture is 54 tracks in 12 albums, so the two numbers are far
	// enough apart that nothing ambiguous sits between them.
	const TRACKS = 54;
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
		// The bound is nearer the album count than the track count on purpose:
		// anything that drifts back towards one-per-row should fail here rather
		// than merely look worse.
		expect(
			asked,
			`${asked} requests for ${TRACKS} tracks in ${ALBUMS} albums`,
		).toBeLessThanOrEqual(ALBUMS + 3);
	});

	test("the rows of one album point at one URL", async ({ page }) => {
		await page.goto("/#/p7");
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await walkTheList(page);

		// The property rather than the count: covers on screen are far fewer than
		// rows on screen, because rows off the same record share a src. A count
		// alone would also pass if the covers simply had not loaded.
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
