import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	requestsTo,
	statusBar,
	test,
	trackRow,
	withNoListOnScreen,
} from "./fixtures.ts";

// A player busy on its main thread does not refuse: it answers late, answers `504`
// once the component gives up waiting, or holds the connection open. These are
// the reads Jean keeps making all session, the poll and the covers, meeting each.

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

const coverReads = (player: FakePlayer) =>
	requestsTo(player, "/api/artwork").filter((one) => one.method === "GET");

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
	test("a poll the player holds open says it is reconnecting, and clears once the player answers again", async ({
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

	test("a poll the player answers 504 for a while catches up with what the player did meanwhile, and throws nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		const uncaught: string[] = [];
		page.on("pageerror", (error) => uncaught.push(error.message));
		await playFirstRow(page, isMobile);

		player.fooJean.failState = 504;
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
	test("a cover the player answered 504 for is drawn when it is next shown", async ({
		page,
		player,
	}) => {
		const { first, other, otherTitle } = twoRecords(player);
		await withNoListOnScreen(page);

		player.fooJean.failArtwork = 504;
		player.playItem("p7", first);
		await expect(statusBar(page)).toContainText("Los Calientes");
		await expect.poll(() => coverReads(player).length).toBeGreaterThan(0);
		await expect(statusBar(page).locator("[data-artwork]")).toHaveAttribute(
			"data-artwork",
			"failed",
		);

		player.fooJean.failArtwork = null;
		player.playItem("p7", other);
		await expect(statusBar(page)).toContainText(otherTitle);
		await expect(statusBarCover(page)).toBeVisible();

		player.playItem("p7", first);
		await expect(statusBar(page)).toContainText("Los Calientes");
		await expect(statusBarCover(page)).toBeVisible();
	});

	test("a cover the player holds open stops holding up the next one once it is off screen", async ({
		page,
		player,
	}) => {
		const { first, other, otherTitle } = twoRecords(player);
		await withNoListOnScreen(page);

		player.fooJean.hangArtwork = true;
		player.playItem("p7", first);
		await expect(statusBar(page)).toContainText("Los Calientes");
		await expect.poll(() => coverReads(player).length).toBeGreaterThan(0);

		player.fooJean.hangArtwork = false;
		player.playItem("p7", other);
		await expect(statusBar(page)).toContainText(otherTitle);
		await expect(statusBarCover(page)).toBeVisible();
	});
});
