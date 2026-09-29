import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	guidOfPlaylist,
	openLibrary,
	requestsTo,
	statusBar,
	test,
	trackRow,
	withNoListOnScreen,
} from "./fixtures.ts";

// The reads Jean keeps making all session, the poll and the covers, meeting the
// ways each one really fails. `foo_jean` answers the poll from its own store, so
// it is refused only by the rate limiter and held open only by the network. A
// library cover is read from disk on the connection thread with no timeout, so
// it can hang; a playlist row's cover waits on foobar2000's main thread and
// answers `504` once `foo_jean` gives up waiting.

const RECONNECTING = en["connection.reconnecting"];

const notice = (page: Page) =>
	page.getByRole("status").filter({ hasText: RECONNECTING });

const playFirstRow = async (page: Page, isMobile: boolean) => {
	await openLibrary(page);
	if (isMobile) await trackRow(page, 0).tap();
	else await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");
};

const statusBarCover = (page: Page) =>
	statusBar(page).locator("[data-artwork='ok'] img");

const libraryCoverReads = (player: FakePlayer) =>
	requestsTo(player, "/api/artwork?track=").filter(
		(one) => one.method === "GET",
	);

// The first track of the library playlist, and the first after it on another
// record, so moving between them changes the cover the status bar asks for.
const twoRecords = (player: FakePlayer) => {
	const rows = player.playlists.find((entry) => entry.id === "p7")!.items;
	const other = rows.findIndex(
		(track) => track["%album%"] !== rows[0]["%album%"],
	);
	return { first: 0, other, otherTitle: rows[other]["%title%"] };
};

test.describe("the poll meeting a player that does not answer", () => {
	test("a poll the network never answers says it is reconnecting, and clears once answers arrive again", async ({
		page,
		player,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);

		player.fooJean.hangState = true;
		await expect(notice(page)).toBeVisible();

		player.playItem("p7", 1);
		player.fooJean.hangState = false;

		await expect(notice(page)).toHaveCount(0);
		await expect(statusBar(page)).toContainText("Fizz");
	});

	test("a poll the player refuses for a while catches up with what the player did meanwhile, and throws nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		const uncaught: string[] = [];
		page.on("pageerror", (error) => uncaught.push(error.message));
		await playFirstRow(page, isMobile);

		player.fooJean.failState = 429;
		const refusedFrom = requestsTo(player, "/api/state").length;
		await expect
			.poll(() => requestsTo(player, "/api/state").length)
			.toBeGreaterThan(refusedFrom + 1);

		player.playItem("p7", 1);
		player.fooJean.failState = null;

		await expect(statusBar(page)).toContainText("Fizz");
		expect(uncaught).toEqual([]);
	});
});

test.describe("covers meeting a player that does not answer", () => {
	test("a cover the player holds open stops holding up the next one once it is off screen", async ({
		page,
		player,
	}) => {
		const { first, other, otherTitle } = twoRecords(player);
		await withNoListOnScreen(page);

		player.fooJean.hangArtwork = true;
		player.playItem("p7", first);
		await expect(statusBar(page)).toContainText("Los Calientes");
		await expect
			.poll(() => libraryCoverReads(player).length)
			.toBeGreaterThan(0);

		player.fooJean.hangArtwork = false;
		player.playItem("p7", other);
		await expect(statusBar(page)).toContainText(otherTitle);
		await expect(statusBarCover(page)).toBeVisible();
	});
});

// A row for a file the media library has never seen, whose cover only the
// playlist and the position can address.
test.describe("a playlist row's cover meeting a player that does not answer", () => {
	test.use({ mediaLibrarySize: 12, settings: { "jean.layout": "compact" } });

	const ROW = 1;

	const rowCover = (page: Page) =>
		page.locator(`[role="row"][data-row="${ROW}"] [data-artwork]`);

	test("a cover the player answered 504 for is drawn when it is next shown", async ({
		page,
		player,
	}) => {
		const guid = guidOfPlaylist(player, "p1");
		expect(
			player.libraryPathFor(player.playlistById("p1")!.items[ROW]),
			"the media library carries this row, so the case is not set up",
		).toBeNull();

		player.fooJean.failRowArtwork = 504;
		await page.goto(`/#/${guid}`);
		await expect(rowCover(page)).toHaveAttribute("data-artwork", "failed");
		expect(
			requestsTo(player, `/api/artwork/playlists/${guid}/`).length,
		).toBeGreaterThan(0);

		player.fooJean.failRowArtwork = null;
		await page.goto(`/#/${guidOfPlaylist(player, "p2")}`);
		await expect(page.locator('[role="row"]').first()).toBeAttached();
		await page.goto(`/#/${guid}`);
		await expect(rowCover(page)).toHaveAttribute("data-artwork", "ok");
	});
});
