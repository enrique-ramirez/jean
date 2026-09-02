import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openNowPlaying,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// The one switch in Jean that decides whether anything leaves the network, and
// the only claim on the settings screen that is about the user's privacy rather
// than about the player. It had no test at all.
//
// Nothing here lets a request out, and that is most of the point: the default is
// off, so the assertion is that the panel explains itself and the network stays
// quiet. Turning it on is checked as far as the panel's own words -- MusicBrainz
// is a third party on the open internet, and a suite that called it would be
// slow, flaky and rude in equal measure.

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
		// Naming the switch is the whole difference between an empty panel and one
		// a person can do something about.
		await expect(page.getByText(/Settings . Artist information/)).toBeVisible();
	});

	// The promise the default exists to make. A tab that has quietly gone and
	// asked MusicBrainz about this track while claiming to be off is the one
	// failure here that matters, and it is invisible from the screen.
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
		await page.goto("/#/settings");

		const toggle = page.getByRole("switch", { name: ARTIST_SWITCH });
		await expect(toggle).toHaveAttribute("aria-checked", "false");

		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-checked", "true");

		// A setting, so it survives the trip. A switch that only looked on would be
		// the same bug from the other side.
		await page.reload();
		await expect(
			page.getByRole("switch", { name: ARTIST_SWITCH }),
		).toHaveAttribute("aria-checked", "true");
	});

	test("turning it on is what puts the panel in reach", async ({ page }) => {
		await playSomething(page);
		await openArtistTab(page);
		await expect(page.getByText("Artist information is off.")).toBeVisible();

		await page.goto("/#/settings");
		// Gone, not merely leaving. The screen stays mounted for the length of its
		// exit, so `openNowPlaying` sees it as already open and the tab click lands
		// on the layer that is on its way out.
		await expect(nowPlayingScreen(page)).toBeHidden();

		await page.getByRole("switch", { name: ARTIST_SWITCH }).click();

		await openArtistTab(page);
		// Whatever it says next -- looking up, or nothing found, since the lookup
		// cannot reach anything from here -- it is no longer the off state, which
		// is the only part this can assert without calling a third party.
		await expect(page.getByText("Artist information is off.")).toBeHidden();
	});
});
