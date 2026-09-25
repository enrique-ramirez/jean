import {
	expect,
	expectPlayingFrom,
	openLibrary,
	playedFrom,
	scratchOf,
	test,
	trackPlayed,
	trackRow,
	viewHeader,
} from "./fixtures.ts";

const ARTIST = "Babasónicos";

const openArtist = async (
	page: Parameters<typeof openLibrary>[0],
	name: string,
) => {
	await openLibrary(page);
	await page.goto(`/#/artist/${encodeURIComponent(name)}`);
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

test.describe("an artist is a place", () => {
	test("the page is their records, newest first, with what you own of them", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);

		await expect(
			page.getByRole("heading", { name: "Discography" }),
		).toBeVisible();
		await expect(page.getByText("Jessico", { exact: true })).toBeVisible();
		await expect(page.getByText(/1 album\b/).first()).toBeVisible();
	});

	// The name reaches the hash as somebody tagged it, and a comma is the character the artist index
	// spends the most effort not treating as a separator.
	test("a name with punctuation in it survives the round trip", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.goto(`/#/artist/${encodeURIComponent("Blood, Sweat & Tears")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: "Blood, Sweat & Tears" }),
		).toBeVisible();
		// Nobody by that name here, and the page still says whose it is.
		await expect(
			page.getByText("Nothing by them in your library."),
		).toBeVisible();
	});

	test("a hash somebody hand-edited does not take the app down", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.goto("/#/artist/%E0%A4%A");
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("playing from the page plays through the artist, and says so", async ({
		page,
		player,
	}) => {
		await openArtist(page, ARTIST);
		// Scoped to the page: the transport in the status bar is also called Play.
		await page
			.locator("main")
			.getByRole("button", { name: "Play", exact: true })
			.click();

		await expect
			.poll(() => playedFrom(player)?.id)
			.toBe(scratchOf(player)?.guid);
		expect(trackPlayed(player)).toBeTruthy();
		await expectPlayingFrom(page, ARTIST);
	});

	test("p plays the artist from the overview, as the button does", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "p is a keyboard shortcut");

		await openArtist(page, ARTIST);
		await page.keyboard.press("p");

		await expect
			.poll(() => playedFrom(player))
			.toEqual({ id: scratchOf(player)?.guid, index: 0 });
		await expectPlayingFrom(page, ARTIST);
		expect(await page.evaluate(() => location.hash)).not.toContain("/tracks");
	});
});

test.describe("two views of one artist", () => {
	const tab = (page: Parameters<typeof openLibrary>[0], name: string) =>
		page.getByRole("navigation", { name: "Artist views" }).getByRole("button", {
			name,
		});

	test("the tracks tab is a place, not a toggle", async ({ page }) => {
		await openArtist(page, ARTIST);
		await tab(page, "Tracks").click();

		await expect(trackRow(page, 0)).toBeAttached();
		expect(await page.evaluate(() => location.hash)).toContain("/tracks");

		// A place survives a reload and comes back to the same view.
		await page.reload();
		await expect(trackRow(page, 0)).toBeAttached();
		await expect(tab(page, "Tracks")).toHaveAttribute("aria-current", "true");
	});

	test("it is the whole list view, scoped to them", async ({ page }) => {
		await openArtist(page, ARTIST);
		await tab(page, "Tracks").click();
		await expect(trackRow(page, 0)).toBeAttached();

		// The finder, the layout switch and the columns all come with it.
		await expect(page.getByText("Find in this artist")).toBeVisible();
		await expect(page.getByTitle("Albums")).toBeVisible();
	});

	// The compact header lays its areas out again, and a template that leaves the tab row out puts the
	// strip in a column of its own instead -- which takes the whole width off the name beside it.
	test("the strip is a row of its own, whatever the width", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);

		const header = viewHeader(page);
		const strip = header.getByRole("navigation", { name: "Artist views" });
		const name = header.getByRole("heading", { level: 1, name: ARTIST });

		const across = (await header.boundingBox())?.width ?? 0;
		expect((await strip.boundingBox())?.width).toBe(across);
		// Beside a fixed mosaic, so it cannot be most of the header -- but a title in a collapsed
		// column is a fraction of it, and that is the failure this catches.
		expect((await name.boundingBox())?.width).toBeGreaterThan(across / 2);
	});

	test("the brackets step between them and stop at either end", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);
		await page.locator("main").click({ position: { x: 20, y: 300 } });

		await page.keyboard.press("]");
		await expect(tab(page, "Tracks")).toHaveAttribute("aria-current", "true");
		await page.keyboard.press("]");
		await expect(tab(page, "Tracks")).toHaveAttribute("aria-current", "true");

		await page.keyboard.press("[");
		await expect(tab(page, "Overview")).toHaveAttribute("aria-current", "true");
	});

	test("choosing a record opens the tracks and lands on it", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);
		await page.locator("main").getByText("Jessico", { exact: true }).click();

		expect(await page.evaluate(() => location.hash)).toContain("/tracks");
		await expect(trackRow(page, 0)).toBeAttached();
	});
});

test.describe("a guest is not a member of the band", () => {
	test.use({
		retagged: { Bloodhail: { "%artist%": `Have a Nice Life feat. ${ARTIST}` } },
	});

	test("a feat. credit reaches the guest's page, kept apart from their own records", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);

		await expect(
			page.getByRole("heading", { name: "Appears on" }),
		).toBeVisible();
		await expect(page.getByText("Bloodhail")).toBeVisible();

		// And it is a guest spot, so it is not counted among their own albums.
		await expect(page.getByText("Jessico", { exact: true })).toBeVisible();
	});

	test("the lead of that credit keeps the track as their own", async ({
		page,
	}) => {
		await openArtist(page, "Have a Nice Life");
		await expect(page.getByRole("heading", { name: "Appears on" })).toHaveCount(
			0,
		);
	});
});
