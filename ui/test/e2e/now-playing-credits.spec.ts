import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	holdingJeansDeclaration,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	routeOf,
	rowByTitle,
	test,
	ticksTaken,
	titleOf,
	untilQuiet,
	withNoListOnScreen,
} from "./fixtures.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// Jar Of Flies, retagged: 'No Excuses' credits two names the library knows on
// their own, Alice in Chains through the album artist and Mad Season through
// "Don't Follow". The comma is the tag's, and could as well be a name's.
const LEAD = "Alice in Chains";
const OTHER = "Mad Season";
const SHARED = "No Excuses";

test.describe("a credit naming two artists the library knows", () => {
	test.use({
		retagged: {
			[SHARED]: { "%artist%": `${LEAD}, ${OTHER}` },
			"Don't Follow": { "%artist%": OTHER },
		},
	});

	test("the screen links each of them and keeps the tag's own joiner", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SHARED));
		if (isMobile) await rowByTitle(page, SHARED).tap();
		else await rowByTitle(page, SHARED).dblclick();
		await openNowPlaying(page);

		const screen = nowPlayingScreen(page);
		const lead = screen.getByRole("link", { name: LEAD, exact: true });
		const other = screen.getByRole("link", { name: OTHER, exact: true });
		await expect(lead).toBeVisible();
		await expect(other).toBeVisible();
		await expect(lead).toHaveAttribute("href", /#\/artist\//);
		await expect(other).toHaveAttribute("href", /#\/artist\//);

		await expect(
			screen.locator("p", {
				has: page.getByRole("link", { name: OTHER, exact: true }),
			}),
		).toHaveText(`${LEAD}, ${OTHER}`);
	});
});

// The links are the members `GET /api/library/credits` answers for the
// playing track, named by its ordinal at the structure it was read at, rather than read off the
// whole library's credit columns. Played at the player over no list, so nothing but the playing
// surfaces asks the library anything.
const CREDITS = "/api/library/credits";

const creditAsks = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) => entry.method === "GET" && routeOf(entry.path) === CREDITS,
		)
		.map((entry) => {
			const asked = new URL(entry.path, "http://fake").searchParams;
			return {
				structure: asked.get("structure"),
				ordinal: asked.get("ordinal"),
				splitsCredits: asked.get("splitsCredits"),
			};
		});

const playAtThePlayer = async (
	page: Page,
	player: FakePlayer,
	title: string,
) => {
	const row = player
		.playlistById("p1")
		?.items.findIndex((track) => titleOf(track) === title);
	if (row === undefined || row < 0)
		throw new Error(`the Default Playlist holds no "${title}"`);
	await page.request.post("/__control/play", {
		data: { playlistId: "p1", index: row },
	});
	await expect.poll(() => player.player.activeItem.index).toBe(row);
};

const askFor = (player: FakePlayer, title: string, splitsCredits = "true") => {
	const track = player
		.playlistById("p1")
		?.items.find((held) => titleOf(held) === title);
	return {
		structure: String(player.libraryFeed.structure),
		ordinal: String(player.libraryOrdinalFor(track ?? null)),
		splitsCredits,
	};
};

test.describe("the playing track's credit links", () => {
	test.use({
		retagged: {
			[SHARED]: { "%artist%": `${LEAD}, ${OTHER}` },
			"Don't Follow": { "%artist%": OTHER },
		},
	});
	test.beforeEach(({ player }) => holdingJeansDeclaration(player));

	test("come from one question about the playing track, asked again for the next track and not for a play of it", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, SHARED);
		await openNowPlaying(page);

		const screen = nowPlayingScreen(page);
		await expect(
			screen.getByRole("link", { name: LEAD, exact: true }),
		).toBeVisible();
		await expect(
			screen.getByRole("link", { name: OTHER, exact: true }),
		).toBeVisible();
		await expectSettlesAt(player, () => creditAsks(player), [
			askFor(player, SHARED),
		]);

		const revision = player.libraryFeed.revision;
		const ordinal = Number(askFor(player, SHARED).ordinal);
		await page.request.post("/__control/play", { data: { ordinal } });
		expect(player.libraryFeed.revision).not.toBe(revision);
		const ticks = ticksTaken(player);
		await expect.poll(() => ticksTaken(player)).toBeGreaterThan(ticks + 1);
		await expectSettlesAt(player, () => creditAsks(player), [
			askFor(player, SHARED),
		]);

		await playAtThePlayer(page, player, "I Stay Away");
		await expect(screen.locator("h1")).toContainText("I Stay Away");
		await expectSettlesAt(player, () => creditAsks(player), [
			askFor(player, SHARED),
			askFor(player, "I Stay Away"),
		]);
		await expect(
			screen.getByRole("link", { name: OTHER, exact: true }),
		).toHaveCount(0);
		await expect(
			screen.getByRole("link", { name: LEAD, exact: true }),
		).toBeVisible();
	});

	test.describe("with the questions held", () => {
		test.use({ fooJean: { holdQuestions: true } });

		test("draw no link until the answer lands, then link each member", async ({
			page,
			player,
		}) => {
			await withNoListOnScreen(page);
			await playAtThePlayer(page, player, SHARED);
			await openNowPlaying(page);

			const screen = nowPlayingScreen(page);
			await expect(screen.locator("h1")).toContainText(SHARED);
			await expect
				.poll(() => creditAsks(player), {
					message: "the screen never asked who the playing track credits",
				})
				.toEqual([askFor(player, SHARED)]);
			await untilQuiet(player);
			await expect(
				screen.getByRole("link", { name: LEAD, exact: true }),
			).toHaveCount(0);
			await expect(
				screen.getByRole("link", { name: OTHER, exact: true }),
			).toHaveCount(0);

			await page.request.post("/__control/holdQuestions", {
				data: { hold: false },
			});
			await expect(
				screen.getByRole("link", { name: LEAD, exact: true }),
			).toBeVisible();
			await expect(
				screen.getByRole("link", { name: OTHER, exact: true }),
			).toBeVisible();
		});
	});

	test.describe("with splitting credits turned off", () => {
		test.use({ settings: { "jean.splitCredits": false } });

		test("ask the question as the setting says", async ({ page, player }) => {
			await withNoListOnScreen(page);
			await playAtThePlayer(page, player, SHARED);
			await openNowPlaying(page);
			await expect(nowPlayingScreen(page).locator("h1")).toContainText(SHARED);

			await expectSettlesAt(player, () => creditAsks(player), [
				askFor(player, SHARED, "false"),
			]);
		});
	});
});
