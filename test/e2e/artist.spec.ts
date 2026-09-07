import {
	expect,
	expectPlayingFrom,
	openLibrary,
	playedFrom,
	scratchOf,
	test,
	trackPlayed,
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
			.poll(() => playedFrom(player)?.plref)
			.toBe(scratchOf(player)?.id);
		expect(trackPlayed(player)).toBeTruthy();
		await expectPlayingFrom(page, ARTIST);
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
