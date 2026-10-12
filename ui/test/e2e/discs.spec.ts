import type { Locator, Page } from "./fixtures.ts";
import { expect, openLibrary, rowByTitle, test } from "./fixtures.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// Deathconsciousness is the fixture's two-disc album and the last one in the
// Library, so everything here scrolls to the end first. Both discs number their
// tracks from 01, so a track number alone cannot tell them apart.
const DISC_ONE = "A Quick One Before The Eternal Worm Devours Connecticut";
const DISC_TWO = "Waiting For Black Metal Records To Come In The Mail";

// Jar Of Flies is the fixture's single-disc album.
const SINGLE_DISC_ALBUM = "Jar Of Flies";
const SINGLE_DISC_TRACK = "Nutshell";

const trackNumberOf = (row: Locator) => row.locator(":scope > span").first();

const heading = (page: Page, name: string) =>
	page.getByRole("heading", { level: 3, name });

test.describe("a multi-disc album in the album layout", () => {
	test.use({ settings: { "jean.layout": "album" } });

	test("the discs are headed inside one album, not split into two", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(heading(page, "Disc 1")).toBeVisible();
		await expect(heading(page, "Disc 2")).toBeVisible();

		const album = page
			.locator("section")
			.filter({ hasText: "Deathconsciousness" });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(2);
	});

	test("the numbers stay bare, because the heading already said it", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("01");
	});

	test("an ordinary album is not headed at all", async ({ page }) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK));

		const album = page
			.locator("section")
			.filter({ hasText: SINGLE_DISC_ALBUM });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(0);
	});
});

test.describe("a multi-disc album in the list layout", () => {
	test.use({ settings: { "jean.layout": "compact" } });

	test("the track number carries the disc, since nothing else can", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(trackNumberOf(rowByTitle(page, DISC_ONE))).toHaveText("1.01");
		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("2.01");
	});

	test("the number fits its column rather than running into what follows", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_ONE));

		// Four characters where the column was drawn for two.
		const fits = await rowByTitle(page, DISC_ONE).evaluate(
			(row: HTMLElement) => {
				const cell = row.firstElementChild;
				return cell!.scrollWidth <= cell!.clientWidth;
			},
		);
		expect(fits).toBe(true);
	});

	test("a single-disc album keeps a plain number", async ({ page }) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK));

		await expect(trackNumberOf(rowByTitle(page, SINGLE_DISC_TRACK))).toHaveText(
			"02",
		);
	});
});

// %discnumber% is a tag like any other, and plenty of libraries never wrote it.
// Split by layout rather than looped: only the album layout can draw a disc
// heading, and only the compact one can prefix a number, so one body would
// carry a live assertion and a dead one in each pass.
test.describe("a library with no disc tags, in the album layout", () => {
	test.use({
		withoutFields: ["%discnumber%"],
		settings: { "jean.layout": "album" },
	});

	test("the album is not headed into discs it was never told about", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		const album = page
			.locator("section")
			.filter({ hasText: "Deathconsciousness" });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(0);
	});
});

test.describe("a library with no disc tags, in the list layout", () => {
	test.use({
		withoutFields: ["%discnumber%"],
		settings: { "jean.layout": "compact" },
	});

	test("the number stays bare rather than being prefixed with a guess", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		// Both discs number from 01, and with the tag gone there is nothing to tell
		// them apart with: "2.01" here would be invented.
		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("01");
		await expect(trackNumberOf(rowByTitle(page, DISC_ONE))).toHaveText("01");
	});
});
