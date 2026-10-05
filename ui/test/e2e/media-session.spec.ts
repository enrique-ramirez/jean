import type { DetachedSession } from "../fake-api/sessions.ts";
import { evaluate, type Track } from "../fake-api/state.ts";
import {
	callMediaSessionAction,
	choosePlayer,
	countPostsTo,
	countPostsToSession,
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
	putThePickerAway,
	REFUSED_ROUTES,
	recordMediaSessionHandlers,
	requestsTo,
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

// Stop takes this name while this device is the player's only listener.
const handBack = (page: Page) =>
	playingOn(page).getByRole("button", {
		name: "Move the sound back to foobar2000",
		exact: true,
	});

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

	test("follows the player's transport", async ({ page, isMobile }) => {
		await page.goto("/");
		await play(page);
		await listenHere(page);
		await putThePickerAway(page, isMobile);
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

		await handBack(page).click();

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

// ---- a page listening to a session of its own -------------------------------

const DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";
const ANOTHER_DEVICE = {
	deviceId: "0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a",
	name: null,
};

const SESSION_KEY = "jean.session";

const field = (track: Track | null, expression: string) =>
	track ? String(evaluate(track, expression) ?? "") : null;

const titleOf = (track: Track | null) => field(track, "%title%");

// One track off each of three records, so the player's track and the session's two share no
// title, artist or cover.
const threeRecords = (player: FakePlayer) => {
	const library = player.playlistById("p7")?.items ?? [];
	const records = new Map<string, Track>();
	for (const track of library) {
		const record = field(track, "%album%") ?? "";
		if (!records.has(record)) records.set(record, track);
	}
	const [atThePlayer, first, second] = records.values();
	if (!second) throw new Error("the library holds fewer than three records");
	return { library, atThePlayer, first, second };
};

interface Scene {
	detached: DetachedSession;
	atThePlayer: Track;
	first: Track;
	second: Track;
}

// The player plays one record and the session two others, the session from row `at`.
const sessionBesideThePlayer = (
	player: FakePlayer,
	{ at = 0, untitledRecord = false } = {},
): Scene => {
	const { library, atThePlayer, first, second } = threeRecords(player);
	player.playItem("p7", library.indexOf(atThePlayer));
	const detached = player.sessions.create({ deviceId: DEVICE, name: null });
	const [one, two] = untitledRecord
		? [first, second].map((track) => ({ ...track, "%album%": "" }))
		: [first, second];
	detached.play([one, two], at);
	return { detached, atThePlayer, first: one, second: two };
};

// Strict mode answers `500` to a session-scoped request naming no session, so a page in a session
// that sends one is caught here whatever it was for.
const strictRefusals = (page: Page) => {
	const refused: string[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (response.status() === 500 && url.pathname.startsWith("/api/"))
			refused.push(`${response.request().method()} ${url.pathname}`);
	});
	return refused;
};

// A browser refuses audio without a press, so a page stored as listening comes up waiting for one,
// and Start playing is that press. The lock screen is exercised only once the stream is rendering.
const listeningInSession = async (
	page: Page,
	player: FakePlayer,
	detached: DetachedSession,
) => {
	await recordMediaSessionHandlers(page);
	await page.addInitScript(
		({ key, stored }) => sessionStorage.setItem(key, stored),
		{
			key: SESSION_KEY,
			stored: JSON.stringify({ id: detached.id, listening: true }),
		},
	);
	const refused = strictRefusals(page);
	player.fooJean.strictSessions = true;
	await page.goto("/#/search");

	await choosePlayer(page).click();
	await page.getByRole("button", { name: "Start playing" }).click();
	await page.waitForFunction(
		() => {
			const audio = document.querySelector("audio");
			return Boolean(audio && audio.currentTime > 0);
		},
		undefined,
		{ timeout: 60_000 },
	);
	await expect.poll(() => detached.playback()).toBe("playing");
	await expect
		.poll(() => session(page).then((live) => live.state))
		.toBe("playing");
	return refused;
};

const namedSession = (path: string) =>
	new URL(path, "http://fake").searchParams.get("session");

const namesThePlayer = (path: string) => {
	const named = namedSession(path);
	return !named || named === "engine";
};

// Every command the player would act on that went out naming no session.
const commandsToThePlayer = (player: FakePlayer) =>
	player.requests
		.map((entry) => ({
			route: `${entry.method} ${entry.path.split("?")[0]}`,
			path: entry.path,
		}))
		.filter(
			({ route, path }) =>
				REFUSED_ROUTES.some((pattern) => pattern.test(route)) &&
				namesThePlayer(path),
		)
		.map(({ route }) => route);

const playerAsItStands = (player: FakePlayer) => ({
	playlist: player.player.activeItem.playlistId,
	row: player.player.activeItem.index,
	playback: player.player.playbackState,
	position: player.positionMark,
	queue: player.playQueue,
	version: player.playerVersion,
});

const stillListening = (player: FakePlayer, detached: DetachedSession) =>
	player.sessions.find(detached.id) === detached &&
	detached.roster().some((device) => device.deviceId === DEVICE);

// The browser letting go of the stream and asking to leave, in the order it did them. `foo_jean`
// ignores a leave from a device still holding a connection, so the close has to go first; when the
// fake learns of the closed socket is a race the client does not control, so the order is read here.
const letGoAndLeave = (page: Page) => {
	const seen: string[] = [];
	page.on("requestfailed", (request) => {
		if (new URL(request.url()).pathname === "/api/stream")
			seen.push("stream closed");
	});
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/stream/leave"
		)
			seen.push("leave");
	});
	return seen;
};

interface SessionMove {
	title: string;
	action: MediaSessionAction;
	details?: Omit<MediaSessionActionDetails, "action">;
	at?: number;
	before?: (page: Page, scene: Scene) => Promise<void>;
	read: (scene: Scene) => unknown;
	expected: (scene: Scene) => unknown;
	route: string;
}

const ASKED_OFFSET = 15;
const ROOM_TO_SEEK_BACK = 60;
const ASKED_TIME = 30;

const SESSION_MOVES: SessionMove[] = [
	{
		title: "play resumes the session where another device paused it",
		action: "play",
		before: async (page, { detached }) => {
			detached.playPause();
			await expect
				.poll(() => session(page).then((live) => live.state))
				.toBe("paused");
		},
		read: ({ detached }) => detached.playback(),
		expected: () => "playing",
		route: "/api/playback/play-pause",
	},
	{
		title: "pause pauses the session and keeps this device listening to it",
		action: "pause",
		read: ({ detached }) => detached.playback(),
		expected: () => "paused",
		route: "/api/playback/play-pause",
	},
	{
		title: "next track moves the session to its next track",
		action: "nexttrack",
		read: ({ detached }) => titleOf(detached.playingTrack()),
		expected: ({ second }) => titleOf(second),
		route: "/api/playback/next",
	},
	{
		title: "previous track asks the session for its previous track",
		action: "previoustrack",
		at: 1,
		read: ({ detached }) => titleOf(detached.playingTrack()),
		expected: ({ first }) => titleOf(first),
		route: "/api/playback/previous",
	},
	{
		title: "seek forward moves the session's position on by the offset asked",
		action: "seekforward",
		details: { seekOffset: ASKED_OFFSET },
		read: ({ detached }) => detached.position.seconds,
		expected: () => ASKED_OFFSET,
		route: "/api/playback/seek",
	},
	{
		title:
			"seek backward moves the session's position back by the offset asked",
		action: "seekbackward",
		details: { seekOffset: ASKED_OFFSET },
		before: async (_page, { detached }) =>
			detached.seek({ seconds: ROOM_TO_SEEK_BACK }),
		read: ({ detached }) => detached.position.seconds,
		expected: () => ROOM_TO_SEEK_BACK - ASKED_OFFSET,
		route: "/api/playback/seek",
	},
	{
		title: "seek to moves the session's position to the time asked",
		action: "seekto",
		details: { seekTime: ASKED_TIME },
		read: ({ detached }) => detached.position.seconds,
		expected: () => ASKED_TIME,
		route: "/api/playback/seek",
	},
];

for (const canControlPlayback of [true, false])
	test.describe(`the media session of a page listening to a session of its own, with playback control ${canControlPlayback ? "on" : "off"} at the player`, () => {
		test.use({
			fooJean: { maxSessions: 4, canCreateSessions: true, canControlPlayback },
			settings: { "jean.deviceId": DEVICE },
		});

		test("holds a handler for every action", async ({ page, player }) => {
			const { detached } = sessionBesideThePlayer(player);
			const refused = await listeningInSession(page, player, detached);

			await expectSettlesAt(
				player,
				() => mediaSessionActions(page),
				MEDIA_SESSION_ACTIONS_WITH_CONTROL,
			);
			expect(refused).toEqual([]);
		});

		for (const move of SESSION_MOVES)
			test(`${move.title}, and the player is left as it was`, async ({
				page,
				player,
			}) => {
				const scene = sessionBesideThePlayer(player, { at: move.at });
				const { detached } = scene;
				const refused = await listeningInSession(page, player, detached);
				await move.before?.(page, scene);
				const asItStood = playerAsItStands(player);
				const sent = countPostsToSession(player, move.route, detached.id);

				await callMediaSessionAction(page, move.action, move.details);

				await expectSettlesAt(
					player,
					() => ({
						moved: move.read(scene),
						listening: stillListening(player, detached),
					}),
					{ moved: move.expected(scene), listening: true },
				);
				expect(countPostsToSession(player, move.route, detached.id)).toBe(
					sent + 1,
				);
				expect(
					countPostsToSession(player, "/api/playback/seek", detached.id),
				).toBe(move.route === "/api/playback/seek" ? 1 : 0);
				expect(playerAsItStands(player)).toEqual(asItStood);
				expect(commandsToThePlayer(player)).toEqual([]);
				expect(refused).toEqual([]);
			});

		// A stop sent in the same tick the page goes back to the player names no session, and stops
		// the house's speakers rather than the session.
		test("stop closes the stream, then leaves the session, which ends; the page is back on the player without listening, and the player is left as it was", async ({
			page,
			player,
		}) => {
			const { detached, atThePlayer } = sessionBesideThePlayer(player);
			const refused = await listeningInSession(page, player, detached);
			const order = letGoAndLeave(page);
			const asItStood = playerAsItStands(player);

			// The page goes back to the player, whose requests name no session by design.
			player.fooJean.strictSessions = false;
			await callMediaSessionAction(page, "stop");

			await expectSettlesAt(
				player,
				() => player.sessions.find(detached.id),
				null,
			);
			expect(countPostsToSession(player, "/api/playback/stop", "engine")).toBe(
				0,
			);
			expect(playerAsItStands(player)).toEqual(asItStood);
			expect(commandsToThePlayer(player)).toEqual([]);
			expect(order.slice(0, 2)).toEqual(["stream closed", "leave"]);

			await expect
				.poll(() => session(page))
				.toMatchObject({ state: "none", title: null });
			await expect(choosePlayer(page)).toHaveAccessibleName(
				/Choose where to play/,
			);
			await expect(statusBar(page)).toContainText(titleOf(atThePlayer) ?? "");
			expect(countPostsToSession(player, "/api/stream/ticket", "engine")).toBe(
				0,
			);
			expect(refused).toEqual([]);
		});

		test("stop leaves a session another device listens to, and it plays on for that device unchanged", async ({
			page,
			player,
		}) => {
			const { detached } = sessionBesideThePlayer(player);
			player.addSessionListener(detached.id, ANOTHER_DEVICE);
			await listeningInSession(page, player, detached);
			const asItPlayed = {
				track: titleOf(detached.playingTrack()),
				playback: detached.playback(),
				position: detached.position,
			};
			const asItStood = playerAsItStands(player);

			player.fooJean.strictSessions = false;
			await callMediaSessionAction(page, "stop");

			await expectSettlesAt(
				player,
				() => detached.roster().map((device) => device.deviceId),
				[ANOTHER_DEVICE.deviceId],
			);
			expect(player.sessions.find(detached.id)).toBe(detached);
			expect({
				track: titleOf(detached.playingTrack()),
				playback: detached.playback(),
				position: detached.position,
			}).toEqual(asItPlayed);
			expect(playerAsItStands(player)).toEqual(asItStood);
			expect(commandsToThePlayer(player)).toEqual([]);
			await expect(choosePlayer(page)).toHaveAccessibleName(
				/Choose where to play/,
			);
		});
	});

test.describe("the media session of a page listening to a session of its own", () => {
	test.use({
		fooJean: { maxSessions: 4, canCreateSessions: true },
		settings: { "jean.deviceId": DEVICE },
	});

	// A track whose record is unnamed has no library cover to stand in, so the picture comes off
	// the playing-cover route, which answers whichever session it names.
	test("names the session's track, and draws the picture the session's own cover address answers", async ({
		page,
		player,
	}) => {
		const { detached, first } = sessionBesideThePlayer(player, {
			untitledRecord: true,
		});
		const refused = await listeningInSession(page, player, detached);

		await expect
			.poll(() =>
				session(page).then((live) => ({
					title: live.title,
					artist: live.artist,
					isPicture:
						live.artwork?.startsWith("data:image/jpeg;base64,") ?? false,
				})),
			)
			.toEqual({
				title: titleOf(first),
				artist: field(first, "%artist%"),
				isPicture: true,
			});

		const asked = requestsTo(player, "/api/artwork/playing").map((entry) => {
			const query = new URL(entry.path, "http://fake").searchParams;
			return { session: query.get("session"), deviceId: query.get("deviceId") };
		});
		expect(asked.length).toBeGreaterThan(0);
		expect(
			asked.filter(
				(scope) => scope.session !== detached.id || scope.deviceId !== DEVICE,
			),
		).toEqual([]);
		expect(refused).toEqual([]);
	});
});
