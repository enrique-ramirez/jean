import {
	expect,
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
		// beefweb serves one image per track and has no thumbnail endpoint, so
		// there is a single entry and it claims no size.
		expect(live.artwork).toContain("/api/artwork/");
		expect(live.state).toBe("playing");
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
