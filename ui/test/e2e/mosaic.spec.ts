import type { Page } from "./fixtures.ts";
import { expect, openLibrary, test, viewHeader } from "./fixtures.ts";

// `#/all` for anything shaped: `libraryShape` replaces the media library and leaves the captured
// playlists alone, so `p7` there is still the real five.
//
// The covers of a set, drawn behind its header. Everything here is counted in **albums**, never
// tracks.

const backdrop = (page: Page) => viewHeader(page).locator("[data-backdrop]");

const covers = (page: Page) => backdrop(page).locator("[data-artwork]");

const figureLine = (page: Page) => viewHeader(page).locator("p[data-figures]");

const albumCount = (page: Page) =>
	figureLine(page).locator('span[data-figure="albums"]');

const drawn = async (page: Page) => {
	await expect(backdrop(page)).toBeAttached();
	await expect(backdrop(page)).toHaveAttribute("data-ready", "true");
};

const standIns = (page: Page) =>
	viewHeader(page).evaluate((root) =>
		[...root.querySelectorAll("svg, img")]
			.filter(
				(element) =>
					!element.closest("button, a, [data-backdrop]") &&
					element.getBoundingClientRect().width > 0,
			)
			.map((element) => element.outerHTML.slice(0, 80)),
	);

// The lowest and highest opacity anything in the backdrop is drawn at, through every ancestor up to
// the backdrop, among the elements that paint a picture or a fill: an image, an icon, a box with a
// background colour. Nothing painted reads as [0, 0].
const paintedIn = (page: Page) =>
	backdrop(page).evaluate((layer) => {
		const opacityOf = (element: Element) => {
			let opacity = 1;
			for (
				let at: Element | null = element;
				at && at !== layer.parentElement;
				at = at.parentElement
			) {
				const style = getComputedStyle(at);
				if (style.visibility === "hidden" || style.display === "none") return 0;
				opacity *= Number(style.opacity);
			}
			return opacity;
		};
		const paints = (element: Element) =>
			element.matches("img, svg") ||
			!/rgba\(.*, 0\)$|transparent/.test(
				getComputedStyle(element).backgroundColor,
			);
		const seen = [...layer.querySelectorAll("*")]
			.filter(
				(element) =>
					paints(element) && element.getBoundingClientRect().width > 0,
			)
			.map(opacityOf);
		return seen.length === 0 ? [0, 0] : [Math.min(...seen), Math.max(...seen)];
	});

const DESKTOP_FLOOR_PX = 320;
const PHONE_FLOOR_PX = 260;

// A generated track has no sleeve in the fake, and a set none of whose covers answers draws no
// backdrop at all. Each album gets one of the fake's five sleeves, the same for every track of it;
// `libraryOfShape` puts track `n` on album `n % albums`.
const SLEEVES = [
	"deja-entendu.jpg",
	"jessico.jpg",
	"jar-of-flies.jpg",
	"deathconsciousness.jpg",
	"lafcadio.jpg",
];

const withSleeves = (tracks: number, albums: number) => ({
	libraryShape: { tracks, albums },
	embeddedArt: Object.fromEntries(
		Array.from({ length: tracks }, (_, index) => [
			`Track ${index + 1}`,
			SLEEVES[(index % albums) % SLEEVES.length],
		]),
	),
});

const expectShape = async (
	page: Page,
	count: number,
	albums: string | null,
) => {
	await drawn(page);
	await expect(covers(page)).toHaveCount(count);
	await expect(
		figureLine(page).locator('span[data-figure="tracks"]'),
	).toBeVisible();
	if (albums === null) await expect(albumCount(page)).toHaveCount(0);
	else await expect(albumCount(page)).toHaveText(albums);
};

test.describe("how many covers", () => {
	test.describe("one album", () => {
		test.use(withSleeves(21, 1));

		test("draws it once, and the figures say nothing about a count", async ({
			page,
		}) => {
			await page.goto("/#/all");
			await expectShape(page, 1, null);
		});
	});

	test.describe("two albums", () => {
		test.use(withSleeves(24, 2));

		test("still draws one, and the figures say how many there are", async ({
			page,
		}) => {
			await page.goto("/#/all");
			// One cover cannot stand for two, so the figure is what makes it honest.
			await expectShape(page, 1, "2 albums");
		});
	});

	test.describe("four albums", () => {
		test.use(withSleeves(40, 4));

		test("draws four, and the figures count four", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, 4, "4 albums");
		});
	});

	test.describe("five albums", () => {
		test.use(withSleeves(50, 5));

		test("draws four and the figures say five", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, 4, "5 albums");
		});
	});

	test.describe("nine albums", () => {
		test.use(withSleeves(90, 9));

		test("draws nine, and the figures count nine", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, 9, "9 albums");
		});
	});

	test.describe("more than nine", () => {
		test.use(withSleeves(200, 20));

		test("draws nine and the figures say twenty", async ({ page }) => {
			await page.goto("/#/all");
			await expectShape(page, 9, "20 albums");
		});
	});

	test.describe("a library with nothing in it", () => {
		test.use({ libraryShape: { tracks: 0 } });

		test("draws no backdrop and nothing in its place, at the height of a header with covers", async ({
			page,
			isMobile,
		}) => {
			// The captured playlists survive an empty media library, so `Library` is a header with
			// covers on the same page and the same screen.
			await openLibrary(page);
			await drawn(page);
			const withCovers = (await viewHeader(page).boundingBox())?.height ?? 0;

			await page.goto("/#/all");
			await expect(
				page.getByRole("heading", { level: 1, name: "All music" }),
			).toBeVisible();
			await expect(
				figureLine(page).locator('span[data-figure="tracks"]'),
			).toBeVisible();

			// No backdrop at all, not one of a blank: there is no album to stand for the set, and the
			// disc mark a single missing cover gets would be a picture of nothing.
			await expect(backdrop(page)).toHaveCount(0);
			expect(await standIns(page)).toEqual([]);

			const height = (await viewHeader(page).boundingBox())?.height ?? 0;
			expect(height).toBeCloseTo(withCovers, 0);
			expect(height).toBeGreaterThanOrEqual(
				isMobile ? PHONE_FLOOR_PX : DESKTOP_FLOOR_PX,
			);
		});
	});
});

test.describe("one album, one cover", () => {
	test("the backdrop's covers are different records, not the same one repeated", async ({
		page,
	}) => {
		await openLibrary(page);
		await drawn(page);

		const shown = await backdrop(page)
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
	test("nothing stands in for them and nothing is revealed", async ({
		page,
	}) => {
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

			// Mounted from the first frame, since that is what makes the covers load, and drawn at
			// nothing until the last has answered. `Artwork`'s own placeholder and its sunken fill are
			// right for a single sleeve; behind a header they read as a fault rather than as covers on
			// their way, so neither may show, and nothing else stands in either.
			await expect(backdrop(page)).toBeAttached();
			await expect(covers(page).first()).toBeAttached();
			await expect(backdrop(page)).not.toHaveAttribute("data-ready", "true");
			expect(await paintedIn(page)).toEqual([0, 0]);
			expect(await standIns(page)).toEqual([]);

			await expect(backdrop(page)).not.toHaveAttribute("data-ready", "true");
			expect(await paintedIn(page)).toEqual([0, 0]);
		} finally {
			release();
			await page.unroute("**/api/artwork**");
		}
	});
});
