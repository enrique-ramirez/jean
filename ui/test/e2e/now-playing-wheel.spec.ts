import type { FakePlayer, Page } from "./fixtures.ts";
import {
	coversByPosition,
	coversFromTheComponent,
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	inSequence,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	statusBar,
	test,
	touchDrag,
	trackRow,
	untilQuiet,
	withNoListOnScreen,
} from "./fixtures.ts";
import { playRow } from "./nowPlaying.ts";

const wheel = (page: Page) =>
	nowPlayingScreen(page).locator("[data-cover-wheel]");

// The slots with a picture on them, which at rest is the centre and whichever
// neighbour the wheel could resolve a cover for.
const drawnSleeves = (page: Page) => wheel(page).locator("[data-artwork='ok']");

const currentSleeve = (page: Page) =>
	wheel(page).locator("[data-current] [data-artwork]");

// The library path the component answers for one row of a playlist, read off
// the player rather than composed here.
const libraryPathOfRow = (
	player: FakePlayer,
	playlistId: string,
	row: number,
) => {
	const playlist = player.playlists.find((entry) => entry.id === playlistId);
	const track = playlist?.items[row];
	if (!track) throw new Error(`no row ${row} in ${playlistId}`);
	return player.libraryPathFor(track);
};

// The library-relative address a record's cover is asked at, which is its first track in album
// order. Jar Of Flies is the Default Playlist's first four rows; Deja Entendu runs through the
// middle of the captured Library playlist.
const JAR_OF_FLIES_COVER =
	"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac";
const DEJA_ENTENDU_COVER = "B/Brand New/(2003) Deja Entendu/01. Tautou.mp3";

// Every cover address asked for, on either server: one request log carries both, and what these
// cases turn on is how few addresses were asked at all.
const coverAddresses = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "GET" && entry.path.startsWith("/api/artwork"),
		)
		.map((entry) => entry.path);

const detents = (page: Page) =>
	wheel(page).evaluate((el) => {
		const step = Number.parseFloat(
			getComputedStyle(el).getPropertyValue("--step"),
		);
		const turn = Number.parseFloat(el.style.getPropertyValue("--turn"));
		return Number.isFinite(turn) && step ? turn / step : null;
	});

const settled = (page: Page) =>
	nowPlayingScreen(page).evaluate(async (el) => {
		await Promise.all(el.getAnimations().map((entry) => entry.finished));
	});

const across = async (page: Page, from: number, to: number) => {
	await settled(page);
	const box = (await nowPlayingScreen(page).boundingBox())!;
	const y = box.y + box.height * 0.4;
	await touchDrag(
		page,
		{ x: box.x + box.width * from, y },
		{ x: box.x + box.width * to, y },
	);
};

test.describe("the cover wheel", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	test.use({ motion: "allow" });

	test("a flick turns the rim by one sleeve", async ({ page, player }) => {
		await playRow(page, 0);
		expect(await detents(page)).toBe(0);

		await across(page, 0.85, 0.25);
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(-1);

		await across(page, 0.25, 0.85);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(0);
	});

	test("Previous turns the rim back, whoever pressed it", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(1);

		// Reaching the player without going through this screen or `useTransport`,
		// so nothing turned the wheel and all it is told is that a track changed.
		// The player never says which way it moved, so the direction is read off
		// what was asked of it.
		await page.keyboard.press("ControlOrMeta+ArrowRight");
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(0);

		await page.keyboard.press("ControlOrMeta+ArrowLeft");
		await expect.poll(() => player.player.activeItem.index).toBe(0);
		await expect.poll(() => detents(page)).toBe(1);
	});

	test("a track ending by itself goes forward, not back", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		await settled(page);

		// A skip that was asked for and never answered must not leave its
		// direction lying around for the next track that ends of its own
		// accord to pick up.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Previous track" })
			.click();
		await expect.poll(() => detents(page)).toBe(1);

		player.next();
		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect.poll(() => detents(page)).toBe(0);
	});

	test("the sleeve is still there after the screen has been dismissed and reopened", async ({
		page,
	}) => {
		await playRow(page, 0);
		await settled(page);
		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await openNowPlaying(page);

		await expect.poll(() => detents(page)).toBe(-1);
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		const box = (await current.locator("img").boundingBox())!;
		const screen = (await nowPlayingScreen(page).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(screen.x - 1);
		expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
	});

	test("a drag that does not get far enough springs back and skips nothing", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		await across(page, 0.5, 0.44);
		await expect.poll(() => detents(page)).toBe(0);
		expect(player.player.activeItem.index).toBe(0);
	});

	test("every slot holds the same way, sleeve or no sleeve", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		await expect(wheel(page).locator("[data-artwork]")).toHaveCount(3);
		await expect(
			wheel(page).locator('[data-artwork="waiting"]').first(),
		).toBeVisible();
	});

	test("what it turns to is a hold, where the next sleeve cannot be known", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);
		await page.request.post("/__control/skipDelay", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		// The hold is a centre with no picture on it and no name under it, rather
		// than "Nothing playing" or the track that was left.
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toHaveCount(0);
		await expect(nowPlayingScreen(page).locator("h1")).toHaveText("");

		await expect(current.locator("img")).toBeVisible();
		expect(await detents(page)).toBe(-1);
	});

	const SKIP_DELAY_MS = 2000;

	test("under Default it turns straight onto the next sleeve, with no hold at all", async ({
		page,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipDelay", {
			data: { ms: SKIP_DELAY_MS },
		});

		await across(page, 0.85, 0.25);

		// A hold leaves the centre bare until the skip lands, so the sleeve has to
		// be there well inside the delay; a retrying read given the whole delay
		// would wait a hold out and pass.
		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible({
			timeout: SKIP_DELAY_MS / 2,
		});
	});

	// The last of Jessico in the library, so the sleeve it turns onto is another
	// record's, held by the neighbour slot alone.
	const LAST_OF_A_RECORD = 11;

	test("under Default the sleeve it turns onto stays drawn, and is not asked for again", async ({
		page,
		player,
	}) => {
		const asks: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/api/artwork")) asks.push(request.url());
		});

		await playRow(page, LAST_OF_A_RECORD);
		await expect(drawnSleeves(page)).toHaveCount(3);
		await untilQuiet(player);
		const before = new Set(asks.splice(0));

		await page.evaluate(() => {
			const turning = document.querySelector("[data-cover-wheel]");
			if (!turning) throw new Error("no cover wheel");
			const record = window as unknown as { bareFrames: number };
			record.bareFrames = 0;
			new MutationObserver(() => {
				if (!turning.querySelector("[data-current] [data-artwork] img"))
					record.bareFrames += 1;
			}).observe(turning, { subtree: true, childList: true, attributes: true });
		});
		await page.request.post("/__control/skipDelay", {
			data: { ms: SKIP_DELAY_MS },
		});

		await across(page, 0.85, 0.25);
		await expect
			.poll(() => player.player.activeItem.index)
			.toBe(LAST_OF_A_RECORD + 1);
		await expect(currentSleeve(page)).toHaveAttribute("data-artwork", "ok");
		await untilQuiet(player);

		expect(
			await page.evaluate(
				() => (window as unknown as { bareFrames: number }).bareFrames,
			),
			"the centre dropped its picture on the way",
		).toBe(0);
		expect(asks.filter((url) => before.has(url))).toEqual([]);
	});

	test("a turn nothing answers is put back", async ({ page, player }) => {
		await openLibrary(page);
		await page.request.post("/__control/play", {
			data: { playlistId: "p1", index: 3 },
		});
		await expect.poll(() => player.player.activeItem.index).toBe(3);
		await openNowPlaying(page);
		player.patchPlayer({ options: [{ id: "playbackOrder", value: 4 }] });

		await expect(nowPlayingScreen(page).locator("h1")).not.toHaveText(
			"Nothing playing",
		);

		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await expect.poll(() => detents(page), { timeout: 10_000 }).toBe(0);
		expect(player.player.activeItem.index).toBe(3);
	});
});

// One record is one address and one request, on a playing surface as much as on a
// list. `/api/artwork/playing` names a different picture as soon as the track changes, so a cover
// keyed by the track is fetched afresh for every track of the record, and nothing the browser
// already holds can answer for the next one.
test.describe("an album played through", () => {
	// The Default Playlist is one record's first four tracks, in album order.
	const TITLES = ["Rotten Apple", "Nutshell", "I Stay Away", "No Excuses"];

	const playAtThePlayer = async (
		page: Page,
		player: FakePlayer,
		row: number,
	) => {
		await page.request.post("/__control/play", {
			data: { playlistId: "p1", index: row },
		});
		await expect.poll(() => player.player.activeItem.index).toBe(row);
	};

	const statusBarSleeve = (page: Page) =>
		statusBar(page).locator("[data-artwork]");

	// The sleeve the screen puts in front of a person: the wheel's centre slot on
	// a phone, the one large cover on a desktop.
	const screenSleeve = (page: Page, isMobile: boolean) =>
		isMobile
			? currentSleeve(page)
			: nowPlayingScreen(page).locator("[data-artwork]");

	test("costs the status bar one cover, at the record's own address", async ({
		page,
		player,
	}) => {
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, 0);
		await expect(statusBarSleeve(page)).toHaveAttribute("data-artwork", "ok");

		await inSequence([1, 2, 3], async (row: number) => {
			await playAtThePlayer(page, player, row);
			await expect(statusBar(page)).toContainText(TITLES[row]);
		});
		await expect(statusBarSleeve(page)).toHaveAttribute("data-artwork", "ok");

		await expectSettlesAt(player, () => coversFromTheComponent(player), [
			JAR_OF_FLIES_COVER,
		]);
		expect(coverAddresses(player)).toHaveLength(1);
	});

	test("and the now-playing screen draws the record's sleeve without asking again", async ({
		page,
		player,
		isMobile,
	}) => {
		await withNoListOnScreen(page);
		await playAtThePlayer(page, player, 1);
		await expect(statusBarSleeve(page)).toHaveAttribute("data-artwork", "ok");

		await openNowPlaying(page);
		await expect(screenSleeve(page, isMobile)).toHaveAttribute(
			"data-artwork",
			"ok",
		);

		// On a phone the screen is the wheel, whose neighbours are this record's
		// other rows: they share the address rather than adding two of their own.
		await expectSettlesAt(player, () => coversFromTheComponent(player), [
			JAR_OF_FLIES_COVER,
		]);
		expect(coverAddresses(player)).toHaveLength(1);
	});
});

test.describe("the sleeves either side of the playing row", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	test.use({ motion: "allow" });

	// The ninth track of a record that sits in the middle of the Library playlist, so the row either
	// side of it belongs to the same record.
	const PLAYING = { row: 20, title: "Guernica" };

	// The neighbour a swipe is about to land on is a row of the same
	// record nine times out of ten, so it is asked for at that record's address
	// rather than at its own, and the swipe costs nothing.
	test("come from the component, at the address their record's cover has everywhere", async ({
		page,
		player,
	}) => {
		// Driven at the player, over no list: only an address nothing has been near
		// yet is certain to be seen here, for the reason `withNoListOnScreen` gives.
		await withNoListOnScreen(page);
		await page.request.post("/__control/play", {
			data: { playlistId: "p7", index: PLAYING.row },
		});
		await expect.poll(() => player.player.activeItem.index).toBe(PLAYING.row);
		await openNowPlaying(page);

		// Jean's own view of the row, not the player's: a person cannot swipe at a
		// row the screen has not drawn yet.
		await expect(nowPlayingScreen(page).locator("h1")).toContainText(
			PLAYING.title,
		);

		// Drawn before the turn, which is what a neighbour is for: a sleeve fetched
		// at the moment of the swipe arrives a frame late and the swipe lands on an
		// empty slot.
		await expect(drawnSleeves(page)).toHaveCount(3);

		// One address between the centre and both neighbours, and it is the record's. The set of
		// distinct addresses rather than a count of asks: a repeat of an address already fetched is
		// invisible here by design, while a neighbour addressed by its own row would be an address
		// nothing has asked for and would have to arrive.
		await expectSettlesAt(
			player,
			() => [...new Set(coversFromTheComponent(player))],
			[DEJA_ENTENDU_COVER],
		);

		await across(page, 0.85, 0.25);
		await expect
			.poll(() => player.player.activeItem.index)
			.toBe(PLAYING.row + 1);
		await expect(currentSleeve(page)).toHaveAttribute("data-artwork", "ok");

		// The row the swipe landed on is the tenth track of that record, and its
		// own path is an address none of this went near.
		expect(coversFromTheComponent(player)).not.toContain(
			libraryPathOfRow(player, "p7", PLAYING.row + 1),
		);
	});

	// A playlist of files the media library has never seen: the
	// component has no library path to name either neighbour by, so it is asked
	// for the picture at the row it sits on instead.
	// Retagged so that each neighbour is a record of its own. A neighbour on the centre's record
	// shares the centre's picture, and whether it is asked for at all then turns on which of the
	// two arrives first.
	test.describe("where the media library carries neither of them", () => {
		test.use({
			mediaLibrarySize: 12,
			retagged: {
				"Rotten Apple": { "%album%": "Rotten Apple" },
				"I Stay Away": { "%album%": "I Stay Away" },
			},
		});

		const ROW_WITH_A_NEIGHBOUR_EITHER_SIDE = 1;

		test("are drawn from the playlist row each of them sits on", async ({
			page,
			player,
		}) => {
			await withNoListOnScreen(page);
			await page.request.post("/__control/play", {
				data: { playlistId: "p1", index: ROW_WITH_A_NEIGHBOUR_EITHER_SIDE },
			});
			await expect
				.poll(() => player.player.activeItem.index)
				.toBe(ROW_WITH_A_NEIGHBOUR_EITHER_SIDE);
			await openNowPlaying(page);

			expect(
				libraryPathOfRow(player, "p1", ROW_WITH_A_NEIGHBOUR_EITHER_SIDE + 1),
				"the media library carries the next row, so the case is not set up",
			).toBeNull();

			// Every slot with a picture on it, the centre and both neighbours, so a
			// swipe either way lands on a sleeve rather than on a hold.
			await expect(drawnSleeves(page)).toHaveCount(3);

			// Both neighbours, and no claim either way about the centre: that one
			// already has `/api/artwork/playing` to reach for, and which of the two
			// addresses it takes is not this case's to settle.
			const guid = guidOfPlaylist(player, "p1");
			await expect
				.poll(() => coversByPosition(player))
				.toEqual(
					expect.arrayContaining([
						`${guid}/${ROW_WITH_A_NEIGHBOUR_EITHER_SIDE - 1}`,
						`${guid}/${ROW_WITH_A_NEIGHBOUR_EITHER_SIDE + 1}`,
					]),
				);

			await untilQuiet(player);
			expect(coversFromTheComponent(player)).not.toContain("");
		});
	});
});

test.describe("the wheel while the sound is a stream", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	// Six seconds of lag, which is longer than the wheel waits before putting an unanswered turn back.
	test.use({
		motion: "allow",
		fooJean: { streamPrime: 6 },
	});
	test.setTimeout(120_000);

	test("holds the identity until the sound arrives, and never pairs it with the wrong sleeve", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await listenHere(page);
		await openNowPlaying(page);

		const title = nowPlayingScreen(page).locator("h1");
		const leaving = await title.textContent();

		await across(page, 0.85, 0.25);
		await expect.poll(() => detents(page)).toBe(-1);

		await expect(title).not.toHaveText(String(leaving));
		await expect(title).toHaveText("");

		await page.waitForTimeout(6000);
		expect(await detents(page)).toBe(-1);

		await expect(title).not.toHaveText(String(leaving), { timeout: 60_000 });
		await expect(title).not.toHaveText("", { timeout: 60_000 });
	});
});

test.describe("the wheel where motion is refused", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);

	test("does not turn, and swaps the sleeve instead", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		await across(page, 0.85, 0.25);

		await expect.poll(() => player.player.activeItem.index).toBe(1);
		await expect(wheel(page)).toHaveCSS("transform", "none");
		await expect(wheel(page).locator("[data-current]")).toHaveCSS(
			"opacity",
			"1",
		);
	});
});
