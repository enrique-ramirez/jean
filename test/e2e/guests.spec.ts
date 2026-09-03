import type { Locator } from "./fixtures.ts";
import { expect, rowByTitle, scrollUntilMounted, test } from "./fixtures.ts";

// Jar Of Flies, retagged: the captured library has no featured artist on it and
// no compilation. 'No Excuses' and "Don't Follow" both name Mad Season -- on one
// it is a guest beside the album artist, on the other it is the artist.
const ALBUM_ARTIST = "Alice in Chains";

const GUESTS = "Nutshell";
const JOINED_BY_COMMA = "No Excuses";
const SOMEONE_ELSE = "Don't Follow";

const RETAGGED = {
	[GUESTS]: {
		"%artist%": `${ALBUM_ARTIST} feat. Ozzy Osbourne & Travis Scott`,
	},
	[JOINED_BY_COMMA]: { "%artist%": `${ALBUM_ARTIST}, Mad Season` },
	[SOMEONE_ELSE]: { "%artist%": "Mad Season" },
};

// data-inline is the shape the names cell took: one line with the guests beside
// the title, or two with the artist under it.
const names = (row: Locator) => row.locator("[data-inline]");
const inlineNames = (row: Locator) => row.locator('[data-inline="true"]');

test.describe("guests on an album row", () => {
	test.use({ retagged: RETAGGED, settings: { "jean.layout": "album" } });

	test("the guests sit beside the title and the album artist is not repeated", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, GUESTS));

		const row = rowByTitle(page, GUESTS);
		await expect(inlineNames(row)).toContainText(
			"feat. Ozzy Osbourne & Travis Scott",
		);

		await expect(names(row)).not.toContainText(ALBUM_ARTIST);
	});

	test("a comma-joined tag loses the comma, not the guest", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, JOINED_BY_COMMA));

		await expect(inlineNames(rowByTitle(page, JOINED_BY_COMMA))).toHaveText(
			`${JOINED_BY_COMMA}Mad Season`,
		);
	});

	test("an artist who is not the album's keeps a line of their own", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE));

		const row = rowByTitle(page, SOMEONE_ELSE);
		await expect(names(row)).toHaveAttribute("data-inline", "false");
		await expect(names(row)).toContainText("Mad Season");

		// The same two words as the row above, drawn differently: there they add to
		// the album artist, here they replace them.
		await expect(names(rowByTitle(page, JOINED_BY_COMMA))).toHaveAttribute(
			"data-inline",
			"true",
		);
	});

	test("a row with nothing to add says nothing", async ({ page }) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, "Rotten Apple"));

		const row = rowByTitle(page, "Rotten Apple");
		await expect(names(row)).toHaveAttribute("data-inline", "false");
		await expect(names(row)).toHaveText("Rotten Apple");
	});

	test("the title truncates last", async ({ page }) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, GUESTS));

		// A short title against a long guest list. The flexbox default shares the
		// shrink between them, which cuts 'Nutshell' to 'Nuts...' on a phone while
		// drawing most of the guests.
		const title = inlineNames(rowByTitle(page, GUESTS)).locator("span").first();
		await expect(title).toHaveText(GUESTS);

		const whole = await title.evaluate(
			(element: HTMLElement) => element.scrollWidth <= element.clientWidth,
		);
		expect(whole).toBe(true);
	});
});

// Outside a group there is no caption naming the album artist, so the row is
// the only thing that can.
test.describe("the same track in the list layout", () => {
	test.use({
		retagged: RETAGGED,
		settings: { "jean.layout": "compact" },
	});

	test("the artist is stated in full, under the title", async ({ page }) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, GUESTS));

		const row = rowByTitle(page, GUESTS);
		await expect(names(row)).toHaveAttribute("data-inline", "false");
		await expect(names(row)).toContainText(
			`${ALBUM_ARTIST} feat. Ozzy Osbourne & Travis Scott`,
		);
	});

	test("the album group is the only place a row is told about its album", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE));

		await expect(names(rowByTitle(page, SOMEONE_ELSE))).toContainText(
			"Mad Season",
		);
		await expect(page.locator('[data-inline="true"]')).toHaveCount(0);
	});
});

// A compilation gives every row a second line, and an album row sized for one
// leaves the two all but touching. The slack is half a pixel, so it is measured
// rather than looked at.
test.describe("an album row with two lines has room for them", () => {
	test.use({
		retagged: { [SOMEONE_ELSE]: { "%artist%": "Mad Season" } },
		settings: { "jean.layout": "album" },
	});

	test("it grows rather than crushing the two lines together", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE));

		const slack = await rowByTitle(page, SOMEONE_ELSE).evaluate(
			(row: HTMLElement) => {
				const cell = row.querySelector("[data-inline]");
				return (
					row.getBoundingClientRect().height -
					cell!.getBoundingClientRect().height
				);
			},
		);
		expect(slack).toBeGreaterThanOrEqual(6);

		// A one-line row stays at its usual 34px; only the two-line row grows.
		const single = await rowByTitle(page, "Rotten Apple").evaluate(
			(row: HTMLElement) => row.getBoundingClientRect().height,
		);
		expect(single).toBe(34);
	});
});
