import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openNowPlaying,
	openSettings,
	settingsDialog,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// Nothing here calls MusicBrainz: it is a third party on the open internet, so
// turning the lookup on is only checked as far as the panel's own words.

const ARTIST_SWITCH = "Look up artists on MusicBrainz and Wikipedia";

const artistTab = (page: Page) =>
	page.getByRole("button", { name: "Artist", exact: true });

const openArtistTab = async (page: Page) => {
	await openNowPlaying(page);
	await artistTab(page).click();
};

const playSomething = async (page: Page) => {
	await page.goto("/#/p7");
	await expect(
		page.getByRole("heading", { level: 1, name: "Library" }),
	).toBeVisible();
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
};

test.describe("artist information", () => {
	test("is off by default, and the tab says so rather than looking broken", async ({
		page,
	}) => {
		await playSomething(page);
		await openArtistTab(page);

		await expect(page.getByText("Artist information is off.")).toBeVisible();
		await expect(page.getByText(/Settings . Artist information/)).toBeVisible();
	});

	test("asks nobody anything while it is off", async ({ page }) => {
		const outbound: string[] = [];
		page.on("request", (request) => {
			const url = request.url();
			if (/musicbrainz|wikipedia|wikidata/i.test(url)) outbound.push(url);
		});

		await playSomething(page);
		await openArtistTab(page);
		await expect(page.getByText("Artist information is off.")).toBeVisible();

		expect(outbound).toEqual([]);
	});

	test("the switch reports the state it is in, and keeps it", async ({
		page,
	}) => {
		await openSettings(page);

		const toggle = page.getByRole("switch", { name: ARTIST_SWITCH });
		await expect(toggle).toHaveAttribute("aria-checked", "false");

		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-checked", "true");

		// The dialog is state rather than a route, so a reload lands on the app
		// behind it and it has to be reopened.
		await page.reload();
		await openSettings(page);
		await expect(
			page.getByRole("switch", { name: ARTIST_SWITCH }),
		).toHaveAttribute("aria-checked", "true");
	});

	test("turning it on is what puts the panel in reach", async ({ page }) => {
		await playSomething(page);
		await openArtistTab(page);
		await expect(page.getByText("Artist information is off.")).toBeVisible();

		// The now-playing screen covers the top bar the gear lives in, so it has to
		// be dismissed before Settings can be opened.
		await page.getByRole("button", { name: "Close now playing" }).click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await openSettings(page);
		await page.getByRole("switch", { name: ARTIST_SWITCH }).click();
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		await openArtistTab(page);
		// Looking up or nothing found, depending on what the lookup can reach: only
		// the off state can be asserted against without calling a third party.
		await expect(page.getByText("Artist information is off.")).toBeHidden();
	});
});
