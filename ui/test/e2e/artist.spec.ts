import { albumRoute, artistRoute } from "../../src/domain/track/routes.ts";
import { everyValueOf } from "../../src/shared/api/multiValue.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	coversFromTheComponent,
	expect,
	expectPlayingFrom,
	openLibrary,
	playedFrom,
	playRequests,
	revealSearch,
	scratchOf,
	searchField,
	test,
	trackPlayed,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import {
	expectPendingRowsPlayByPosition,
	expectTheSetAskedOnce,
	holdRows,
	latestAnswer,
	openHomeSettled,
	ordinalsOfSet,
	recordLibraryTraffic,
	untilRowsAreHeld,
} from "./libraryLists.ts";
import {
	ARTIST_ON_THREE_RECORDS,
	type ArtistAnswer as ArtistPage,
	expectTheFiguresOf,
	NOTHING_TO_SUM,
	THREE_RECORDS,
} from "./setFigures.ts";

const ARTIST = "Babasónicos";

const untilTheScratchIsFilled = (player: FakePlayer) =>
	expect
		.poll(() => scratchOf(player)?.guid, {
			message: "Jean never filled the scratch playlist",
		})
		.toBeDefined();

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
		// One album, so the figure line counts tracks and leaves the album count out. The tracks
		// figure first, so the absence is read off a line that has drawn.
		const figures = viewHeader(page).locator("p[data-figures]");
		await expect(figures.locator('span[data-figure="tracks"]')).toBeVisible();
		await expect(figures.locator('span[data-figure="albums"]')).toHaveCount(0);
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

		await untilTheScratchIsFilled(player);
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

		await untilTheScratchIsFilled(player);
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

// foobar2000 holds a shared credit as written, and `%artists%` splits it into its members. The
// component answers who an artist is from both, so a member is known before any row arrives.
test.describe("a shared credit split by its artists tag", () => {
	const SHARED = "Revelries & Henri Purnell";
	const MEMBER = "Revelries";
	const SEPARATOR = String.fromCharCode(31);

	test.use({
		retagged: {
			Bloodhail: {
				"%artist%": SHARED,
				[everyValueOf("artists")]: ["Revelries", "Henri Purnell"].join(
					SEPARATOR,
				),
			},
		},
	});

	interface Drawn {
		releasedAt: number | null;
		firstSeen: Record<string, number>;
	}

	const recordWhatIsDrawn = (page: Page) =>
		page.addInitScript(
			({ member, nothingBy, withOthers }) => {
				const drawn: Drawn = { releasedAt: null, firstSeen: {} };
				Reflect.set(window, "__drawn", drawn);
				const shows: Record<string, () => boolean> = {
					"an artist result": () =>
						[...document.querySelectorAll('[role="option"]')].some((option) =>
							(option.textContent ?? "").startsWith(member),
						),
					"nothing by them": () =>
						document.querySelector("main")?.textContent?.includes(nothingBy) ??
						false,
					"the records with others": () =>
						[...document.querySelectorAll("main h2")].some(
							(heading) => heading.textContent === withOthers,
						),
				};
				new MutationObserver(() => {
					for (const [name, isShown] of Object.entries(shows))
						if (!(name in drawn.firstSeen) && isShown())
							drawn.firstSeen[name] = performance.now();
				}).observe(document, {
					subtree: true,
					childList: true,
					characterData: true,
				});
			},
			{
				member: MEMBER,
				nothingBy: en["artist.nothingBy"],
				withOthers: en["artist.withOthers"],
			},
		);

	const markReleased = (page: Page) =>
		page.evaluate(() => {
			(Reflect.get(window, "__drawn") as Drawn).releasedAt = performance.now();
		});

	const releaseTheRows = async (page: Page) => {
		await markReleased(page);
		await holdRows(page, false);
	};

	const holdQuestions = (page: Page) =>
		page.request.post("/__control/holdQuestions", { data: { hold: true } });

	const releaseTheAnswer = async (page: Page) => {
		await markReleased(page);
		await page.request.post("/__control/holdQuestions", { data: {} });
	};

	const expectFirstDrawnOnceReleased = async (page: Page, name: string) => {
		const { releasedAt, firstSeen } = await page.evaluate(
			() => Reflect.get(window, "__drawn") as Drawn,
		);
		expect(firstSeen[name], `${name} was never drawn`).toBeDefined();
		expect(
			firstSeen[name],
			`${name} was drawn before the answer arrived`,
		).toBeGreaterThanOrEqual(releasedAt as number);
	};

	const busyWithin = (page: Page, scope: string) =>
		page.locator(`${scope}[aria-busy="true"], ${scope} [aria-busy="true"]`);

	const countRowsAnswers = (page: Page) => {
		let answered = 0;
		page.on("response", (response) => {
			if (
				new URL(response.url()).pathname === "/api/library/rows" &&
				response.status() === 200
			)
				answered += 1;
		});
		return () => answered;
	};

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		const busyArtists = (page: Page) =>
			page
				.getByRole("listbox")
				.getByRole("option")
				.filter({ hasText: /^Revelries/ })
				.and(page.locator('[aria-busy="true"], :has([aria-busy="true"])'));

		test("search shows the artist results at once, before any track row lands, none of them busy", async ({
			page,
			player,
		}) => {
			await recordWhatIsDrawn(page);
			await openHomeSettled(page, player);
			await revealSearch(page);
			await searchField(page).fill("revelries");

			const results = page.getByRole("listbox");
			await expect(
				results.getByRole("option").filter({ hasText: /^Revelries(?! &)/ }),
			).toBeVisible();
			await expect(busyArtists(page)).toHaveCount(0);

			await releaseTheRows(page);
			await expect(
				results.getByRole("option").filter({ hasText: "Bloodhail" }),
			).toBeVisible();
			const { releasedAt, firstSeen } = await page.evaluate(
				() => Reflect.get(window, "__drawn") as Drawn,
			);
			expect(
				firstSeen["an artist result"],
				"the artist result was drawn only once the rows arrived",
			).toBeLessThan(releasedAt as number);
		});

		interface DropdownStates {
			recording: boolean;
			states: { busy: boolean; artists: boolean }[];
		}

		const recordTheDropdown = (page: Page) =>
			page.addInitScript((member) => {
				const recorded: DropdownStates = { recording: false, states: [] };
				Reflect.set(window, "__dropdown", recorded);
				const isAnArtist = new RegExp(`^${member}(?! &)`);
				const look = () => {
					if (!recorded.recording) return;
					const results = document.querySelector('[role="listbox"]');
					const artists = [
						...(results?.querySelectorAll('[role="option"]') ?? []),
					].filter((option) => isAnArtist.test(option.textContent ?? ""));
					recorded.states.push({
						busy: artists.some(
							(option) =>
								option.matches('[aria-busy="true"]') ||
								option.querySelector('[aria-busy="true"]') !== null,
						),
						artists: artists.length > 0,
					});
				};
				Reflect.set(window, "__lookAtTheDropdown", look);
				new MutationObserver(look).observe(document, {
					subtree: true,
					childList: true,
					characterData: true,
					attributes: true,
					attributeFilter: ["aria-busy"],
				});
			}, MEMBER);

		test("the open dropdown never draws an artist busy, and keeps the artists drawn while the track rows land", async ({
			page,
			player,
		}) => {
			const rowsAnswers = countRowsAnswers(page);
			await recordTheDropdown(page);
			await openHomeSettled(page, player);
			await revealSearch(page);
			await page.evaluate(() => {
				(Reflect.get(window, "__dropdown") as DropdownStates).recording = true;
			});
			await searchField(page).fill("revelries");

			const artist = page
				.getByRole("listbox")
				.getByRole("option")
				.filter({ hasText: /^Revelries(?! &)/ });
			await expect(artist).toBeVisible();

			await holdRows(page, false);
			await expect.poll(rowsAnswers).toBeGreaterThan(0);
			await untilQuiet(player);
			await expect(artist).toBeVisible();

			const { states } = await page.evaluate(
				() => Reflect.get(window, "__dropdown") as DropdownStates,
			);
			expect(
				states.filter((state) => state.busy),
				"the dropdown drew an artist busy",
			).toEqual([]);
			expect(
				states
					.slice(states.findIndex((state) => state.artists))
					.filter((state) => !state.artists),
				"the artists went away once drawn",
			).toEqual([]);
		});

		const firstRow = (page: Page) =>
			trackRow(page, 0).evaluate((row) => {
				const main = row.closest("main") as HTMLElement;
				const box = row.getBoundingClientRect();
				const origin = main.getBoundingClientRect().top - main.scrollTop;
				return { top: box.top - origin, height: box.height };
			});

		test("the tracks tab's first row stays where it is, at its height, when its window lands", async ({
			page,
			player,
		}) => {
			await openHomeSettled(page, player);
			await page.goto(`/#/${artistRoute(MEMBER, "tracks")}`);
			await expect
				.poll(() => player.fooJean.rowsHeld.length, {
					message: "the tracks tab never asked for its rows",
				})
				.toBeGreaterThan(0);
			await expect(trackRow(page, 0)).toHaveAttribute("aria-busy", "true");
			const before = await firstRow(page);

			await holdRows(page, false);
			await expect(trackRow(page, 0)).toContainText("Bloodhail");
			const after = await firstRow(page);

			expect(
				Math.abs(after.top - before.top),
				`the first row stood at ${before.top}px and moved to ${after.top}px`,
			).toBeLessThan(0.5);
			expect(
				Math.abs(after.height - before.height),
				`the first row was ${before.height}px tall and became ${after.height}px`,
			).toBeLessThan(0.5);
		});
	});

	test("a member's page is busy until its answer arrives, and never says they have nothing here", async ({
		page,
	}) => {
		await recordWhatIsDrawn(page);
		await openLibrary(page);
		await holdQuestions(page);
		await page.goto(`/#/${artistRoute(MEMBER)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		const busy = busyWithin(page, "main");
		await expect(busy.first()).toBeAttached();

		await releaseTheAnswer(page);
		await expect(
			page.locator("main").getByRole("link", { name: /Deathconsciousness/ }),
		).toBeVisible();
		await expect(busy).toHaveCount(0);
		await expectFirstDrawnOnceReleased(page, "the records with others");
		const { firstSeen } = await page.evaluate(
			() => Reflect.get(window, "__drawn") as Drawn,
		);
		expect(firstSeen["nothing by them"]).toBeUndefined();
	});

	const LOADING = en["skeleton.loading"];

	const loadingsIn = (scope: ReturnType<typeof viewHeader>) =>
		scope.evaluate(
			(element, loading) =>
				(element.textContent ?? "").split(loading).length - 1,
			LOADING,
		);

	test("the header's placeholder is busy and says Loading once, until its answer arrives", async ({
		page,
	}) => {
		await recordWhatIsDrawn(page);
		await openLibrary(page);
		await holdQuestions(page);
		await page.goto(`/#/${artistRoute(MEMBER)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		const header = viewHeader(page);
		const busy = busyWithin(page, "main header");
		await expect(busy.first()).toBeAttached();
		expect(await loadingsIn(header)).toBe(1);

		await releaseTheAnswer(page);
		await expect(
			page.locator("main").getByRole("link", { name: /Deathconsciousness/ }),
		).toBeVisible();
		await expect(busy).toHaveCount(0);
		expect(await loadingsIn(header)).toBe(0);
	});
});

test.describe("the header's bottom edge", () => {
	// A line drawn across the header between its buttons and the strip, by a border or by a thin
	// element of its own. The strip's own top border sits on the strip and is not one.
	const rulesAbove = (page: Page, from: number, to: number) =>
		viewHeader(page).evaluate(
			(root, [top, bottom]) => {
				const across = root.getBoundingClientRect().width / 2;
				const lines: string[] = [];
				for (const element of root.querySelectorAll<HTMLElement>("*")) {
					if (element.closest("[data-backdrop]")) continue;
					const box = element.getBoundingClientRect();
					if (box.width < across) continue;
					const style = getComputedStyle(element);
					const drawn = (side: "Top" | "Bottom") =>
						Number.parseFloat(style[`border${side}Width`]) > 0 &&
						style[`border${side}Style`] !== "none" &&
						!/rgba\(.*, 0\)$|transparent/.test(style[`border${side}Color`]);
					const ys = [
						...(drawn("Top") ? [box.top] : []),
						...(drawn("Bottom") ? [box.bottom] : []),
						...(box.height <= 2 &&
						!/rgba\(.*, 0\)$|transparent/.test(style.backgroundColor)
							? [box.top]
							: []),
					];
					for (const y of ys)
						if (y > top && y < bottom)
							lines.push(
								`${element.tagName.toLowerCase()} at ${Math.round(y)}px`,
							);
				}
				return lines;
			},
			[from, to],
		);

	test("the tab strip is the header's bottom edge, over the backdrop, with no rule a gap above it", async ({
		page,
	}) => {
		await openArtist(page, ARTIST);
		const header = viewHeader(page);
		const backdrop = header.locator("[data-backdrop]");
		await expect(backdrop).toHaveAttribute("data-ready", "true");

		const strip = header.getByRole("navigation", { name: "Artist views" });
		const box = async (locator: typeof header) => {
			const found = await locator.boundingBox();
			if (!found) throw new Error("not drawn");
			return { ...found, bottom: found.y + found.height };
		};
		const edge = await box(header);
		const tabs = await box(strip);
		const behind = await box(backdrop);
		const shuffle = await box(header.getByRole("button", { name: "Shuffle" }));

		expect(Math.abs(tabs.bottom - edge.bottom)).toBeLessThanOrEqual(1);
		expect(behind.y).toBeLessThanOrEqual(tabs.y);
		expect(behind.bottom).toBeGreaterThanOrEqual(tabs.bottom - 1);
		expect(await rulesAbove(page, shuffle.bottom, tabs.y - 1)).toEqual([]);
	});
});

type ArtistAnswer = Record<
	"own" | "shared" | "guest",
	Parameters<typeof ordinalsOfSet>[0]
>;

// A guest spot on another band's record, so the artist's tracks are two sets apart in the library and
// the list is all three of theirs merged.
test.describe("the tracks tab's rows", () => {
	test.use({
		retagged: { Bloodhail: { "%artist%": `Have a Nice Life feat. ${ARTIST}` } },
	});

	const openTheTracks = async (page: Page) => {
		const answered = recordLibraryTraffic(page);
		await page.goto(`/#/${artistRoute(ARTIST, "tracks")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: ARTIST }),
		).toBeVisible();
		const answer = await latestAnswer<ArtistAnswer>(
			answered,
			"GET /api/library/artist",
		);
		const all = [
			...ordinalsOfSet(answer.own),
			...ordinalsOfSet(answer.shared),
			...ordinalsOfSet(answer.guest),
		].sort((a, b) => a - b);
		return { answered, answer, all };
	};

	test("are asked once, for their own, shared and guest tracks together, and nothing else of the library is read", async ({
		page,
		player,
	}) => {
		const { answered, answer, all } = await openTheTracks(page);
		expect(
			ordinalsOfSet(answer.guest).length,
			"the guest spot is not in the answer",
		).toBe(1);

		await expectTheSetAskedOnce(answered, player, all);
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(all.length),
		);
		await expect(trackRow(page, 0)).toContainText(
			String(player.ordinalOrder()[all[0]].track["%title%"]),
		);
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("draw as skeletons and play by their position in the artist's tracks", async ({
			page,
			player,
			isMobile,
		}) => {
			const { all } = await openTheTracks(page);
			await untilRowsAreHeld(player, all);

			await expectPendingRowsPlayByPosition(page, player, isMobile, all);
		});
	});
});

// The header and the records come from the artist answer, which computes them
// over the artist's tracks, with the rows and the whole library held so nothing is there to count.
test.describe("the overview, from the artist answer", () => {
	test.use({ retagged: THREE_RECORDS, fooJean: NOTHING_TO_SUM });

	const openTheOverview = async (page: Page) => {
		const answered = recordLibraryTraffic(page);
		await page.goto(`/#/${artistRoute(ARTIST_ON_THREE_RECORDS)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: ARTIST_ON_THREE_RECORDS }),
		).toBeVisible();
		return latestAnswer<ArtistPage>(answered, "GET /api/library/artist");
	};

	const recordsUnder = (page: Page, heading: string) =>
		page
			.locator("main section")
			.filter({
				has: page.getByRole("heading", {
					level: 2,
					name: heading,
					exact: true,
				}),
			})
			.getByRole("link");

	const trackCountOf = (count: number) =>
		`${count} ${count === 1 ? "track" : "tracks"}`;

	const expectTheRecords = async (
		page: Page,
		heading: string,
		records: ArtistPage["records"]["own"],
		showsCredit: boolean,
	) => {
		const links = recordsUnder(page, heading);
		await expect(links).toHaveCount(records.length);
		for (const [at, record] of records.entries()) {
			const link = links.nth(at);
			await expect(link, record.album).toContainText(record.album);
			await expect(link, record.album).toHaveAttribute(
				"href",
				`#/${albumRoute(record.artist, record.album)}`,
			);
			await expect(link, record.album).toContainText(String(record.year));
			await expect(link, record.album).toContainText(
				trackCountOf(record.trackCount),
			);
			if (showsCredit && record.artist)
				await expect(link, record.album).toContainText(record.artist);
		}
	};

	test("the header draws the answer's albums, tracks, duration and years", async ({
		page,
	}) => {
		const { figures, records } = await openTheOverview(page);
		expect(
			figures.albumCount,
			"the figures leave out the record shared with others",
		).toBe(records.own.length + records.shared.length);

		await expectTheFiguresOf(page, figures);
	});

	test("Discography is the answer's own records and With other artists its shared ones, each with its year and its tracks", async ({
		page,
		player,
	}) => {
		const { records } = await openTheOverview(page);
		expect(records.own.map((record) => record.year)).toEqual([2003, 1994]);
		expect(records.shared).toHaveLength(1);

		await expectTheRecords(page, en["artist.discography"], records.own, false);
		await expectTheRecords(page, en["artist.withOthers"], records.shared, true);

		await expect
			.poll(() => {
				const asked = new Set(coversFromTheComponent(player));
				return [...records.own, ...records.shared]
					.map((record) => record.cover)
					.filter((cover) => !asked.has(cover));
			})
			.toEqual([]);
	});
});
