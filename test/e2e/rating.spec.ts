import type { Page } from "./fixtures.ts";
import { expect, inSequence, openLibrary, test, trackRow } from "./fixtures.ts";

// Every convention a rating tag turns up in, together, because that is what one
// folder tree holds: the field declares no scale, and four taggers disagree
// about what its numbers mean. This is the shape the column has to survive
// rather than a tidy 0-5 somebody designed for.
//
// No playback-statistics component, which is also what puts Rating on screen on
// a phone: the compact layout shows two optional columns and Rating is third in
// line behind Time and Plays. The column's own priority is columns.spec's
// business; this file is about what it draws.
const RATED = {
	withoutFields: ["%lastfm_play_count%"],
	retagged: {
		"Los Calientes": { "%rating%": "5" },
		Deléctrico: { "%rating%": "3.5" },
		"Soy Rock": { "%rating%": "3" },
		Pendejo: { "%rating%": "100" },
		"El Loco": { "%rating%": "80" },
		"La Fox": { "%rating%": "196" },
		Toxica: { "%rating%": "0" },
		Sagrado: { "%rating%": "-1" },
		Yegua: { "%rating%": "99999" },
		Rubi: { "%rating%": "good" },
	},
};

const stars = (page: Page, row: number) => trackRow(page, row).getByRole("img");

test.describe("reading a rating", () => {
	test.use(RATED);
	test.beforeEach(({ page }) => openLibrary(page));

	test("a whole rating on the native scale is that many stars", async ({
		page,
	}) => {
		await expect(stars(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(stars(page, 3)).toHaveAccessibleName("3 of 5 stars");
	});

	// The tag says 3.5, so the row says 3.5. Rounding it to 4 would be Jean
	// disagreeing with the player about what the library contains, which is the
	// one thing tag handling here is not allowed to do.
	test("a half rating stays a half", async ({ page }) => {
		await expect(stars(page, 2)).toHaveAccessibleName("3.5 of 5 stars");
	});

	// The scale is read off the magnitude, because the field declares none.
	// Calling a `100` unrated is not "Jean cannot tell", it is Jean ignoring a
	// rating that is plainly there.
	test("a 0-100 rating is rescaled rather than ignored", async ({ page }) => {
		await expect(stars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expect(stars(page, 5)).toHaveAccessibleName("4 of 5 stars");
	});

	// A POPM byte written out as text, on the thresholds Windows Explorer and
	// foobar2000 share. 196 is what Windows Media Player writes for four stars.
	test("a POPM byte reads as the stars its writer meant", async ({ page }) => {
		await expect(stars(page, 6)).toHaveAccessibleName("4 of 5 stars");
	});

	// `0` and `-1` are two taggers' spellings of "unrated" and neither is a bad
	// review. A number past every convention is not a rating at all, and is not
	// clamped to full marks: the field is being used for something else, and
	// inventing five stars would be the loudest possible way to be wrong.
	test("sentinels and nonsense read as unrated, not as a score", async ({
		page,
	}) => {
		await inSequence([7, 8, 9, 10], (row) =>
			expect(stars(page, row)).toHaveAccessibleName("Unrated"),
		);
	});
});

// A reversal: this used to assert the column was hidden. See
// `domain/track/CLAUDE.md`.
test.describe("a library with no ratings at all", () => {
	test.use({ withoutFields: ["%lastfm_play_count%"] });

	test("still gets the column, drawn quietly", async ({ page }) => {
		await openLibrary(page);
		await expect(trackRow(page, 0).getByRole("img")).toHaveAccessibleName(
			"Unrated",
		);
	});

	test("is offered in the columns menu like any other", async ({ page }) => {
		await openLibrary(page);
		await page.getByRole("button", { name: "View options" }).click();
		await expect(
			page.getByRole("menuitemcheckbox", { name: "Rating", exact: true }),
		).toBeVisible();
	});
});
