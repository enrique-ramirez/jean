import type { Page } from "./fixtures.ts";
import { expect, inSequence, openLibrary, test, trackRow } from "./fixtures.ts";

// Every convention a rating tag turns up in: the field declares no scale, and
// taggers disagree about what its numbers mean.
//
// The compact layout draws two optional columns and Rating is last of the three,
// so the column set is pinned rather than left to whatever the player resolves.
const SHOWING_RATINGS = { "jean.columns": ["duration", "rating"] };

const RATED = {
	settings: SHOWING_RATINGS,
	// Writing off, so the stars stay the read-only control these read through.
	// `rating-writes.spec.ts` covers the writable one.
	fooJean: { allowedFields: [] },
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

	test("a half rating stays a half", async ({ page }) => {
		await expect(stars(page, 2)).toHaveAccessibleName("3.5 of 5 stars");
	});

	test("a 0-100 rating is rescaled rather than ignored", async ({ page }) => {
		await expect(stars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expect(stars(page, 5)).toHaveAccessibleName("4 of 5 stars");
	});

	test("a POPM byte reads as the stars its writer meant", async ({ page }) => {
		await expect(stars(page, 6)).toHaveAccessibleName("4 of 5 stars");
	});

	test("sentinels and nonsense read as unrated, not as a score", async ({
		page,
	}) => {
		await inSequence([7, 8, 9, 10], (row) =>
			expect(stars(page, row)).toHaveAccessibleName("Unrated"),
		);
	});
});

test.describe("a library with no ratings at all", () => {
	test.use({ settings: SHOWING_RATINGS, fooJean: { allowedFields: [] } });

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
