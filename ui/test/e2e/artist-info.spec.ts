import type { Route } from "@playwright/test";
import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	settingsDialog,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// Nothing here relies on MusicBrainz or Wikipedia answering: both are third
// parties on the open internet, so a case that needs an answer intercepts it.

const ARTIST_SWITCH = "Look up artists on MusicBrainz and Wikipedia";

const artistTab = (page: Page) =>
	page.getByRole("button", { name: "Artist", exact: true });

// The tab is in the gatefold's right leaf on a desktop and in the layer a phone
// opens from the Lyrics button. Both end on the same panel.
const openArtistTab = async (page: Page, isMobile: boolean) => {
	await openNowPlaying(page);
	if (isMobile)
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Lyrics" })
			.click();
	await artistTab(page).click();
};

const playSomething = async (page: Page) => {
	await openLibrary(page);
	await expect(
		page.getByRole("heading", { level: 1, name: "Library" }),
	).toBeVisible();
	await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
};

test.describe("artist information", () => {
	test("is off by default, and the tab says so rather than looking broken", async ({
		page,
		isMobile,
	}) => {
		await playSomething(page);
		await openArtistTab(page, isMobile);

		await expect(page.getByText("Artist information is off.")).toBeVisible();
		await expect(page.getByText(/Settings . Artist information/)).toBeVisible();
	});

	test("asks nobody anything while it is off", async ({ page, isMobile }) => {
		const outbound: string[] = [];
		page.on("request", (request) => {
			const url = request.url();
			if (/musicbrainz|wikipedia|wikidata/i.test(new URL(url).hostname))
				outbound.push(url);
		});

		await playSomething(page);
		await openArtistTab(page, isMobile);
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

	test("turning it on is what puts the panel in reach", async ({
		page,
		isMobile,
	}) => {
		await playSomething(page);
		await openArtistTab(page, isMobile);
		await expect(page.getByText("Artist information is off.")).toBeVisible();

		// The layer first on a phone, the screen next: both cover the top bar the
		// gear lives in, and Settings is where the switch is.
		if (isMobile)
			await page
				.getByRole("button", { name: "Close track information" })
				.click();
		await page.getByRole("button", { name: "Close now playing" }).click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await openSettings(page);
		await page.getByRole("switch", { name: ARTIST_SWITCH }).click();
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		await openArtistTab(page, isMobile);
		// Looking up or nothing found, depending on what the lookup can reach: only
		// the off state can be asserted against without calling a third party.
		await expect(page.getByText("Artist information is off.")).toBeHidden();
	});

	test.describe("with the lookup answered", () => {
		test.use({ settings: { "jean.artistInfo": true } });

		// Every third party is answered here rather than reached. The summary names
		// a script as its page, which is what a compromised or spoofed answer would
		// hand the link.
		const WIKIPEDIA_RELATION = {
			type: "wikipedia",
			url: { resource: "https://en.wikipedia.org/wiki/Babasonicos" },
		};

		const SCRIPT_FOR_A_PAGE = {
			extract: "An Argentine rock band.",
			content_urls: { desktop: { page: "javascript:alert(1)" } },
		};

		const answerTheLookup = async (
			page: Page,
			{
				artist = { relations: [WIKIPEDIA_RELATION] },
				summary = SCRIPT_FOR_A_PAGE,
			}: { artist?: Record<string, unknown>; summary?: unknown } = {},
		) => {
			const referrers: (string | null)[] = [];
			const answer = (body: unknown) => async (route: Route) => {
				referrers.push(await route.request().headerValue("referer"));
				await route.fulfill({ json: body });
			};

			await page.route(
				"https://musicbrainz.org/ws/2/artist?*",
				answer({ artists: [{ id: "mbid", name: "Babasónicos", score: 100 }] }),
			);
			await page.route(
				"https://musicbrainz.org/ws/2/artist/mbid?*",
				answer({ id: "mbid", name: "Babasónicos", ...artist }),
			);
			await page.route(
				"https://en.wikipedia.org/api/rest_v1/page/summary/*",
				answer(summary),
			);

			return referrers;
		};

		test("tells none of them where Jean is served from", async ({
			page,
			isMobile,
		}) => {
			const referrers = await answerTheLookup(page);

			await playSomething(page);
			await openArtistTab(page, isMobile);
			await expect(page.getByText("An Argentine rock band.")).toBeVisible();

			expect(referrers).toHaveLength(3);
			expect(referrers).toEqual([null, null, null]);
		});

		test("links out only over https", async ({ page, isMobile }) => {
			await answerTheLookup(page);

			await playSomething(page);
			await openArtistTab(page, isMobile);

			await expect(
				page.getByRole("link", { name: "Read more on Wikipedia" }),
			).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Babasonicos");
		});

		test("links out to Wikipedia and to no other host the summary names", async ({
			page,
			isMobile,
		}) => {
			await answerTheLookup(page, {
				summary: {
					extract: "An Argentine rock band.",
					content_urls: {
						desktop: { page: "https://wikipedia.example.org/wiki/Babasonicos" },
					},
				},
			});

			await playSomething(page);
			await openArtistTab(page, isMobile);

			await expect(
				page.getByRole("link", { name: "Read more on Wikipedia" }),
			).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Babasonicos");
		});

		// `decodeURIComponent` throws on a percent sign that begins no escape, and the throw read
		// as an artist MusicBrainz had never heard of.
		test("a Wikipedia address that cannot be decoded still leaves what MusicBrainz said", async ({
			page,
			isMobile,
		}) => {
			await answerTheLookup(page, {
				artist: {
					type: "Group",
					area: { name: "Argentina" },
					relations: [
						{
							type: "wikipedia",
							url: {
								resource: "https://en.wikipedia.org/wiki/100%_Babasonicos",
							},
						},
					],
				},
			});

			await playSomething(page);
			await openArtistTab(page, isMobile);

			await expect(page.getByText("Group · Argentina")).toBeVisible();
			await expect(
				page.getByRole("link", { name: "Read more on MusicBrainz" }),
			).toHaveAttribute("href", "https://musicbrainz.org/artist/mbid");
		});

		// An answer is drawn as it arrives, and React throws on a child that is an object: one
		// such field took the whole page with it.
		test("a field that is not text is left out, and the rest is drawn", async ({
			page,
			isMobile,
		}) => {
			await answerTheLookup(page, {
				artist: {
					type: { name: "Group" },
					area: { name: "Argentina" },
					"life-span": { begin: 1991 },
					relations: [WIKIPEDIA_RELATION],
				},
				summary: { extract: { html: "<p>An Argentine rock band.</p>" } },
			});

			await playSomething(page);
			await openArtistTab(page, isMobile);

			await expect(page.getByText("Argentina", { exact: true })).toBeVisible();
			await expect(
				page.getByRole("heading", { level: 2, name: "Babasónicos" }),
			).toBeVisible();
		});
	});
});
