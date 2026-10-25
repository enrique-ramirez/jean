import type { APIResponse } from "@playwright/test";
import {
	albumLabel,
	SCRATCH_KIND,
	scratchTitle,
} from "../../src/domain/track/jeanPlaylists.ts";
import { albumRoute } from "../../src/domain/track/routes.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectPlayingFrom,
	expectSettlesAt,
	HEADER_TILES_AT_MOST,
	holdRequests,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSidebar,
	scratchOf,
	sidebar,
	test,
	ticksTaken,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import {
	expectPendingRowsPlayByPosition,
	expectTheSetAskedOnce,
	holdRows,
	latestAnswer,
	mark,
	openHomeSettled,
	ordinalsOfSet,
	positionsNamed,
	recordLibraryTraffic,
	rowsAnswered,
	rowsAsked,
	titleAtOrdinal,
	untilRowsAreHeld,
} from "./libraryLists.ts";

const ARTIST = "Babasónicos";
const ALBUM = "Jessico";
const ROUTE = `#/${albumRoute(ARTIST, ALBUM)}`;

const openAlbum = async (page: Page, warmUp = openLibrary) => {
	await warmUp(page);
	await page.goto(`/${ROUTE}`);
	await expect(
		page.getByRole("heading", { level: 1, name: ALBUM }),
	).toBeVisible();
};

const albumRow = (page: Page) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(ALBUM, { exact: true }) })
		.getByRole("button")
		.first();

test.describe("an album is a place", () => {
	test("playing from it puts the record in the sidebar, under its own heading", async ({
		page,
		player,
	}) => {
		await openAlbum(page);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, ALBUM);
		expect(scratchOf(player)?.title).toBe(
			scratchTitle(SCRATCH_KIND.album, albumLabel(ARTIST, ALBUM)),
		);

		await page.goto("/#/home");
		await openSidebar(page);
		await expect(
			sidebar(page).getByText("Album", { exact: true }),
		).toBeVisible();
		await albumRow(page).click();

		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe(ROUTE);
	});

	test("the now-playing header takes you back to the record", async ({
		page,
	}) => {
		await openAlbum(page);
		await trackRow(page, 0).dblclick();
		await expectPlayingFrom(page, ALBUM);

		await page.goto("/#/home");
		await openNowPlaying(page);
		await nowPlayingScreen(page)
			.getByRole("button", { name: /Playing from/ })
			.click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe(ROUTE);
	});
});

type AlbumAnswer = { refs: Parameters<typeof ordinalsOfSet>[0] };

const askedRefs = async (answered: ReturnType<typeof recordLibraryTraffic>) =>
	ordinalsOfSet(
		(await latestAnswer<AlbumAnswer>(answered, "GET /api/library/album")).refs,
	);

const ordinalsOfTheAlbum = (player: FakePlayer) =>
	player
		.ordinalOrder()
		.flatMap((entry, ordinal) =>
			entry.track["%album%"] === ALBUM ? [ordinal] : [],
		);

const DRAWN_ROWS = 5;

const expectTheAlbumDrawn = async (page: Page, player: FakePlayer) => {
	const ordinals = ordinalsOfTheAlbum(player).slice(0, DRAWN_ROWS);
	for (const [index, ordinal] of ordinals.entries())
		await expect(trackRow(page, index)).toContainText(
			titleAtOrdinal(player, ordinal),
		);
};

// The library grows by a file beside its first track, which sorts before this record, so every
// ordinal of the album moves by one and an answer from before would draw its neighbours.
const growTheLibrary = async (
	page: Page,
	player: FakePlayer,
	before: number[],
) => {
	const structure = player.libraryFeed.structure;
	await page.request.post("/__control/library", { data: { add: 1 } });
	await expect
		.poll(() => player.libraryFeed.structure, {
			message: "the library never rebuilt",
		})
		.not.toBe(structure);
	const after = ordinalsOfTheAlbum(player);
	expect(after, "the album's ordinals did not move").not.toEqual(before);
	return after;
};

const sameSet = (one: number[], other: number[]) =>
	JSON.stringify([...one].sort((a, b) => a - b)) ===
	JSON.stringify([...other].sort((a, b) => a - b));

test.describe("an album's rows", () => {
	test("are asked once, by the ordinals its answer named, and nothing else of the library is read", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryTraffic(page);
		await openAlbum(page);
		const refs = await askedRefs(answered);
		expect(refs).toEqual(ordinalsOfTheAlbum(player));

		await expectTheSetAskedOnce(answered, player, refs);
		await expectTheAlbumDrawn(page, player);
	});

	// A library row is held once, by ordinal, whichever list asked for it. All Music's
	// first window holds every track of this library, so the album holds nothing it has to ask for.
	test("opened from All Music, asks for no rows All Music already holds", async ({
		page,
		player,
	}) => {
		const answered = recordLibraryTraffic(page);
		await openAllMusic(page);
		await expect(trackRow(page, 0)).toContainText(titleAtOrdinal(player, 0));
		await untilQuiet(player);

		const from = mark(answered, player);
		await page.evaluate((hash) => {
			location.hash = hash;
		}, ROUTE);
		await expect(
			page.getByRole("heading", { level: 1, name: ALBUM }),
		).toBeVisible();
		await expectTheAlbumDrawn(page, player);

		await expectSettlesAt(player, () => rowsAsked(player, from).length, 0);
	});

	// An answer at another structure names ordinals that now hold other tracks. The
	// fake answers a held question at whatever structure it holds when released, so the stale answer is
	// taken before the library moves and handed over after.
	test("drop an album answer the library has moved past, and are asked by the next one", async ({
		page,
		player,
	}) => {
		const stale: { answer?: APIResponse } = {};
		let handOver = () => {};
		const handedOver = new Promise<void>((resolve) => {
			handOver = resolve;
		});
		await page.route(
			(url) => url.pathname === "/api/library/album",
			async (route) => {
				if (stale.answer) return route.fallback();
				const answer = await route.fetch();
				// A question asked before the declaration is built is answered 202, and asked again.
				if (answer.status() === 200) {
					stale.answer = answer;
					await handedOver;
				}
				await route.fulfill({ response: answer });
			},
		);
		const answered = recordLibraryTraffic(page);
		await openAlbum(page);
		await expect.poll(() => stale.answer !== undefined).toBe(true);
		const held = (await stale.answer?.json()) as AlbumAnswer;
		const before = ordinalsOfSet(held.refs);

		const after = await growTheLibrary(page, player, before);
		const polled = ticksTaken(player);
		await expect.poll(() => ticksTaken(player)).toBeGreaterThan(polled);
		handOver();

		await expectTheAlbumDrawn(page, player);
		await expectSettlesAt(
			player,
			() =>
				rowsAnswered(answered).filter((body) =>
					sameSet(positionsNamed(body), after),
				).length,
			1,
		);
		expect(
			rowsAsked(player).filter((entry) =>
				sameSet(positionsNamed(entry.body), before),
			),
			"the rows of the answer the library moved past were asked",
		).toEqual([]);
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("draw as skeletons and play by their position in the album", async ({
			page,
			player,
			isMobile,
		}) => {
			const answered = recordLibraryTraffic(page);
			await openAlbum(page, (it) => openHomeSettled(it, player));
			const refs = await askedRefs(answered);
			await untilRowsAreHeld(player, refs);

			await expectPendingRowsPlayByPosition(page, player, isMobile, refs);
		});

		test("are asked again at the new structure when the library moves under them, and draw the album", async ({
			page,
			player,
		}) => {
			const answered = recordLibraryTraffic(page);
			await openAlbum(page, (it) => openHomeSettled(it, player));
			const before = await askedRefs(answered);
			await untilRowsAreHeld(player, before);

			const after = await growTheLibrary(page, player, before);

			await holdRows(page, false);
			await expectTheAlbumDrawn(page, player);

			const moved = String(player.libraryFeed.structure);
			const naming = (set: number[]) =>
				rowsAnswered(answered).filter(
					(body) =>
						String(body?.structure) === moved &&
						sameSet(positionsNamed(body), set),
				).length;
			await expectSettlesAt(player, () => naming(after), 1);
			expect(
				naming(before),
				"the old answer's ordinals were asked at the new structure",
			).toBe(0);
		});
	});
});

// The header's cover read is cancelled when the page under it goes, and a cancelled read is not a
// player that failed to answer: the next album's rows are asked at once, not after a failing hold.
const OTHER_ARTIST = "As Tall as Lions";
const OTHER_ALBUM = "Lafcadio";

// `GET /api/state`'s poll, which is what a failing hold waits for.
const ONE_POLL_MS = 1000;
const POLL_SLACK_MS = 1500;

const rowsBodyOf = (request: {
	method: () => string;
	url: () => string;
	postDataJSON: () => unknown;
}) =>
	request.method() === "POST" &&
	new URL(request.url()).pathname === "/api/library/rows"
		? (request.postDataJSON() as { ordinals?: number[] } | null)
		: null;

test.describe("leaving an album while its header's covers are read", () => {
	test("asks for the next album's rows within one poll, and draws them", async ({
		page,
		player,
	}) => {
		const tileRead = await holdRequests(
			page,
			(request) => {
				const ordinals = rowsBodyOf(request)?.ordinals;
				return (
					Array.isArray(ordinals) && ordinals.length <= HEADER_TILES_AT_MOST
				);
			},
			{ count: 1 },
		);
		await openAlbum(page);
		await expectTheAlbumDrawn(page, player);
		await tileRead.untilHeld();

		const theirs = player
			.ordinalOrder()
			.flatMap((entry, ordinal) =>
				entry.track["%album%"] === OTHER_ALBUM ? [ordinal] : [],
			);
		const asked = page.waitForRequest(
			(request) =>
				rowsBodyOf(request)?.ordinals?.includes(theirs[0]) === true &&
				(rowsBodyOf(request)?.ordinals?.length ?? 0) > HEADER_TILES_AT_MOST,
			{ timeout: ONE_POLL_MS + POLL_SLACK_MS },
		);
		await page.goto(`/#/${albumRoute(OTHER_ARTIST, OTHER_ALBUM)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: OTHER_ALBUM }),
		).toBeVisible();
		await expect
			.poll(() => tileRead.caught[0].failure()?.errorText ?? null, {
				message: "leaving the album never cancelled its header's cover read",
			})
			.not.toBeNull();
		tileRead.releaseAll();

		await asked;
		await expect(trackRow(page, 0)).toContainText(
			titleAtOrdinal(player, theirs[0]),
		);
	});
});
