import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	componentOrigin,
	countCoverHandles,
	coversFromTheComponent,
	expect,
	guidOfPlaylist,
	holdRequests,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	requestsTo,
	rowByTitle,
	searchFor,
	statusBar,
	test,
	times,
	trackRow,
} from "./fixtures.ts";
import { scrollTop } from "./scrolling.ts";

// Far enough down that getting there crosses thousands of rows the view has
// never been near.
const FAR = 25000;

// Rows on screen once the list has stopped moving and the player has stopped
// being asked for covers. Watched rather than waited out, since a fixed
// timeout either misses a slow scroll or reads the request log mid-flight.
const settle = async (page: Page, player: FakePlayer) => {
	let last = { at: -1, asked: -1 };
	await expect
		.poll(
			async () => {
				const now = {
					at: await scrollTop(page),
					asked: player.requests.length,
				};
				const steady = now.at === last.at && now.asked === last.asked;
				last = now;
				return steady;
			},
			{ intervals: [250] },
		)
		.toBe(true);
	return page.locator('main [role="row"]').count();
};

test.describe("artwork loading", () => {
	test.use({ librarySize: 30441, motion: "allow" });

	test("a jump across the library asks for the covers it lands on, not the ones it passes", async ({
		page,
		player,
		request,
	}) => {
		await openLibrary(page);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await expect
			.poll(() => requestsTo(player, "artwork").length)
			.toBeGreaterThan(0);
		await settle(page, player);
		player.requests.length = 0;

		// Playing the far track flies the list there rather than scrolling it,
		// since native lazy loading would count every row mounted and unmounted
		// along the way as visible.
		const origin = await componentOrigin(request);
		await request.post(
			`${origin}/api/playlists/${guidOfPlaylist(player, "p7")}/items/${FAR}/play`,
			{ headers: { "Content-Type": "application/json" } },
		);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(1_000_000);

		const rows = await settle(page, player);
		const asked = requestsTo(player, "artwork").length;

		expect(
			asked,
			`${asked} artwork requests for ${rows} rows on screen`,
		).toBeLessThan(rows * 2);
	});

	test("a cover already answered for is not asked for again", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await expect
			.poll(() => requestsTo(player, "artwork").length)
			.toBeGreaterThan(0);
		await settle(page, player);

		await page.evaluate(() =>
			(document.querySelector("main") as HTMLElement).scrollBy(0, 4000),
		);
		await settle(page, player);

		const seen = requestsTo(player, "artwork").length;
		player.requests.length = 0;

		await page.evaluate(() =>
			(document.querySelector("main") as HTMLElement).scrollTo(0, 0),
		);
		await settle(page, player);

		const again = requestsTo(player, "artwork").length;
		expect(
			again,
			`${seen} covers on the way down, ${again} on the way back`,
		).toBe(0);
	});
});

// The list scrolls inside `main` rather than the document, and a margin measured from the
// browser's viewport stops at that scroller's edge: a cover is then first asked for as its row
// crosses the fold, and every scroll is led by a band of placeholders.
test.describe("a cover just below the fold", () => {
	// An album a track, so no row's cover is answered by the row above it.
	test.use({
		libraryShape: { tracks: 200, albums: 200 },
		settings: { "jean.layout": "compact" },
	});

	const AHEAD_PX = 200;

	test("is asked for before it scrolls in", async ({ page }) => {
		await openAllMusic(page);

		await expect
			.poll(() =>
				page.evaluate((ahead) => {
					const fold = (
						document.querySelector("main") as HTMLElement
					).getBoundingClientRect().bottom;
					const below = [
						...document.querySelectorAll<HTMLElement>("main [data-artwork]"),
					].filter((cover) => {
						const { top } = cover.getBoundingClientRect();
						return top >= fold && top < fold + ahead;
					});
					return {
						drawn: below.length > 0,
						waiting: below.filter(
							(cover) => cover.dataset.artwork === "waiting",
						).length,
					};
				}, AHEAD_PX),
			)
			.toEqual({ drawn: true, waiting: 0 });
	});
});

// `foo_jean` addresses artwork per track, by its library path, so a record's tracks are one URL
// each for one picture and the browser has no way to know. There is no thumbnail endpoint: the full
// image comes back whatever size it is drawn at.
test.describe("one cover per album, not per track", () => {
	test.use({ settings: { "jean.layout": "compact" } });

	const TRACKS = 54;
	const ALBUMS = 12;

	const walkTheList = async (page: Page, player: FakePlayer) => {
		await expect
			.poll(
				async () => {
					const atTheEnd = await page.evaluate(() => {
						const scroller = document.querySelector("main") as HTMLElement;
						const wasAt = scroller.scrollTop;
						scroller.scrollBy(0, 300);
						return wasAt >= scroller.scrollHeight - scroller.clientHeight - 1;
					});
					// Past the queue's settle gate, or the rows go by without ever asking.
					await page.waitForTimeout(400);
					return atTheEnd;
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		await settle(page, player);
	};

	test("walking the whole list costs one request an album", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await walkTheList(page, player);

		const asked = requestsTo(player, "artwork").length;
		expect(
			asked,
			`${asked} requests for ${TRACKS} tracks in ${ALBUMS} albums`,
		).toBeLessThanOrEqual(ALBUMS + 3);
	});

	test("the rows of one album point at one URL", async ({ page, player }) => {
		await openLibrary(page);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await walkTheList(page, player);

		const { rows, covers } = await page.evaluate(() => {
			const drawn = [
				...document.querySelectorAll<HTMLImageElement>('main [role="row"] img'),
			];
			return {
				rows: drawn.length,
				covers: new Set(drawn.map((img) => img.src)).size,
			};
		});

		expect(rows).toBeGreaterThan(8);
		expect(covers, `${covers} covers across ${rows} rows`).toBeLessThan(
			rows / 2,
		);
	});

	// One address is one handle, however many rows come and go over it. A row that
	// gives back a claim it never took revokes the picture under the rows still
	// drawing it -- and an `<img>` that catches that reports a failure the queue
	// remembers, which leaves the album blank for the rest of the session.
	test("and stays one handle however the rows churn", async ({
		page,
		player,
	}) => {
		await countCoverHandles(page);

		await page.route("**/api/artwork**", async (route) => {
			await new Promise((done) => setTimeout(done, 600));
			await route.continue();
		});

		await openLibrary(page);
		await expect(page.locator('[role="row"]').first()).toBeAttached();

		const scrollBy = (offset: number) =>
			page.evaluate(
				(by: number) =>
					(document.querySelector("main") as HTMLElement).scrollBy(0, by),
				offset,
			);

		// Down past the album and straight back, faster than the settle gate: the
		// rows in between mount, ask for nothing and unmount again.
		await times(8, async () => {
			await scrollBy(1200);
			await page.waitForTimeout(80);
			await scrollBy(-1200);
			await page.waitForTimeout(80);
		});

		const firstCover = page.locator("main [data-artwork]").first();
		await expect(firstCover).toHaveAttribute("data-artwork", "ok", {
			timeout: 20_000,
		});

		await settle(page, player);

		const minted = await page.evaluate(
			() => (window as unknown as { __mintedArtwork: number }).__mintedArtwork,
		);
		const addresses = new Set(
			requestsTo(player, "artwork").map((entry) => entry.path),
		).size;

		expect(addresses).toBeGreaterThan(0);
		expect(
			minted,
			`${minted} handles minted for ${addresses} covers`,
		).toBeLessThanOrEqual(addresses);
	});
});

test.describe("what a cover looks like before it arrives", () => {
	// Named rather than found by class: `data-state` is a shared idiom in here and
	// a hashed module class is not a contract.
	const cover = (page: Page) => page.locator("main [data-artwork]");

	const holdArtwork = (page: Page) =>
		holdRequests(page, (request) =>
			new URL(request.url()).pathname.startsWith("/api/artwork"),
		);

	test("a hold with a sleeve on it, and no alt text anywhere", async ({
		page,
	}) => {
		await holdArtwork(page);
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		const first = cover(page).first();
		await expect(first).toHaveAttribute("data-artwork", /waiting|granted/);
		await expect(first.locator("svg")).toBeVisible();

		// A browser paints alt text into the box the moment an <img> has a src
		// and no bytes, so every cover stays transparent until it has decoded.
		const showing = await page
			.locator("main img")
			.evaluateAll(
				(images) =>
					(images as HTMLImageElement[]).filter(
						(img) => getComputedStyle(img).opacity !== "0" && !img.complete,
					).length,
			);
		expect(showing, "an undecoded image was left visible").toBe(0);
	});

	test("and settles to the picture once it has", async ({ page }) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();

		await expect(cover(page).first()).toHaveAttribute("data-artwork", "ok");
		await expect(cover(page).first().locator("svg")).toHaveCount(0);
	});
});

// A library cover comes from the component, addressed by the track's library-relative path. The
// route authenticates, so nothing can point an `<img>` straight at it, and keeping the bytes
// between visits is the browser's own cache answering a long `max-age` against a strong validator.
test.describe("a cover from the library", () => {
	const artworkAnswers = (page: Page) => {
		const answered: { path: string; status: number }[] = [];
		page.on("response", (response) => {
			const url = new URL(response.url());
			if (url.pathname === "/api/artwork")
				answered.push({
					path: url.searchParams.get("track") ?? "",
					status: response.status(),
				});
		});
		return answered;
	};

	const settled = (page: Page) =>
		expect(page.locator("main [data-artwork='ok']").first()).toBeVisible();

	const HELD_FOR_180_DAYS = "private, max-age=15552000";

	test("is asked for by the track's path, on the component", async ({
		page,
		player,
	}) => {
		const answered = artworkAnswers(page);

		await openAllMusic(page);
		await settled(page);

		expect(answered.length).toBeGreaterThan(0);
		expect(answered.every((entry) => entry.path.length > 0)).toBe(true);
		expect(requestsTo(player, "/api/artwork/library")).toEqual([]);
	});

	test("carries a strong validator and terms that keep it", async ({
		page,
	}) => {
		const headers: Record<string, string>[] = [];
		page.on("response", (response) => {
			if (new URL(response.url()).pathname === "/api/artwork" && response.ok())
				headers.push(response.headers());
		});

		await openAllMusic(page);
		await settled(page);

		expect(headers.length).toBeGreaterThan(0);
		for (const head of headers) {
			expect(head["cache-control"]).toBe(HELD_FOR_180_DAYS);
			expect(head.etag).toMatch(/^"[^"]+"$/);
		}
	});

	// Asked of the component directly rather than through the page, because Playwright
	// gives a spec no way to see whether a browser answered a request out of its own
	// cache.
	test("answers a conditional request with a 304 and no body", async ({
		page,
		request,
	}) => {
		await openAllMusic(page);
		await settled(page);

		const url = (await page.evaluate(() =>
			(performance.getEntriesByType("resource") as PerformanceResourceTiming[])
				.map((entry) => entry.name)
				.find((name) => name.includes("/api/artwork?track=")),
		)) as string;

		const first = await request.get(url);
		expect(first.status()).toBe(200);

		const tag = first.headers().etag;
		const again = await request.get(url, {
			headers: { "If-None-Match": tag },
		});

		expect(again.status()).toBe(304);
		expect(again.headers().etag).toBe(tag);
		expect(await again.body()).toHaveLength(0);
	});
});

// Which picture is behind each address, as a digest of what it decodes to. Read through an image
// rather than fetched: a drawn cover's address is a `blob:`, and foo_jean's page policy lets the
// page draw one and refuses to let it fetch one.
const digestsOf = (page: Page, urls: string[]) =>
	page.evaluate(async (list: string[]) => {
		const read = async (url: string) => {
			const image = new Image();
			image.src = url;
			try {
				await image.decode();
			} catch {
				return "no picture";
			}

			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d") as CanvasRenderingContext2D;
			context.drawImage(image, 0, 0);
			const digest = await crypto.subtle.digest(
				"SHA-1",
				context.getImageData(0, 0, canvas.width, canvas.height).data,
			);
			return [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		};

		const digests: string[] = [];
		for (const url of list) digests.push(await read(url));
		return digests;
	}, urls);

// Jar Of Flies in the captured library, as the library-relative paths `GET /api/artwork` names a
// track by.
const ALBUM = "A/Alice in Chains/(1994) Jar Of Flies";
const FIRST_IN_ALBUM_ORDER = `${ALBUM}/01. Rotten Apple.flac`;
const LAST_TRACK = "Swing On This";

const aCoverIsDrawn = (page: Page) =>
	expect(page.locator("main [data-artwork='ok']").first()).toBeVisible();

// Which rows of a record share one picture is settled by `coverIdentity`, and these two cases are
// about the address that picture arrives at. A view that begins in the middle of a record, one
// search result being the shortest of them, asks at its own first row, so one sleeve has a URL per
// view and the browser caches each of those separately.
test.describe("the address an album's cover is asked at", () => {
	test("an album reached by its last track is asked for at its first", async ({
		page,
		player,
	}) => {
		await page.goto("/#/search");
		await searchFor(page, LAST_TRACK);
		await aCoverIsDrawn(page);

		expect([...new Set(coversFromTheComponent(player))]).toEqual([
			FIRST_IN_ALBUM_ORDER,
		]);
	});

	test("an album drawn on a second surface costs no second request", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await aCoverIsDrawn(page);

		// Reloaded on the empty search route, so the second surface has no blob handle to inherit the
		// sleeve from and has to go and fetch it. What a reload leaves standing is the browser's own
		// cache, keyed by URL, and months of covers held there is what one address an album buys.
		await page.goto("/#/search");
		await page.reload();

		await searchFor(page, LAST_TRACK);
		await aCoverIsDrawn(page);

		const asked = coversFromTheComponent(player).filter((track) =>
			track.startsWith(ALBUM),
		);
		expect(asked).toEqual([FIRST_IN_ALBUM_ORDER]);
	});
});

// The half about sharing rather than about the address. A cover is identified by the
// picture it is and never by the address it came from (`shared/ui/CLAUDE.md`, *Artwork*), and the
// registry that hands one picture to many elements is a map on that identity. Two surfaces that
// name one record differently never meet in it, however identical the URL they both fetch.
//
// Not over `withNoListOnScreen`: the list being on screen is the whole of what this case is about.
test.describe("a record already on screen, then played", () => {
	// One cover per row rather than one per group, so the row asserted on below is drawing this
	// record's sleeve itself.
	test.use({ settings: { "jean.layout": "compact" } });

	test("draws the status bar's sleeve from the handle the row already holds", async ({
		page,
	}) => {
		// `createObjectURL` mints a new handle per call and coalesces nothing, so a mint is another
		// copy of the same picture decoded and held until the tab closes. Nothing revokes it while
		// either surface is drawing, and nobody can see it or clear it.
		await countCoverHandles(page);

		const minted = () =>
			page.evaluate(
				() =>
					(window as unknown as { __mintedArtwork: number }).__mintedArtwork,
			);

		await openAllMusic(page);
		const row = trackRow(page, 0);
		await expect(row.locator("[data-artwork='ok'] img")).toBeVisible();

		// Whatever the rows on screen have cost so far. The record played below is one of them, so
		// what is read after it is whether playing it cost anything more.
		const held = await minted();
		const sleeve = await row.locator("img").getAttribute("src");

		await row.dblclick();
		await expect(
			statusBar(page).locator("[data-artwork='ok'] img"),
		).toBeVisible();

		// The same handle, which is the same picture decoded once. The status bar is looking at the
		// record the row is looking at and a person can see both at once, so a second handle is the
		// same sleeve twice over. Read as one assertion, so a failure reports the cost rather than
		// two opaque blob addresses.
		const after = {
			sharesTheRowsHandle:
				(await statusBar(page).locator("img").getAttribute("src")) === sleeve,
			minted: await minted(),
		};
		expect(
			after,
			"one record, and a decoded copy of its sleeve per surface",
		).toEqual({
			sharesTheRowsHandle: true,
			minted: held,
		});
	});
});

// The same view, on the other reader: a playlist row takes its path from the rows the player
// answers rather than from the media library's index, so one address an album has to hold on both.
// The Default Playlist carries the record's first four tracks, and seeded from its second row the
// view begins on track 02 and never holds the track its cover is addressed by.
test.describe("a playlist that begins partway into an album", () => {
	test.use({ playlistsFromRow: { p1: 1 } });

	test("asks at the album's first track, which the playlist does not hold", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${guidOfPlaylist(player, "p1")}`);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await aCoverIsDrawn(page);

		expect([...new Set(coversFromTheComponent(player))]).toEqual([
			FIRST_IN_ALBUM_ORDER,
		]);
	});
});

// A playlist row for a file the media library has never seen. `GET /api/artwork` is
// addressed by a library-relative path and there is none, so the playlist and the row stand in for
// one: the player resolves the position to a handle of its own and no path reaches it from here.
test.describe("a playlist row the media library carries no path for", () => {
	// One cover per row rather than one per group, so what is asserted on below is this row's own
	// and not the record's header.
	test.use({ mediaLibrarySize: 12, settings: { "jean.layout": "compact" } });

	const ROW = 1;

	// A row that drew a stale handle, or a neighbouring record's sleeve, reaches `ok` just the same
	// and only the picture tells them apart.
	const digestOf = async (page: Page, url: string) =>
		(await digestsOf(page, [url]))[0];

	test("draws its cover from the position it sits at", async ({
		page,
		player,
		request,
	}) => {
		const origin = await componentOrigin(request);
		const guid = guidOfPlaylist(player, "p1");

		await page.goto(`/#/${guid}`);
		await expect(page.locator('[role="row"]').first()).toBeAttached();

		expect(
			player.libraryPathFor(player.playlistById("p1")!.items[ROW]),
			"the media library carries this row, so the case is not set up",
		).toBeNull();

		// What the component answers for that position, asked of it directly. Read before anything is
		// claimed about the row, so a route serving no picture is reported as that rather than as a
		// row drawing the wrong one.
		const answered = await digestOf(
			page,
			`${origin}/api/artwork/playlists/${guid}/${ROW}`,
		);
		expect(answered, "that position answered no picture").toMatch(
			/^[0-9a-f]{40}$/,
		);

		const row = page.locator(`[role="row"][data-row="${ROW}"]`);
		await expect(row.locator("[data-artwork]")).toHaveAttribute(
			"data-artwork",
			"ok",
		);

		const drawn = await digestOf(
			page,
			(await row.locator("img").getAttribute("src")) ?? "",
		);
		expect(drawn, "the row drew a picture that address never answered").toBe(
			answered,
		);
	});
});

// A file whose own tags carry a sleeve that is not the record's, which is what `GET /api/artwork`
// answers for that file. What a person is looking at is the album either way.
test.describe("a track whose own art is not its album's", () => {
	const ODD_TRACK = "No Excuses";
	const ODD_TRACK_PATH = `${ALBUM}/04. No Excuses.flac`;

	test.use({ embeddedArt: { [ODD_TRACK]: "deja-entendu.jpg" } });

	const coverUrl = (origin: string, track: string) =>
		`${origin}/api/artwork?track=${encodeURIComponent(track)}`;

	test("draws its album's cover rather than the one in its own file", async ({
		page,
		request,
	}) => {
		const origin = await componentOrigin(request);

		await page.goto("/#/search");
		await searchFor(page, ODD_TRACK);

		const row = rowByTitle(page, ODD_TRACK);
		await expect(row.locator("[data-artwork='ok']")).toBeVisible();

		const [drawn, album, own] = await digestsOf(page, [
			(await row.locator("img").getAttribute("src")) ?? "",
			coverUrl(origin, FIRST_IN_ALBUM_ORDER),
			coverUrl(origin, ODD_TRACK_PATH),
		]);

		// Or the assertion below would hold with the fake answering one picture at both addresses.
		expect(own).not.toBe(album);
		expect(drawn, "the row drew the picture out of its own file").toBe(album);
	});
});

// Every cover reaches the element as a blob somebody already fetched, on every surface that draws
// one, rather than as `foo_jean`'s own address written straight onto an `<img>`. That stays true even
// though the address itself needs no credential any more: switching to a plain address changes
// caching and lazy loading enough to be a bundle of its own.
test.describe("what a cover element is ever pointed at", () => {
	// Every address a cover element is carrying that is not a handle on bytes somebody already
	// fetched. Read off the elements rather than off an origin, since it is `foo_jean`'s own address,
	// not a header, that a plain `<img>` here would be wrong to carry.
	const addressesThatAreNotBlobs = (page: Page) =>
		page.evaluate(() =>
			[...document.querySelectorAll("[data-artwork] img")]
				.map((image) => image.getAttribute("src") ?? "")
				.filter((src) => src !== "" && !src.startsWith("blob:")),
		);

	test("never at the component's own address directly, on any surface that draws a cover", async ({
		page,
		isMobile,
	}) => {
		// Read in this order on purpose. The element has to exist before its address says anything,
		// and it exists whether the address is a handle or the component's own. The picture has to
		// have drawn as well, or the absence in the middle is an absence of covers rather than of
		// direct addresses.
		const onlyBlobs = async (surface: string, within: Locator) => {
			await expect(
				within.locator("[data-artwork] img").first(),
			).toHaveAttribute("src", /.+/);
			expect(await addressesThatAreNotBlobs(page), surface).toEqual([]);
			await expect(
				within.locator("[data-artwork='ok'] img").first(),
			).toBeVisible();
		};

		await openAllMusic(page);
		await onlyBlobs("the library list", page.locator("main"));

		await trackRow(page, 0).dblclick();
		await onlyBlobs("the status bar", statusBar(page));

		await openNowPlaying(page);
		await onlyBlobs(
			isMobile ? "the cover wheel" : "the now-playing screen",
			nowPlayingScreen(page),
		);
	});
});

// A cover the player has none for is remembered, or a scroll back over ground already
// covered spends the whole request budget asking about the same absences again. Remembered for the
// life of the tab is the other failure: a sleeve dropped into an album's folder would not show up
// until somebody reloaded. The window is the one `GET /api/artwork` puts on a `404`, so the two
// halves expire together.
test.describe("a cover the player did not have the first time", () => {
	// `kMissingCoverCacheLifetimeSeconds` in the component's `core/http_server.cpp`, which
	// `contract/openapi.yaml` documents as ten minutes.
	const FORGETS_A_FAILURE_AFTER_MS = 600_000;
	const QUIET_MS = 400;

	test("is drawn once that window has passed, with no reload", async ({
		page,
	}) => {
		// The page's own clock, so ten minutes cost no wall time. Installed before anything
		// navigates, since a cover is asked for on the first render.
		await page.clock.install();

		let hasCover = false;
		let asks = 0;
		await page.route("**/api/artwork?track=**", async (route) => {
			asks += 1;
			if (hasCover) return route.continue();

			// `no-store`, so the only thing remembering this absence is Jean. The component holds a
			// `404` for the same ten minutes and the browser would honour that against a clock this
			// test cannot move, which would hide the half being measured here.
			return route.fulfill({
				status: 404,
				headers: { "cache-control": "no-store" },
				contentType: "application/json",
				body: JSON.stringify({ error: "no artwork for that track" }),
			});
		});

		await openAllMusic(page);
		const cover = page.locator('main [role="row"] [data-artwork]').first();
		await expect(cover).toHaveAttribute("data-artwork", "failed");

		// Every row of an album asks for the same cover, a few at a time. One still
		// queued when the cover appears is answered and draws the whole record,
		// which is the case below rather than the forgetting this one waits on.
		await expect
			.poll(async () => {
				const before = asks;
				await page.waitForTimeout(QUIET_MS);
				return asks - before;
			})
			.toBe(0);

		hasCover = true;

		// Still the glyph. The absence is held rather than asked about again on the next render,
		// which is what keeps a scroll over an uncovered library cheap, and it is why this criterion
		// is about forgetting rather than about never remembering.
		await page.waitForTimeout(500);
		await expect(cover).toHaveAttribute("data-artwork", "failed");

		await page.clock.fastForward(FORGETS_A_FAILURE_AFTER_MS + 1_000);

		// Nothing reloaded and nobody touched anything: the row is looking at a cover that exists
		// now, and it draws it.
		await expect(cover).toHaveAttribute("data-artwork", "ok", {
			timeout: 15_000,
		});
		await expect(cover.locator("img")).toBeVisible();
	});

	// Every row of a record asks for the same cover, a few at a time, so one ask
	// can be refused while another for the same record is still waiting on its
	// answer. The answer that draws the second has to reach the first as well,
	// and every ask refused while it was on its way.
	test("is drawn wherever its record was refused once another ask for it is answered", async ({
		page,
	}) => {
		const ANSWERED_LATE = 2;
		let record: string | null = null;
		let released = false;
		await page.route("**/api/artwork?track=**", async (route) => {
			const address = route.request().url();
			record ??= address;
			if (released || address !== record) return route.fallback();
			return route.fulfill({
				status: 404,
				headers: { "cache-control": "no-store" },
				contentType: "application/json",
				body: JSON.stringify({ error: "no artwork for that track" }),
			});
		});
		const held = await holdRequests(
			page,
			(request) => record !== null && request.url() === record,
			{ count: ANSWERED_LATE },
		);

		await openAllMusic(page);
		const refused = page.locator('main [data-artwork="failed"]');
		await expect(refused).not.toHaveCount(0);
		await held.untilHeld(ANSWERED_LATE);

		released = true;
		held.releaseAll();

		await expect(
			page.locator('main [data-artwork="ok"]').first(),
		).toBeVisible();
		await expect(refused).toHaveCount(0);
	});
});
