import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { albumRoute, artistRoute } from "../../src/domain/track/routes.ts";
import { everyValueOf } from "../../src/shared/api/multiValue.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	openLibrary,
	playedFrom,
	playRequests,
	requestsTo,
	revealSearch,
	runClockFor,
	scratchOf,
	searchField,
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

// foobar2000 holds a shared credit as written; the per-artist tags that split it arrive in the library's second part.
test.describe("before the credit columns arrive", () => {
	const LATE = [
		FIELD.codec,
		FIELD.bitrate,
		FIELD.added,
		FIELD.artists,
		FIELD.artistIds,
		FIELD.albumArtists,
		FIELD.albumArtistIds,
	].map((field) => TRACK_EXPRESSIONS[field]);

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
		fooJean: { holdSubset: LATE },
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

	const releaseTheLatePart = async (page: Page) => {
		await page.evaluate(() => {
			(Reflect.get(window, "__drawn") as Drawn).releasedAt = performance.now();
		});
		await page.request.post("/__control/holdSubset", { data: {} });
	};

	const expectFirstDrawnOnceReleased = async (page: Page, name: string) => {
		const { releasedAt, firstSeen } = await page.evaluate(
			() => Reflect.get(window, "__drawn") as Drawn,
		);
		expect(firstSeen[name], `${name} was never drawn`).toBeDefined();
		expect(
			firstSeen[name],
			`${name} was drawn before the credit columns arrived`,
		).toBeGreaterThanOrEqual(releasedAt as number);
	};

	const busyWithin = (page: Page, scope: string) =>
		page.locator(`${scope}[aria-busy="true"], ${scope} [aria-busy="true"]`);

	test("search shows the tracks it found and holds the artist results until the credits are split", async ({
		page,
	}) => {
		await recordWhatIsDrawn(page);
		await openLibrary(page);
		await revealSearch(page);
		await searchField(page).fill("revelries");

		const results = page.getByRole("listbox");
		const busy = busyWithin(page, '[role="listbox"]');
		await expect(
			results.getByRole("option").filter({ hasText: "Bloodhail" }),
		).toBeVisible();
		await expect(busy.first()).toBeAttached();

		await releaseTheLatePart(page);
		await expect(
			results.getByRole("option").filter({ hasText: /^Revelries(?! &)/ }),
		).toBeVisible();
		await expect(busy).toHaveCount(0);
		await expectFirstDrawnOnceReleased(page, "an artist result");
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
				recorded.states.push({
					busy: results?.querySelector('[aria-busy="true"]') != null,
					artists: [
						...(results?.querySelectorAll('[role="option"]') ?? []),
					].some((option) => isAnArtist.test(option.textContent ?? "")),
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

	// Each answer from the search worker is drawn as it lands, so the one asked before the credits
	// arrived is drawn too, between the late part landing and the answer asked after it.
	test("the open dropdown goes from the busy artist group to the artists, with no moment holding neither", async ({
		page,
	}) => {
		await recordTheDropdown(page);
		await openLibrary(page);
		await revealSearch(page);
		await searchField(page).fill("revelries");

		const results = page.getByRole("listbox");
		await expect(
			results.getByRole("option").filter({ hasText: "Bloodhail" }),
		).toBeVisible();
		await expect(busyWithin(page, '[role="listbox"]').first()).toBeAttached();

		await page.evaluate(() => {
			(Reflect.get(window, "__dropdown") as DropdownStates).recording = true;
			(Reflect.get(window, "__lookAtTheDropdown") as () => void)();
		});
		await page.request.post("/__control/holdSubset", { data: {} });
		await expect(
			results.getByRole("option").filter({ hasText: /^Revelries(?! &)/ }),
		).toBeVisible();

		const { states } = await page.evaluate(
			() => Reflect.get(window, "__dropdown") as DropdownStates,
		);
		const untilTheArtists = states.slice(
			0,
			states.findIndex((state) => state.artists) + 1,
		);
		expect(
			untilTheArtists.at(-1)?.artists,
			"the artists were never drawn",
		).toBe(true);
		expect(
			untilTheArtists.filter((state) => !state.busy && !state.artists),
			"the dropdown showed neither the busy artist group nor the artists",
		).toEqual([]);
	});

	test("a member's page is busy until the credits are split, and never says they have nothing here", async ({
		page,
	}) => {
		await recordWhatIsDrawn(page);
		await openLibrary(page);
		await page.goto(`/#/${artistRoute(MEMBER)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		const busy = busyWithin(page, "main");
		await expect(busy.first()).toBeAttached();

		await releaseTheLatePart(page);
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

	test("the header's placeholder is busy and says Loading once, until the credits are split", async ({
		page,
	}) => {
		await recordWhatIsDrawn(page);
		await openLibrary(page);
		await page.goto(`/#/${artistRoute(MEMBER)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		const header = viewHeader(page);
		const busy = busyWithin(page, "main header");
		await expect(busy.first()).toBeAttached();
		expect(await loadingsIn(header)).toBe(1);

		await releaseTheLatePart(page);
		await expect(
			page.locator("main").getByRole("link", { name: /Deathconsciousness/ }),
		).toBeVisible();
		await expect(busy).toHaveCount(0);
		expect(await loadingsIn(header)).toBe(0);
	});

	const busyBelowTheHeader = (page: Page, loading: string) =>
		page.locator("main").evaluate(
			(main, said) =>
				[...main.querySelectorAll('[aria-busy="true"]')]
					.filter((element) => !element.closest("header"))
					.map((element) => ({
						loadings: (element.textContent ?? "").split(said).length - 1,
						holdsAPlaceholder: [
							...element.querySelectorAll(
								'[aria-hidden="true"]:not(svg, button *)',
							),
						].some((bar) => {
							const box = bar.getBoundingClientRect();
							return box.width > 0 && box.height > 0;
						}),
					})),
			loading,
		);

	const untilTheLatePartIsAsked = (player: FakePlayer) =>
		expect
			.poll(
				() =>
					requestsTo(player, "/api/library/export").filter((entry) =>
						new URL(entry.path, "http://fake.invalid").searchParams
							.getAll("only")
							.some((column) => LATE.includes(column)),
					).length,
				{ message: "Jean never asked for the late part" },
			)
			.toBeGreaterThan(0);

	test("the tracks tab holds placeholder rows, never the reading notice, until the credits are split", async ({
		page,
		player,
	}) => {
		await page.addInitScript((reading) => {
			const seen: { reading: boolean } = { reading: false };
			Reflect.set(window, "__readingSeen", seen);
			new MutationObserver(() => {
				if (document.querySelector("main")?.textContent?.includes(reading))
					seen.reading = true;
			}).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		}, en["library.reading"]);
		await page.clock.install();
		await openLibrary(page);
		await untilTheLatePartIsAsked(player);
		await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);

		await page.goto(`/#/${artistRoute(MEMBER, "tracks")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		await runClockFor(page, 1000);

		await expect
			.poll(() => busyBelowTheHeader(page, LOADING), {
				message: "the tracks tab shows no busy placeholder",
			})
			.toContainEqual({ loadings: 1, holdsAPlaceholder: true });
		for (const busy of await busyBelowTheHeader(page, LOADING))
			expect(busy.loadings, "a busy element says Loading other than once").toBe(
				1,
			);
		expect(
			await page.evaluate(
				() =>
					(Reflect.get(window, "__readingSeen") as { reading: boolean })
						.reading,
			),
			"the tracks tab said it is reading the library",
		).toBe(false);

		await page.clock.resume();
		await page.request.post("/__control/holdSubset", { data: {} });
		await expect(trackRow(page, 0)).toContainText("Bloodhail");
		await expect.poll(() => busyBelowTheHeader(page, LOADING)).toEqual([]);
	});

	const firstPlaceholderRow = (page: Page) =>
		page.locator("main").evaluate((main) => {
			const bars = [...main.querySelectorAll('[aria-busy="true"]')]
				.filter((element) => !element.closest("header"))
				.flatMap((busy) => [
					...busy.querySelectorAll('[aria-hidden="true"]:not(svg, button *)'),
				])
				.filter((bar) => {
					const box = bar.getBoundingClientRect();
					return box.width > 0 && box.height > 0;
				});
			const first = bars[0];
			if (!first) return null;
			const line = first.getBoundingClientRect();
			const isOnTheLine = (bar: Element) => {
				const box = bar.getBoundingClientRect();
				return box.top < line.bottom && box.bottom > line.top;
			};
			const busy = first.closest('[aria-busy="true"]');
			let row: Element = first;
			for (
				let outer = first.parentElement;
				outer && row !== busy;
				outer = outer.parentElement
			) {
				if (!bars.filter((bar) => outer.contains(bar)).every(isOnTheLine))
					break;
				row = outer;
			}
			const box = row.getBoundingClientRect();
			const origin = main.getBoundingClientRect().top - main.scrollTop;
			return { top: box.top - origin, height: box.height };
		});

	const firstRealRow = (page: Page) =>
		trackRow(page, 0).evaluate((row) => {
			const main = row.closest("main") as HTMLElement;
			const box = row.getBoundingClientRect();
			const origin = main.getBoundingClientRect().top - main.scrollTop;
			return { top: box.top - origin, height: box.height };
		});

	const PAST_THE_REVEAL_MS = 400;

	test("the tracks tab's first placeholder row sits where the first row lands, at its height", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.goto(`/#/${artistRoute(MEMBER, "tracks")}`);
		await expect(
			page.getByRole("heading", { level: 1, name: MEMBER }),
		).toBeVisible();
		await expect
			.poll(() => firstPlaceholderRow(page), {
				message: "the tracks tab drew no placeholder row",
			})
			.not.toBeNull();
		const atFirst = await firstPlaceholderRow(page);
		await page.waitForTimeout(PAST_THE_REVEAL_MS);
		const afterAWhile = await firstPlaceholderRow(page);

		await page.request.post("/__control/holdSubset", { data: {} });
		await expect(trackRow(page, 0)).toContainText("Bloodhail");
		const landed = await firstRealRow(page);

		for (const [when, placeholder] of [
			["at first", atFirst],
			["after a while", afterAWhile],
		] as const) {
			expect(
				Math.abs((placeholder?.top ?? 0) - landed.top),
				`the first row landed at ${landed.top}px, the placeholder stood at ${placeholder?.top}px ${when}`,
			).toBeLessThan(0.5);
			expect(
				Math.abs((placeholder?.height ?? 0) - landed.height),
				`the first row is ${landed.height}px tall, the placeholder ${placeholder?.height}px ${when}`,
			).toBeLessThan(0.5);
		}
	});
});
