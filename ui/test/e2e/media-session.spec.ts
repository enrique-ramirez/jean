import {
	expect,
	listenHere,
	openLibrary,
	type Page,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

const play = async (page: Page) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
};

// A row further down the same playlist, far enough along that both the title
// and the artist move with it.
const ANOTHER_ARTIST = { row: 12, title: "Tautou", artist: "Brand New" };

// By its name rather than by its role: the row is a button only where pressing it
// would do something, which here it does -- this device is the only listener.
const thePlayer = (page: Page) =>
	page
		.getByRole("group", { name: "Playing on" })
		.getByText("foobar2000", { exact: true });

const session = (page: Page) =>
	page.evaluate(() => {
		const [cover] = navigator.mediaSession.metadata?.artwork ?? [];
		return {
			state: navigator.mediaSession.playbackState,
			title: navigator.mediaSession.metadata?.title ?? null,
			artist: navigator.mediaSession.metadata?.artist ?? null,
			album: navigator.mediaSession.metadata?.album ?? null,
			artwork: cover?.src ?? null,
			// What the operating system picks a size by. Declared or it has to decode
			// every entry to find out what it was handed.
			sizes: cover?.sizes ?? null,
			type: cover?.type ?? null,
		};
	});

// Roughly the longest edge the lock screen is handed, from `LOCK_SCREEN_MAX_EDGE` in
// `src/app/useMediaSession.ts`. A picture already smaller than this is passed at its own size
// rather than scaled up, so this is a ceiling and never an expected value.
const LOCK_SCREEN_MAX_EDGE = 512;

test.describe("the media session", () => {
	test.use({ fooJean: {} });

	test("stays empty while the sound is on the player", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await expect(
			statusBar(page).getByRole("button", { name: "Pause", exact: true }),
		).toBeVisible();

		expect(await session(page)).toMatchObject({ state: "none", title: null });
	});

	test("names the track once the sound is here", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);

		// The album is the one field the update stream does not carry, so it
		// arrives a request behind the rest.
		await expect
			.poll(() => session(page).then((live) => live.album))
			.not.toBeNull();

		const live = await session(page);
		// The song, named. Without this line every assertion below compares one
		// derivation with another and a session publishing the wrong track passes.
		expect(live.title).toBe("Los Calientes");
		expect(live.artist).toBe("Babasónicos");
		// And the tab agrees with it, which is the thing the two cannot be allowed
		// to disagree about.
		expect(await page.title()).toBe(`${live.title} — ${live.artist} · Jean`);
		expect(live.album).not.toBe("");
		expect(live.state).toBe("playing");
	});

	// `app/CLAUDE.md`'s *The media session* has why the cover is redrawn rather than addressed.
	// No test can see a lock screen, so this is as close as the suite gets to it.
	test("carries the cover as an encoded picture, and keeps naming the track it moves to", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);
		await expect
			.poll(() => session(page).then((live) => live.title))
			.toBe("Los Calientes");

		await expect
			.poll(() => session(page).then((live) => live.artwork))
			.toMatch(/^data:image\/jpeg;base64,/);

		const live = await session(page);
		expect(live.type).toBe("image/jpeg");

		// Declared, and small enough that no operating system rejects it for size.
		expect(live.sizes).toMatch(/^\d+x\d+$/);
		const edges = String(live.sizes).split("x").map(Number);
		expect(Math.max(...edges)).toBeLessThanOrEqual(LOCK_SCREEN_MAX_EDGE);
		expect(Math.min(...edges)).toBeGreaterThan(0);

		player.playItem(player.player.activeItem.playlistId, ANOTHER_ARTIST.row);

		// The half that must not regress, and the half a person on a lock screen reads first: the
		// picture has to move with the words rather than being left on the record that stopped
		// playing. Read as one retrying assertion rather than as several, because the words and the
		// picture are published together while the picture is rebuilt asynchronously, so a read
		// taken between two of them catches the new words over the old sleeve and says nothing
		// about where either settles.
		await expect
			.poll(() =>
				session(page).then((one) => ({
					title: one.title,
					artist: one.artist,
					type: one.type,
					isEncoded:
						one.artwork?.startsWith("data:image/jpeg;base64,") ?? false,
					movedOn: one.artwork !== live.artwork,
				})),
			)
			.toEqual({
				title: ANOTHER_ARTIST.title,
				artist: ANOTHER_ARTIST.artist,
				type: "image/jpeg",
				isEncoded: true,
				movedOn: true,
			});
	});

	test("follows the player's transport", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);
		await expect
			.poll(() => session(page).then((live) => live.state))
			.toBe("playing");

		// The player's state, not the element's: the stream runs on through a
		// pause while the buffer drains.
		await statusBar(page)
			.getByRole("button", { name: "Pause", exact: true })
			.click();
		await expect
			.poll(() => session(page).then((live) => live.state))
			.toBe("paused");
	});

	test("is given back when the sound goes", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);
		await expect
			.poll(() => session(page).then((live) => live.title))
			.not.toBeNull();

		await thePlayer(page).click();

		// Cleared rather than left standing: a lock screen still showing Jean's
		// buttons would be pressing them at a device that has stopped listening.
		await expect
			.poll(() => session(page))
			.toMatchObject({ state: "none", title: null });
	});
});
