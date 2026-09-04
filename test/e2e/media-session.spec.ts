import {
	expect,
	openLibrary,
	type Page,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// The OS media controls. Nothing here presses one: `setActionHandler` has no
// getter and Playwright cannot deliver a media key, so what is asserted is the
// metadata and the state, which is what a lock screen draws.

const TOKEN = "0123456789abcdef0123456789abcdef";

const play = async (page: Page) => {
	await openLibrary(page);
	await trackRow(page, 0).dblclick();
};

const startListening = async (page: Page) => {
	await statusBar(page)
		.getByRole("button", {
			name: /Choose where to play|Playing on this device/,
		})
		.click();
	await page.getByRole("button", { name: /This device/ }).click();
	// The session follows the sound, and there is none until the element renders.
	await page.waitForFunction(
		() => {
			const audio = document.querySelector("audio");
			return Boolean(audio && audio.currentTime > 0);
		},
		undefined,
		{ timeout: 60_000 },
	);
};

const thePlayer = (page: Page) =>
	page
		.getByRole("group", { name: "Playing on" })
		.getByRole("button", { name: /foobar2000/ });

const session = (page: Page) =>
	page.evaluate(() => ({
		state: navigator.mediaSession.playbackState,
		title: navigator.mediaSession.metadata?.title ?? null,
		artist: navigator.mediaSession.metadata?.artist ?? null,
		album: navigator.mediaSession.metadata?.album ?? null,
		artwork: navigator.mediaSession.metadata?.artwork?.[0]?.src ?? null,
	}));

test.describe("the media session", () => {
	test.use({ fooJean: {}, fooJeanToken: TOKEN });

	test("stays empty while the sound is on the player", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await expect(
			statusBar(page).getByRole("button", { name: "Pause", exact: true }),
		).toBeVisible();

		// A session claims the OS controls, and this device is making no sound to
		// claim them with: the buttons would point a lock screen at audio coming
		// out of another room.
		expect(await session(page)).toMatchObject({ state: "none", title: null });
	});

	test("names the track once the sound is here", async ({ page }) => {
		await page.goto("/");
		await play(page);
		await startListening(page);

		// The album is the one field the update stream does not carry, so it
		// arrives a request behind the rest.
		await expect
			.poll(() => session(page).then((live) => live.album))
			.not.toBeNull();

		const live = await session(page);
		// Against the tab rather than against a fixture value: the two read one
		// derivation, and the point is that they cannot disagree.
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
		await startListening(page);
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
		await startListening(page);
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
