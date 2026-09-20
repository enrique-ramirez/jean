import type { FakePlayer, Page } from "./fixtures.ts";
import {
	coversFromBeefweb,
	coversFromTheComponent,
	expect,
	expectSettlesAt,
	FOO_JEAN_TOKEN,
	listenHere,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	test,
	touchDrag,
	trackRow,
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
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		const current = wheel(page).locator("[data-current]");
		await expect(current.locator(".loading")).toBeVisible();
		await expect(nowPlayingScreen(page).locator("h1")).not.toHaveText(
			"Nothing playing",
		);

		await expect(current.locator("img")).toBeVisible();
		expect(await detents(page)).toBe(-1);
	});

	test("under Default it turns straight onto the next sleeve, with no hold at all", async ({
		page,
	}) => {
		await playRow(page, 0);
		await page.request.post("/__control/skipGap", { data: { ms: 700 } });

		await across(page, 0.85, 0.25);

		const current = wheel(page).locator("[data-current]");
		await expect(current.locator("img")).toBeVisible();
		await expect(current.locator(".loading")).toHaveCount(0);
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

// beefweb addresses a cover by a playlist and a row, and Jean addresses a
// playlist by the GUID the component issues, which beefweb cannot resolve. So
// the sleeves either side come from the component by library path until 013
// brings a positional address back.
test.describe("the sleeves either side of the playing row", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the wheel is the phone's skip gesture",
	);
	// Nothing may scroll the list behind the screen onto the rows asserted on
	// below: a row the list mounts asks for its own cover at the same address,
	// and the wheel's request would stop being the one being read.
	test.use({ motion: "allow", settings: { "jean.followPlayback": false } });

	// Far enough down the playing playlist that the list behind the screen has
	// never mounted this row or the one after it.
	const FAR_FROM_THE_TOP = { row: 20, title: "Guernica" };

	test("come from the component, addressed by that row's library path", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		await expect(currentSleeve(page)).toHaveAttribute("data-artwork", "ok");
		const { playlistId } = player.player.activeItem;
		player.requests.length = 0;

		player.playItem(playlistId, FAR_FROM_THE_TOP.row);

		// Jean's own view of the row, not the player's. Nothing pushes the playing
		// position, so a swipe sent the moment the player moves turns the wheel
		// from a centre Jean has never been on, and a person cannot swipe at a row
		// the screen has not drawn yet either.
		await expect(nowPlayingScreen(page).locator("h1")).toContainText(
			FAR_FROM_THE_TOP.title,
		);

		// Asked for before the turn, which is what a neighbour is for: a sleeve
		// fetched at the moment of the swipe arrives a frame late and the swipe
		// lands on an empty slot. Nothing else on screen has been near this row,
		// so this names the wheel's own request.
		await expect
			.poll(() => coversFromTheComponent(player))
			.toContain(
				libraryPathOfRow(player, playlistId, FAR_FROM_THE_TOP.row + 1),
			);

		await across(page, 0.85, 0.25);
		await expect
			.poll(() => player.player.activeItem.index)
			.toBe(FAR_FROM_THE_TOP.row + 1);
		await expect(currentSleeve(page)).toHaveAttribute("data-artwork", "ok");

		await expectSettlesAt(player, () => coversFromBeefweb(player), []);
	});

	// A playlist of files the media library has never seen: the component has no
	// library path to name either neighbour by, and there is no second address
	// left to fall back on.
	test.describe("where the media library carries neither of them", () => {
		test.use({ mediaLibrarySize: 12 });

		const ROW_WITH_A_NEIGHBOUR_EITHER_SIDE = 1;

		test("draw no cover, and ask for none", async ({ page, player }) => {
			await openLibrary(page);
			await page.request.post("/__control/play", {
				data: { playlistId: "p1", index: ROW_WITH_A_NEIGHBOUR_EITHER_SIDE },
			});
			await expect
				.poll(() => player.player.activeItem.index)
				.toBe(ROW_WITH_A_NEIGHBOUR_EITHER_SIDE);
			await openNowPlaying(page);

			await expect(currentSleeve(page)).toHaveAttribute("data-artwork", "ok");
			expect(
				libraryPathOfRow(player, "p1", ROW_WITH_A_NEIGHBOUR_EITHER_SIDE + 1),
				"the media library carries the next row, so the case is not set up",
			).toBeNull();

			// The centre alone. A neighbour with no library path has no address, and
			// an address built from an empty path is a 400 rather than a cover.
			await expect(drawnSleeves(page)).toHaveCount(1);
			await expectSettlesAt(player, () => coversFromBeefweb(player), []);
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
		fooJeanToken: FOO_JEAN_TOKEN,
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
		await expect(nowPlayingScreen(page).locator("h1.loading")).toBeVisible();

		await page.waitForTimeout(6000);
		expect(await detents(page)).toBe(-1);

		await expect(title).not.toHaveText(String(leaving), { timeout: 60_000 });
		await expect(nowPlayingScreen(page).locator("h1.loading")).toHaveCount(0, {
			timeout: 60_000,
		});
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
