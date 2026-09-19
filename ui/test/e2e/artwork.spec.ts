import type { FakePlayer, Page } from "./fixtures.ts";
import {
	AS_A_CLIENT,
	componentOrigin,
	expect,
	FOO_JEAN_TOKEN,
	guidOfPlaylist,
	openAllMusic,
	openLibrary,
	requestsTo,
	scrollTop,
	test,
	times,
} from "./fixtures.ts";

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
			AS_A_CLIENT,
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

// beefweb addresses artwork per row -- a playlist by index, the library by path
// -- so a record's tracks are one URL each for one picture and the browser has
// no way to know. There is no thumbnail endpoint: the full image comes back
// whatever size it is drawn at.
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
		await page.addInitScript(() => {
			const mint = URL.createObjectURL.bind(URL);
			let minted = 0;
			URL.createObjectURL = (object: Blob | MediaSource) => {
				minted += 1;
				return mint(object);
			};
			Object.defineProperty(window, "__mintedArtwork", { get: () => minted });
		});

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
		page.route("**/api/artwork**", async (route) => {
			await new Promise((done) => setTimeout(done, 3000));
			await route.continue();
		});

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

// A library cover comes from the component rather than from beefweb, addressed by the track's
// library-relative path. The route authenticates, so nothing can point an `<img>` straight at it, and
// keeping the bytes between visits is the browser's own cache answering `no-cache` against a strong
// validator.
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
			expect(head["cache-control"]).toBe("no-cache, must-revalidate");
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

		const auth = { Authorization: `Bearer ${FOO_JEAN_TOKEN}` };
		const first = await request.get(url, { headers: auth });
		expect(first.status()).toBe(200);

		const tag = first.headers().etag;
		const again = await request.get(url, {
			headers: { ...auth, "If-None-Match": tag },
		});

		expect(again.status()).toBe(304);
		expect(again.headers().etag).toBe(tag);
		expect(await again.body()).toHaveLength(0);
	});
});
