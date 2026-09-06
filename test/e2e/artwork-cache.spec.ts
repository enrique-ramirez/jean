import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openSettings,
	requestsTo,
	settingsDialog,
	test,
} from "./fixtures.ts";

// beefweb sends `Cache-Control: max-age=3, must-revalidate` on every response, artwork included, so
// the browser's own cache is defeated by design and every visit re-downloads every cover. Jean keeps
// its own copy in Cache Storage, which ignores caching headers entirely.
//
// These run on `localhost`, which is a secure context, so `caches` exists here exactly as it does on
// the HTTPS install. An install served over plain HTTP has neither, and the app must not notice.

const covers = (player: FakePlayer) => requestsTo(player, "/artwork/");

// The addresses asked for more than once across the whole session. Counting
// requests per visit cannot work: which covers are on screen shifts by a row
// between one visit and the next, so a second visit legitimately asks for some
// it never asked for before. What must never happen is asking twice for one.
const askedTwice = (player: FakePlayer) => {
	const seen = new Map<string, number>();
	for (const entry of covers(player))
		seen.set(entry.path, (seen.get(entry.path) ?? 0) + 1);
	return [...seen].filter(([, times]) => times > 1).map(([path]) => path);
};

// Throws rather than answering zero where there is no Cache Storage at all: the
// suite runs on localhost, which is a secure context, so an absent `caches` here
// is a broken harness and every count below would read as an empty cache.
const held = (page: Page) =>
	page.evaluate(async () => {
		if (typeof caches === "undefined")
			throw new Error("no Cache Storage in this context");
		const cache = await caches.open("jean-artwork-v1");
		return (await cache.keys()).length;
	});

// Waits for the covers to stop arriving rather than for none to be outstanding:
// a row below the fold stays `waiting` for as long as it is off screen, which is
// the visibility gate working, not a load in flight. Counting requests against a
// view still filling in would compare a partial first visit with a whole second
// one and call the difference a miss.
const settle = async (page: Page) => {
	await expect(page.locator("main [data-artwork]").first()).toBeAttached();

	const drawn = () => page.locator('main [data-artwork="ok"]').count();
	await expect.poll(drawn).toBeGreaterThan(0);

	// Three consecutive equal readings, not two: covers arrive through a bounded
	// queue three at a time, so a stall longer than one interval reads as settled.
	let last = -1;
	let steady = 0;
	await expect
		.poll(
			async () => {
				const now = await drawn();
				steady = now === last ? steady + 1 : 0;
				last = now;
				return steady;
			},
			{ intervals: [400] },
		)
		.toBeGreaterThanOrEqual(2);
};

test.describe("artwork is kept between visits", () => {
	test("a second visit does not ask for a cover it already holds", async ({
		page,
		player,
	}) => {
		await page.goto("/#/p7");
		await settle(page);
		expect(covers(player).length).toBeGreaterThan(0);
		await expect.poll(() => held(page)).toBeGreaterThan(0);

		// Away and back, which is what re-fetched everything before: the component
		// remounts, and beefweb's three seconds have long since lapsed.
		await page.goto("/#/home");
		await page.waitForTimeout(200);
		await page.goto("/#/p7");
		await settle(page);

		await expectSettlesAt(player, () => askedTwice(player), []);
	});

	test("a reload asks for nothing it already holds either", async ({
		page,
		player,
	}) => {
		await page.goto("/#/p7");
		await settle(page);
		expect(covers(player).length).toBeGreaterThan(0);

		await page.reload();
		await settle(page);

		await expectSettlesAt(player, () => askedTwice(player), []);
	});

	test("one album across many rows is one entry and one handle", async ({
		page,
	}) => {
		await page.goto("/#/p7");
		await settle(page);

		// `createObjectURL` mints a new handle per call, so a dozen rows of one album
		// would be a dozen copies of the same picture in memory unless they share.
		const { rows, handles } = await page.evaluate(() => {
			const drawn = [
				...document.querySelectorAll<HTMLImageElement>('main [role="row"] img'),
			];
			return {
				rows: drawn.length,
				handles: new Set(drawn.map((i) => i.src)).size,
			};
		});

		expect(rows).toBeGreaterThan(8);
		expect(handles).toBeLessThan(rows / 2);
	});
});

test.describe("what is deliberately not kept", () => {
	test("a track with no artwork is asked for again, so adding one shows up", async ({
		page,
	}) => {
		// Answered here rather than through a fixture, because what matters is the
		// status: beefweb sends `404 no artwork found` for a track with no embedded
		// cover, and that answer must never be kept.
		let asked = 0;
		await page.route("**/api/artwork/**", async (route) => {
			asked += 1;
			await route.fulfill({ status: 404, body: "no artwork found" });
		});

		await page.goto("/#/p7");
		await expect
			.poll(() => page.locator('main [data-artwork="failed"]').count())
			.toBeGreaterThan(0);

		const first = asked;
		expect(first).toBeGreaterThan(0);
		expect(await held(page)).toBe(0);

		await page.reload();
		await expect
			.poll(() => page.locator('main [data-artwork="failed"]').count())
			.toBeGreaterThan(0);

		// Asked again rather than remembered as absent, which is the whole point: a
		// sleeve added to the file turns up on the next look.
		expect(asked).toBeGreaterThan(first);
	});
});

test.describe("clearing it", () => {
	test("Settings says what is held and empties it", async ({ page }) => {
		await page.goto("/#/p7");
		await settle(page);
		await expect.poll(() => held(page)).toBeGreaterThan(0);

		await openSettings(page);
		// A `<section>` with no accessible name is not a region, and these panels are
		// addressed by their heading everywhere else in the suite.
		const panel = settingsDialog(page)
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "Cached artwork" }) });
		await expect(panel).toContainText(/cover/);

		await panel.getByRole("button", { name: "Clear cached artwork" }).click();

		await expect.poll(() => held(page)).toBe(0);
		await expect(panel).toContainText("Nothing kept yet.");
	});
});
