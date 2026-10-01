import {
	callMediaSessionAction,
	choosePlayer,
	countPostsTo,
	expect,
	expectNothingRefusedSent,
	expectSettlesAt,
	type FakePlayer,
	listenHere,
	MEDIA_SESSION_ACTIONS_WITH_CONTROL,
	mediaSessionActions,
	openLibrary,
	type Page,
	playingOn,
	recordMediaSessionHandlers,
	statusBar,
	test,
	trackRow,
	untilQuiet,
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
	playingOn(page).getByText("foobar2000", { exact: true });

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

type MediaPlay = { loop: boolean };

// Every media element anything on the page starts, whether or not it is in the document: an element
// kept only to claim the media keys never needs to be in the tree. A call to `play()` is recorded, and
// so is every `play` event, from an element made through `new Audio()`, through `createElement` or
// parsed into the document, since `autoplay` starts one with no call at all.
const recordMediaPlays = (page: Page) =>
	page.addInitScript(() => {
		const played: MediaPlay[] = [];
		Object.assign(window, { __mediaPlays: played });
		const record = (element: HTMLMediaElement) =>
			played.push({ loop: element.loop });
		const onPlay = (event: Event) => record(event.target as HTMLMediaElement);
		const watch = <T extends Node>(element: T) => {
			if (element instanceof HTMLMediaElement)
				element.addEventListener("play", onPlay);
			return element;
		};

		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
			record(this);
			return play.call(this);
		};
		window.Audio = new Proxy(window.Audio, {
			construct: (target, args) => watch(Reflect.construct(target, args)),
		});
		const createElement = document.createElement;
		document.createElement = function (
			this: Document,
			...args: Parameters<Document["createElement"]>
		) {
			return watch(createElement.apply(this, args));
		} as Document["createElement"];
		document.addEventListener(
			"play",
			(event) => {
				const element = event.target as HTMLMediaElement;
				if (!element.isConnected) return;
				record(element);
			},
			true,
		);
	});

const mediaPlays = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __mediaPlays: MediaPlay[] }).__mediaPlays,
	);

const listening = async (page: Page) => {
	await listenHere(page);
	await expect
		.poll(() => session(page).then((live) => live.state))
		.toBe("playing");
};

const isAudioPaused = (page: Page) =>
	page.evaluate(() => document.querySelector("audio")?.paused ?? null);

const expectListeningEnded = async (page: Page, player: FakePlayer) => {
	await expect
		.poll(() => session(page))
		.toMatchObject({ state: "none", title: null });
	await expect(choosePlayer(page)).toHaveAccessibleName(/Choose where to play/);
	await expect.poll(() => countPostsTo(player, "/api/stream/leave")).toBe(1);
};

const settledMediaPlays = async (page: Page, player: FakePlayer) => {
	await untilQuiet(player);
	return mediaPlays(page);
};

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

	// A silent looping element would claim the media keys and the lock screen for a tab that is only
	// a remote, badge every Jean tab as audible and spend a phone's battery for a notification. The
	// session belongs to whatever is audible, and while the sound is on the player that is not Jean.
	test("nothing plays in the tab until this device is asked to listen, and the stream never loops", async ({
		page,
		player,
	}) => {
		await recordMediaPlays(page);
		await page.goto("/");
		await play(page);
		const pause = statusBar(page).getByRole("button", {
			name: "Pause",
			exact: true,
		});
		await expect(pause).toBeVisible();
		await pause.click();
		await statusBar(page)
			.getByRole("button", { name: "Play", exact: true })
			.click();
		await expect(pause).toBeVisible();

		expect(await settledMediaPlays(page, player)).toEqual([]);

		// The recorder sees a real start, so the empty read above is not a recorder that sees nothing.
		await listenHere(page);
		const played = await settledMediaPlays(page, player);
		expect(played.length).toBeGreaterThan(0);
		expect(played.filter((one) => one.loop)).toEqual([]);
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

	// Redrawn rather than addressed: the OS fetches the artwork out of process, and
	// Chrome on iOS refuses a `blob:` URL there.
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

	test("while listening, holds a handler for every action, and stop stops the player and ends listening", async ({
		page,
		player,
	}) => {
		await recordMediaSessionHandlers(page);
		await page.goto("/");
		await play(page);
		await listening(page);
		await expect
			.poll(() => mediaSessionActions(page))
			.toEqual(MEDIA_SESSION_ACTIONS_WITH_CONTROL);

		await callMediaSessionAction(page, "stop");

		await expectListeningEnded(page, player);
		await expect.poll(() => countPostsTo(player, "/api/playback/stop")).toBe(1);
	});

	test("while listening, every handler but stop drives the player", async ({
		page,
		player,
	}) => {
		await recordMediaSessionHandlers(page);
		await page.goto("/");
		await play(page);
		await listening(page);
		await expect.poll(() => mediaSessionActions(page)).toContain("pause");

		await callMediaSessionAction(page, "pause");
		await expect.poll(() => player.player.playbackState).toBe("paused");
		await expect
			.poll(() => session(page).then((live) => live.state))
			.toBe("paused");

		await callMediaSessionAction(page, "play");
		await expect.poll(() => player.player.playbackState).toBe("playing");

		await callMediaSessionAction(page, "nexttrack");
		await expect.poll(() => countPostsTo(player, "/api/playback/next")).toBe(1);

		await callMediaSessionAction(page, "previoustrack");
		await expect
			.poll(() => countPostsTo(player, "/api/playback/previous"))
			.toBe(1);

		for (const [action, details] of [
			["seekforward", {}],
			["seekbackward", {}],
			["seekto", { seekTime: 30 }],
		] as const)
			await callMediaSessionAction(page, action, details);
		await expect.poll(() => countPostsTo(player, "/api/playback/seek")).toBe(3);

		expect(countPostsTo(player, "/api/playback/stop")).toBe(0);
		expect(countPostsTo(player, "/api/stream/leave")).toBe(0);
		await expect(choosePlayer(page)).toHaveAccessibleName(
			/Playing on this device/,
		);
	});

	// Chrome on Android and Safari on iOS draw the lock screen's button from the
	// element, whatever `playbackState` declares.
	test("a pause on the lock screen pauses this device's audio, and play starts it again", async ({
		page,
		player,
	}) => {
		await recordMediaSessionHandlers(page);
		await page.goto("/");
		await play(page);
		await listening(page);

		await callMediaSessionAction(page, "pause");
		await expect.poll(() => isAudioPaused(page)).toBe(true);
		await expect.poll(() => player.player.playbackState).toBe("paused");

		await callMediaSessionAction(page, "play");
		await expect.poll(() => isAudioPaused(page)).toBe(false);
		await expect.poll(() => player.player.playbackState).toBe("playing");
	});

	test("a pause on the lock screen while the player is already paused still pauses this device's audio", async ({
		page,
		player,
	}) => {
		await recordMediaSessionHandlers(page);
		await page.goto("/");
		await play(page);
		await listening(page);
		player.patchPlayer({ playbackState: "paused" });
		await expect
			.poll(() => session(page).then((live) => live.state))
			.toBe("paused");

		await callMediaSessionAction(page, "pause");
		await expect.poll(() => isAudioPaused(page)).toBe(true);
		expect(countPostsTo(player, "/api/playback/play-pause")).toBe(0);
	});

	test.describe("paused from elsewhere", () => {
		test.use({ fooJean: { streamPrime: 2 } });

		test("this device's audio pauses once what it holds has played, and resumes with the player", async ({
			page,
			player,
		}) => {
			await page.goto("/");
			await play(page);
			await listening(page);

			player.patchPlayer({ playbackState: "paused" });
			await expect
				.poll(() => isAudioPaused(page), { timeout: 30_000 })
				.toBe(true);

			player.patchPlayer({ playbackState: "playing" });
			await expect.poll(() => isAudioPaused(page)).toBe(false);
		});
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

test.describe("the media session with playback control off at the player", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	const listeningWithoutControl = async (page: Page, player: FakePlayer) => {
		await recordMediaSessionHandlers(page);
		player.playItem("p7", 0);
		await openLibrary(page);
		await listening(page);
	};

	test("while listening, holds stop and pause and nothing else", async ({
		page,
		player,
	}) => {
		await listeningWithoutControl(page, player);

		await expectSettlesAt(player, () => mediaSessionActions(page), [
			"pause",
			"stop",
		]);
	});

	for (const action of ["stop", "pause"] as const)
		test(`${action} ends listening here and sends the player nothing it would refuse`, async ({
			page,
			player,
		}) => {
			await listeningWithoutControl(page, player);
			await expect.poll(() => mediaSessionActions(page)).toContain(action);

			await callMediaSessionAction(page, action);

			await expectListeningEnded(page, player);
			await expectNothingRefusedSent(player);
		});
});
