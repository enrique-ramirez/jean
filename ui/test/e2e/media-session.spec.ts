import {
	coversFromBeefweb,
	expect,
	expectSettlesAt,
	FOO_JEAN_TOKEN,
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
	page.evaluate(() => ({
		state: navigator.mediaSession.playbackState,
		title: navigator.mediaSession.metadata?.title ?? null,
		artist: navigator.mediaSession.metadata?.artist ?? null,
		album: navigator.mediaSession.metadata?.album ?? null,
		artwork: navigator.mediaSession.metadata?.artwork?.[0]?.src ?? null,
	}));

test.describe("the media session", () => {
	test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

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

	// The operating system fetches the artwork address itself, so Jean cannot put
	// a bearer token on it and the component answers 401. Until a blob URL with
	// an owner closes that, the session publishes the words and no picture;
	// `_todo/07-technical-debt.md`, *The OS media session cannot reach the
	// playing cover*, is the measurement and what it would take.
	test("carries no cover, and keeps naming the track it moves to", async ({
		page,
		player,
	}) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);
		await expect
			.poll(() => session(page).then((live) => live.title))
			.toBe("Los Calientes");

		// A browser resolves every artwork entry against the document, so an entry
		// carrying an empty address still reads back as one. Null here is no entry.
		expect((await session(page)).artwork).toBeNull();

		player.playItem(player.player.activeItem.playlistId, ANOTHER_ARTIST.row);

		// The half that must not regress. A lock screen with no picture still says
		// what is playing, and it is the only thing a browser test can read back.
		await expect
			.poll(() => session(page))
			.toMatchObject({
				title: ANOTHER_ARTIST.title,
				artist: ANOTHER_ARTIST.artist,
				artwork: null,
			});

		await expectSettlesAt(player, () => coversFromBeefweb(player), []);
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
