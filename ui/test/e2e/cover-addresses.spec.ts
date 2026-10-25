import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { RUN_ROLES } from "../fake-api/fooJean/libraryRuns.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	coversByPosition,
	coversFromTheComponent,
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	holdingJeansDeclaration,
	listenHere,
	nowPlayingScreen,
	openNowPlaying,
	requestsTo,
	statusBar,
	test,
	withNoListOnScreen,
} from "./fixtures.ts";
import { openQueue, queueRows } from "./queue.ts";

// A record's cover is asked at one address on every screen, its cover
// track's library path, and these are the surfaces that draw a row the media library holds without
// drawing the library: the playing surfaces, a queued row, a playlist row and a now-playing
// neighbour. Every case starts on a player already holding Jean's declaration and holds the whole
// library open, so that address can only come from what the surface read for itself: the run
// holding the playing track's ordinal, or the `cover` a queue or playlist answer carries beside a
// row's `libraryPath`. Every case draws a track that is not its record's cover track, so the row's
// own path and its record's address differ.

const JAR_OF_FLIES_COVER =
	"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac";
const DEJA_ENTENDU_COVER = "B/Brand New/(2003) Deja Entendu/01. Tautou.mp3";
const JESSICO_COVER = "B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3";

const recordsAsked = (player: FakePlayer) =>
	[...new Set(coversFromTheComponent(player))].sort();

const playingCoverAsks = (player: FakePlayer) =>
	requestsTo(player, "/api/artwork/playing");

const trackOf = (player: FakePlayer, playlistId: string, row: number) => {
	const track = player.playlistById(playlistId)?.items[row];
	if (!track) throw new Error(`no row ${row} in ${playlistId}`);
	return track;
};

const expectNotItsRecordsCover = (
	player: FakePlayer,
	playlistId: string,
	row: number,
	cover: string,
) => {
	const path = player.libraryPathFor(trackOf(player, playlistId, row));
	expect(
		path,
		"the media library does not hold this row, so the case is not set up",
	).toBeTruthy();
	expect(
		path,
		"this row is its record's cover track, so its own path cannot be told apart",
	).not.toBe(cover);
};

const playAtThePlayer = async (
	page: Page,
	player: FakePlayer,
	playlistId: string,
	row: number,
) => {
	await page.request.post("/__control/play", {
		data: { playlistId, index: row },
	});
	await expect.poll(() => player.player.activeItem.index).toBe(row);
};

test.beforeEach(({ player }) => holdingJeansDeclaration(player));

const lockScreenPicture = (page: Page) =>
	page.evaluate(
		() => navigator.mediaSession.metadata?.artwork?.[0]?.src ?? null,
	);

// Over no list throughout: a list of tracks asks for every record's cover in it, and a cover asked
// for once is answered inside the browser after that, so only a page drawing none shows which
// address a surface reached for.
test.describe("the playing record's sleeve", () => {
	const PLAYING = { playlist: "p1", row: 1, title: "Nutshell" };

	test("the status bar and the now-playing screen ask for it at the record's own address, and never at the playing cover's", async ({
		page,
		player,
		isMobile,
	}) => {
		expectNotItsRecordsCover(
			player,
			PLAYING.playlist,
			PLAYING.row,
			JAR_OF_FLIES_COVER,
		);
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, PLAYING.playlist, PLAYING.row);
		await expect(statusBar(page)).toContainText(PLAYING.title);
		await expect(statusBar(page).locator("[data-artwork]")).toHaveAttribute(
			"data-artwork",
			"ok",
		);

		await openNowPlaying(page);
		const sleeve = isMobile
			? nowPlayingScreen(page).locator(
					"[data-cover-wheel] [data-current] [data-artwork]",
				)
			: nowPlayingScreen(page).locator("[data-artwork]");
		await expect(sleeve).toHaveAttribute("data-artwork", "ok");

		// On a phone the wheel's neighbours are this record's other rows, so they share the address.
		await expectSettlesAt(player, () => recordsAsked(player), [
			JAR_OF_FLIES_COVER,
		]);
		expect(playingCoverAsks(player)).toEqual([]);
	});

	test("the lock screen carries the picture asked for at the record's own address", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, PLAYING.playlist, PLAYING.row);
		await listenHere(page);

		await expect
			.poll(() => lockScreenPicture(page))
			.toMatch(/^data:image\/jpeg;base64,/);

		await expectSettlesAt(player, () => recordsAsked(player), [
			JAR_OF_FLIES_COVER,
		]);
		expect(playingCoverAsks(player)).toEqual([]);
	});
});

test.describe("a queued row's sleeve", () => {
	const QUEUED = { playlist: "p2", row: 1 };

	test("is asked at the cover the queue's answer names, which the queue was asked for by Jean's roles", async ({
		page,
		player,
	}) => {
		expectNotItsRecordsCover(
			player,
			QUEUED.playlist,
			QUEUED.row,
			DEJA_ENTENDU_COVER,
		);
		await withNoListOnScreen(page);
		await openQueue(page);

		player.queueInsert([
			{
				playlistId: QUEUED.playlist,
				track: trackOf(player, QUEUED.playlist, QUEUED.row),
			},
		]);
		await expect(queueRows(page)).toHaveCount(1);
		await expect(
			queueRows(page).first().locator("[data-artwork]"),
		).toHaveAttribute("data-artwork", "ok");

		await expectSettlesAt(player, () => recordsAsked(player), [
			DEJA_ENTENDU_COVER,
		]);
		expect(coversByPosition(player)).toEqual([]);

		// `cover` is answered only to a read naming the roles that place a row in its record.
		const read = requestsTo(player, "/api/queue")
			.filter((entry) => entry.method === "GET")
			.at(-1);
		expect(read, "the queue was never read").toBeDefined();
		const named = new URL(read?.path ?? "", "http://fake").searchParams;
		expect(
			Object.fromEntries(RUN_ROLES.map((role) => [role, named.get(role)])),
		).toEqual(
			Object.fromEntries(
				RUN_ROLES.map((role) => [role, TRACK_EXPRESSIONS[FIELD[role]]]),
			),
		);
	});
});

test.describe("a playlist row's sleeve", () => {
	// The Default Playlist seeded from its second row: it begins on Jar Of Flies' second track and
	// never holds the record's cover track.
	test.use({ playlistsFromRow: { p1: 1 } });

	test("is asked at the cover the playlist's answer names, a track the playlist does not hold", async ({
		page,
		player,
	}) => {
		await page.goto(`/#/${guidOfPlaylist(player, "p1")}`);
		await expect(page.locator('main [role="row"]').first()).toBeAttached();
		await expect(
			page.locator("main [data-artwork='ok']").first(),
		).toBeVisible();

		await expectSettlesAt(player, () => recordsAsked(player), [
			JAR_OF_FLIES_COVER,
		]);
	});
});

test.describe("a now-playing neighbour's sleeve", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	test.use({ motion: "allow" });

	// Deja Entendu's first track, in the Library playlist. The row before it is Jessico's last,
	// another record whose cover track is another row.
	const PLAYING = { playlist: "p7", row: 12, title: "Tautou" };

	test("the row before the playing record is asked at its own record's address, which the playlist's answer names", async ({
		page,
		player,
	}) => {
		expectNotItsRecordsCover(
			player,
			PLAYING.playlist,
			PLAYING.row - 1,
			JESSICO_COVER,
		);
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, PLAYING.playlist, PLAYING.row);
		await openNowPlaying(page);
		await expect(nowPlayingScreen(page).locator("h1")).toContainText(
			PLAYING.title,
		);

		await expect(
			nowPlayingScreen(page).locator("[data-cover-wheel] [data-artwork='ok']"),
		).toHaveCount(3);

		await expectSettlesAt(
			player,
			() => recordsAsked(player),
			[JESSICO_COVER, DEJA_ENTENDU_COVER].sort(),
		);
	});
});
