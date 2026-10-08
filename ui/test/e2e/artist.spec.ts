import { albumRoute } from "../../src/domain/track/routes.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	openLibrary,
	playedFrom,
	playRequests,
	scratchOf,
	test,
	trackPlayed,
	trackRow,
	untilQuiet,
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

	test("on Dvorak, the key that types a slash finds rather than stepping back a tab", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");
		await openArtist(page, ARTIST);
		await tab(page, "Tracks").click();
		await expect(trackRow(page, 0)).toBeAttached();
		await page.locator("main").click({ position: { x: 20, y: 300 } });

		// Playwright types on US QWERTY only, so this is the event a browser sends for the key that
		// types `/` on Dvorak: the character, on the code QWERTY calls `[`.
		await page.evaluate(() =>
			document.activeElement?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "/",
					code: "BracketLeft",
					bubbles: true,
				}),
			),
		);

		await expect(
			page.getByRole("textbox", { name: "Find in this artist" }),
		).toBeFocused();
		await expect(tab(page, "Tracks")).toHaveAttribute("aria-current", "true");
	});

	test("a tab slides in from the side it was asked for, and a history step moves nothing", async ({
		page,
	}) => {
		const body = page.locator("main [data-direction]");
		await openArtist(page, ARTIST);

		await tab(page, "Tracks").click();
		await expect(trackRow(page, 0)).toBeAttached();
		await expect(body).toHaveAttribute("data-direction", "1");

		await page.goBack();
		await expect(tab(page, "Overview")).toHaveAttribute("aria-current", "true");
		await expect(body).toHaveAttribute("data-direction", "0");

		await page.goForward();
		await expect(tab(page, "Tracks")).toHaveAttribute("aria-current", "true");
		await expect(body).toHaveAttribute("data-direction", "0");
	});

	test("choosing a record opens its page, and nothing plays until a track is chosen", async ({
		page,
		player,
	}) => {
		await openArtist(page, ARTIST);
		await page
			.locator("main")
			.getByRole("link", { name: /Jessico/ })
			.click();

		await expect(
			page.getByRole("heading", { level: 1, name: "Jessico" }),
		).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe(
			`#/${albumRoute(ARTIST, "Jessico")}`,
		);
		await untilQuiet(player);
		expect(playRequests(player)).toEqual([]);
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

// Every streaming client leads an artist's page with a photograph. Jean has none and must not fake
// one: the page is a portrait of the collection, so the only pictures on it are sleeves the
// component serves. The lookup is answered the way Wikipedia really answers, with a portrait in the
// summary, since that is the picture a page would be tempted to lead with.
test.describe("the pictures on an artist's page", () => {
	test.use({ settings: { "jean.artistInfo": true } });

	const PORTRAIT =
		"https://upload.wikimedia.org/wikipedia/commons/portrait.jpg";

	const answerTheLookup = async (page: Page) => {
		await page.route("https://musicbrainz.org/ws/2/artist?*", (route) =>
			route.fulfill({
				json: { artists: [{ id: "mbid", name: ARTIST, score: 100 }] },
			}),
		);
		await page.route("https://musicbrainz.org/ws/2/artist/mbid?*", (route) =>
			route.fulfill({
				json: {
					id: "mbid",
					name: ARTIST,
					relations: [
						{
							type: "wikipedia",
							url: { resource: "https://en.wikipedia.org/wiki/Babasonicos" },
						},
					],
				},
			}),
		);
		await page.route(
			"https://en.wikipedia.org/api/rest_v1/page/summary/*",
			(route) =>
				route.fulfill({
					json: {
						extract: "An Argentine rock band.",
						thumbnail: { source: PORTRAIT, width: 320, height: 213 },
						originalimage: { source: PORTRAIT, width: 1200, height: 800 },
						content_urls: {
							desktop: { page: "https://en.wikipedia.org/wiki/Babasonicos" },
						},
					},
				}),
		);
		await page.route("https://upload.wikimedia.org/**", (route) =>
			route.fulfill({ status: 404 }),
		);
	};

	// The lookup's own answers are text. Anything else the page reaches for is a picture from
	// somewhere other than the component's covers, a bundled stock image included.
	const THE_LOOKUP =
		/^https:\/\/(musicbrainz\.org\/ws\/2\/|en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/|www\.wikidata\.org\/w\/rest\.php\/)/;

	// The tab's own icon, which the page rasterises for the favicon and never draws on the page.
	const TAB_ICON = "/favicon.svg";

	const picturesFromElsewhere = (page: Page, origin: string) => {
		const seen: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (url.origin === origin) {
				if (request.resourceType() !== "image") return;
				if (url.pathname.startsWith("/api/artwork")) return;
				if (url.pathname === TAB_ICON) return;
			} else if (THE_LOOKUP.test(request.url())) return;
			seen.push(request.url());
		});
		return seen;
	};

	// What each picture on the page is drawn from: the component's covers reach the page as the
	// blobs they were fetched into, so a `data:` image or an address is something else.
	const picturesDrawnFromElsewhere = (page: Page) =>
		page.locator("main").evaluate((root) => {
			const sources = Array.from(root.querySelectorAll("img"), (image) =>
				image.getAttribute("src"),
			).filter((src): src is string => Boolean(src));
			const backgrounds = Array.from(
				root.querySelectorAll("*"),
				(node) => getComputedStyle(node).backgroundImage,
			).filter((image) => image.includes("url("));
			return [
				...sources.filter(
					(src) =>
						!src.startsWith("blob:") &&
						!new URL(src, location.href).pathname.startsWith("/api/artwork"),
				),
				...backgrounds,
			];
		});

	test("are the records you own, and never a photograph of the artist", async ({
		page,
		player,
		baseURL,
	}) => {
		await answerTheLookup(page);
		const fetched = picturesFromElsewhere(page, new URL(baseURL ?? "").origin);

		await openArtist(page, ARTIST);
		await expect(page.getByText("An Argentine rock band.")).toBeVisible();
		await expect(
			page.locator("main").getByRole("link", { name: /Jessico/ }),
		).toBeVisible();
		await untilQuiet(player);

		expect(fetched).toEqual([]);
		expect(await picturesDrawnFromElsewhere(page)).toEqual([]);
		// And the sleeves are there, so the empty reads above are about a page that drew pictures.
		expect(
			await page.locator("main img").count(),
			"the page drew no covers at all",
		).toBeGreaterThan(0);
	});
});
