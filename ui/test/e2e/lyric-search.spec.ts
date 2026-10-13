import type { Route } from "@playwright/test";
import type { Track } from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	guidOfPlaylist,
	nowPlayingScreen,
	openNowPlaying,
	requestsTo,
	rowByTitle,
	runClockFor,
	statusBar,
	tagWrites,
	test,
	times,
	toastRegion,
	toasts,
	untilQuiet,
} from "./fixtures.ts";
import {
	discardButton,
	expectDiscardPrompt,
	expectPanelOpen,
	expectTouchTargets,
	keepEditingButton,
	lyricTagOf,
	openPanels,
	panelTab,
	playRow,
	promptsEverShown,
	recordPromptsEverShown,
	TAGGED,
	titleAddressedBy,
	trackInfo,
	untilThePageKnowsPlaying,
} from "./nowPlaying.ts";

const LYRIC_FIELD = "unsynced lyrics";

const SAVING_POSSIBLE = { allowedFields: ["rating", LYRIC_FIELD] };

const SYNCED = { row: 0, line: "Dancing in the dark" };
const PLAIN = { row: 1, line: "I came committed" };
const NO_LYRIC = { row: 3, title: "Soy Rock", artist: "Babasónicos" };

const NOTHING_FOUND = "No lyrics found";
const NOTHING_SENT = "Nothing is sent until you press it.";

const searchButton = (panel: Locator) =>
	panel.getByRole("button", { name: "Search", exact: true });

const editButton = (panel: Locator) =>
	panel.getByRole("button", { name: "Edit", exact: true });

// LRCLIB is a third party on the open internet, so nothing here reaches it.
const watchLrclib = async (page: Page) => {
	const asked: string[] = [];
	await page.route("https://lrclib.net/**", (route) => {
		asked.push(route.request().url());
		return route.fulfill({ json: [] });
	});
	return asked;
};

const expectNothingAskedOfLrclib = async (
	player: FakePlayer,
	asked: string[],
) => {
	await untilQuiet(player);
	expect(asked).toEqual([]);
};

// A button drawn while the capabilities load and withdrawn once they land is pressable,
// so the recorder reads every frame and not the final screen.
const recordActionsEverDrawn = (page: Page) =>
	page.addInitScript(() => {
		const drawn = new Set<string>();
		Object.assign(window, { lyricActionsDrawn: drawn });
		const surfaces = ["Current track", "Track information"]
			.map((label) => `section[aria-label="${label}"]`)
			.flatMap((surface) => [`${surface} button`, `${surface} [role="button"]`])
			.join(", ");
		const look = () => {
			for (const control of document.querySelectorAll(surfaces)) {
				const name = (
					control.getAttribute("aria-label") ??
					control.textContent ??
					""
				).trim();
				if (name === "Search" || name === "Edit") drawn.add(name);
			}
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
	});

const actionsEverDrawn = (page: Page) =>
	page.evaluate(() =>
		[
			...(window as unknown as { lyricActionsDrawn: Set<string> })
				.lyricActionsDrawn,
		].sort(),
	);

const openLyricsOf = async (page: Page, isMobile: boolean, row: number) => {
	await playRow(page, row);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Lyrics").click();
	return panel;
};

// An internet radio station has no file for a lyric to be saved into.
const STATION: Track = {
	"%path%": "http://stream.example.org:8000/night-shift",
	"%title%": "Weightless",
	"%artist%": "Halo Choir",
	"%codec%": "MP3",
	"%bitrate%": "128",
};

const STATION_LINE = "Night shift, all night";

const ADDED_TO = "p1";

const openLyricsOfStation = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
	station: Track,
) => {
	const playlist = player.playlistById(ADDED_TO);
	if (!playlist) throw new Error(`no playlist ${ADDED_TO} to add to`);
	playlist.items.push(station);

	await page.goto(`/#/${guidOfPlaylist(player, ADDED_TO)}`);
	await rowByTitle(page, station["%title%"]).dblclick();
	await expect(statusBar(page)).toContainText(station["%title%"]);

	await openNowPlaying(page);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Lyrics").click();
	return panel;
};

const expectNeitherEverOffered = async (
	page: Page,
	player: FakePlayer,
	panel: Locator,
) => {
	await untilQuiet(player);
	await expect(searchButton(panel)).toHaveCount(0);
	await expect(editButton(panel)).toHaveCount(0);
	expect(await actionsEverDrawn(page)).toEqual([]);
};

test.describe("where mending a lyric starts", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	test("an empty panel offers Search, and says what Search sends and that nothing has been sent yet", async ({
		page,
		player,
		isMobile,
	}) => {
		const asked = await watchLrclib(page);
		const panel = await openLyricsOf(page, isMobile, NO_LYRIC.row);

		await expect(panel).toContainText(NOTHING_FOUND);
		await expect(searchButton(panel)).toBeVisible();
		await expect(panel).toContainText(
			`Search asks LRCLIB for ${NO_LYRIC.title} by ${NO_LYRIC.artist}. ${NOTHING_SENT}`,
		);

		await expectNothingAskedOfLrclib(player, asked);
	});

	test("an empty panel offers Edit, to write a lyric from nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		const asked = await watchLrclib(page);
		const panel = await openLyricsOf(page, isMobile, NO_LYRIC.row);

		await expect(panel).toContainText(NOTHING_FOUND);
		await expect(editButton(panel)).toBeVisible();

		await expectNothingAskedOfLrclib(player, asked);
	});

	for (const [kind, lyric] of [
		["synced", SYNCED],
		["plain", PLAIN],
	] as const)
		test(`a ${kind} lyric is shown with Search and Edit beside it, and without the sentence about sending`, async ({
			page,
			player,
			isMobile,
		}) => {
			const asked = await watchLrclib(page);
			await recordActionsEverDrawn(page);
			const panel = await openLyricsOf(page, isMobile, lyric.row);

			await expect(panel.getByText(lyric.line)).toBeVisible();
			await expect(searchButton(panel)).toBeVisible();
			await expect(editButton(panel)).toBeVisible();

			await expect(panel).not.toContainText(NOTHING_SENT);

			expect(await actionsEverDrawn(page)).toEqual(["Edit", "Search"]);

			await expectNothingAskedOfLrclib(player, asked);
		});

	test.describe("with the field typed into the allowlist in capitals", () => {
		// foobar2000 matches a tag's name without regard to case, and the allowlist is typed by hand.
		test.use({ fooJean: { allowedFields: ["UNSYNCED LYRICS"] } });

		test("Search and Edit are offered all the same", async ({
			page,
			isMobile,
		}) => {
			const panel = await openLyricsOf(page, isMobile, NO_LYRIC.row);

			await expect(searchButton(panel)).toBeVisible();
			await expect(editButton(panel)).toBeVisible();
		});
	});
});

test.describe("where mending a lyric does not start", () => {
	test.use(TAGGED);

	for (const [why, fooJean] of [
		[
			"the allowlist holds other fields and not the lyric's",
			{ allowedFields: ["rating"] },
		],
		// foo_jean answers `canWrite` as `allowedFields.length > 0`.
		["the player takes no tag writes at all", { allowedFields: [] }],
	] as const)
		test.describe(`where ${why}`, () => {
			test.use({ fooJean: { allowedFields: [...fooJean.allowedFields] } });

			test("an empty panel offers neither Search nor Edit, and no sentence about a search it cannot run", async ({
				page,
				player,
				isMobile,
			}) => {
				const asked = await watchLrclib(page);
				await recordActionsEverDrawn(page);
				const panel = await openLyricsOf(page, isMobile, NO_LYRIC.row);

				await expect(panel).toContainText(NOTHING_FOUND);
				await expectNeitherEverOffered(page, player, panel);
				await expect(panel).not.toContainText(NOTHING_SENT);
				expect(asked).toEqual([]);
			});

			test("a lyric is shown with neither Search nor Edit beside it", async ({
				page,
				player,
				isMobile,
			}) => {
				const asked = await watchLrclib(page);
				await recordActionsEverDrawn(page);
				const panel = await openLyricsOf(page, isMobile, SYNCED.row);

				await expect(panel.getByText(SYNCED.line)).toBeVisible();
				await expectNeitherEverOffered(page, player, panel);
				expect(asked).toEqual([]);
			});
		});

	test.describe("where the playing track is a stream", () => {
		test.use({ fooJean: SAVING_POSSIBLE });

		test("a station with no lyric offers neither Search nor Edit", async ({
			page,
			player,
			isMobile,
		}) => {
			const asked = await watchLrclib(page);
			await recordActionsEverDrawn(page);
			const panel = await openLyricsOfStation(page, player, isMobile, STATION);

			await expect(panel).toContainText(NOTHING_FOUND);
			await expectNeitherEverOffered(page, player, panel);
			await expect(panel).not.toContainText(NOTHING_SENT);
			expect(asked).toEqual([]);
		});

		test("a station carrying a lyric shows it with neither Search nor Edit", async ({
			page,
			player,
			isMobile,
		}) => {
			const asked = await watchLrclib(page);
			await recordActionsEverDrawn(page);
			const panel = await openLyricsOfStation(page, player, isMobile, {
				...STATION,
				[`$meta(${LYRIC_FIELD})`]: STATION_LINE,
			});

			await expect(panel.getByText(STATION_LINE)).toBeVisible();
			await expectNeitherEverOffered(page, player, panel);
			expect(asked).toEqual([]);
		});
	});
});

const TRACK_SECONDS = 162;
const TRACK_LENGTH = "2:42";

interface Version {
	id: number;
	trackName: string;
	artistName: string;
	albumName: string;
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
}

const version = (
	id: number,
	kind: "synced" | "plain" | "instrumental",
	albumName: string,
	apart: number,
): Version => ({
	id,
	trackName: `Soy Rock, take ${id}`,
	artistName: `Los Babasónicos ${id}`,
	albumName,
	duration: TRACK_SECONDS + apart,
	instrumental: kind === "instrumental",
	plainLyrics: kind === "instrumental" ? null : "Soy rock\nSoy rock",
	syncedLyrics:
		kind === "synced" ? "[00:01.00]Soy rock\n[00:05.00]Soy rock" : null,
});

const VERSIONS = [
	version(1, "instrumental", "Instrumentals", -1),
	version(2, "plain", "Compilation", 14),
	version(3, "synced", "Live", 31),
	version(4, "synced", "Album", 0),
	version(5, "plain", "Reissue", 0),
	version(6, "synced", "Single", -12),
	version(7, "synced", "Deluxe", 2),
	version(8, "synced", "Radio edit", -10),
	version(9, "synced", "Extended", 11),
];

const RANKED = {
	synced: ["Album", "Deluxe", "Radio edit", "Extended", "Single", "Live"],
	plain: ["Reissue", "Compilation"],
	instrumental: ["Instrumentals"],
};

const ONE_VERSION = [version(4, "synced", "Album", 0)];

// LRCLIB is another origin and the search carries a header of its own, so a browser
// sends an OPTIONS preflight before every GET.
const CROSS_ORIGIN = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "*",
	"access-control-expose-headers": "Retry-After",
};

type Answer = (route: Route) => Promise<void> | void;

const answering =
	(records: Version[]): Answer =>
	(route) =>
		route.fulfill({ json: records, headers: CROSS_ORIGIN });

const refusing =
	(status: number, headers: Record<string, string> = {}): Answer =>
	(route) =>
		route.fulfill({
			status,
			json: { message: "refused" },
			headers: { ...CROSS_ORIGIN, ...headers },
		});

const dropping: Answer = (route) => route.abort("connectionfailed");

const neverAnswering: Answer = () => {};

const interceptLrclib = async (page: Page, ...answers: Answer[]) => {
	const searches: URL[] = [];
	await page.route("https://lrclib.net/**", (route) => {
		const request = route.request();
		if (request.method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: CROSS_ORIGIN });
		searches.push(new URL(request.url()));
		return answers[Math.min(searches.length, answers.length) - 1](route);
	});
	return searches;
};

const queryOf = (search: URL) => ({
	route: search.pathname,
	title: search.searchParams.get("track_name"),
	artist: search.searchParams.get("artist_name"),
});

const searchView = (panel: Locator) =>
	panel.getByRole("region", { name: "Versions on LRCLIB" });

const titleField = (view: Locator) =>
	view.getByRole("textbox", { name: "Title", exact: true });

const artistField = (view: Locator) =>
	view.getByRole("textbox", { name: "Artist", exact: true });

const searchAgain = (view: Locator) =>
	view.getByRole("button", { name: "Search again", exact: true });

const tryAgain = (view: Locator) =>
	view.getByRole("button", { name: "Try again", exact: true });

const backToLyrics = (view: Locator) =>
	view.getByRole("button", { name: "Back to lyrics", exact: true });

const versionsOf = (view: Locator, kind: "Synced" | "Plain" | "Instrumental") =>
	view
		.getByRole("list", { name: new RegExp(`^${kind}\\b`) })
		.getByRole("listitem");

const FAILED = "The search failed.";

const expectNothingWritten = (player: FakePlayer) =>
	expectSettlesAt(player, () => tagWrites(player).length, 0);

// LRCLIB's traffic is not in the player's log, so wait for the app to go quiet first.
const expectSearchesSettleAt = (
	player: FakePlayer,
	searches: URL[],
	count: number,
) => expectSettlesAt(player, () => searches.length, count);

const openSearch = async (page: Page, isMobile: boolean, row: number) => {
	const panel = await openLyricsOf(page, isMobile, row);
	await searchButton(panel).click();
	return searchView(panel);
};

// A greyed button and a live one that declines the press both send nothing.
const pressRegardless = (button: Locator) => button.click({ force: true });

test.describe("searching LRCLIB", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	test("nothing is asked until Search is pressed, and the press asks once for the playing track's title and artist", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page, answering(VERSIONS));
		const panel = await openLyricsOf(page, isMobile, NO_LYRIC.row);

		await expect(searchButton(panel)).toBeVisible();
		await expectSearchesSettleAt(player, searches, 0);

		await searchButton(panel).click();
		const view = searchView(panel);
		await expect(view).toBeVisible();

		await expectSearchesSettleAt(player, searches, 1);
		expect(queryOf(searches[0])).toEqual({
			route: "/api/search",
			title: NO_LYRIC.title,
			artist: NO_LYRIC.artist,
		});

		await expect(titleField(view)).toHaveValue(NO_LYRIC.title);
		await expect(artistField(view)).toHaveValue(NO_LYRIC.artist);
		await expect(searchAgain(view)).toBeVisible();

		await expectNothingWritten(player);
	});

	// What LRCLIB sends is drawn as it arrives, and React throws on a child that is an object:
	// one such field took the whole page with it.
	test("a version whose album is not text is listed without one, and one whose name is not text is left out", async ({
		page,
		isMobile,
	}) => {
		const misshapen: Answer = (route) =>
			route.fulfill({
				json: [
					{ ...version(4, "synced", "Album", 0), albumName: { name: "Album" } },
					{ ...version(5, "plain", "Reissue", 0), trackName: { text: "Soy" } },
				],
				headers: CROSS_ORIGIN,
			});
		await interceptLrclib(page, misshapen);
		const view = await openSearch(page, isMobile, NO_LYRIC.row);

		await expect(versionsOf(view, "Synced")).toHaveText([/Soy Rock, take 4/]);
		await expect(versionsOf(view, "Plain")).toHaveCount(0);
	});

	test("a changed query is asked for by Search again and by Enter in a field, and never by the typing alone", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page, answering(VERSIONS));
		const view = await openSearch(page, isMobile, NO_LYRIC.row);
		await expectSearchesSettleAt(player, searches, 1);

		// LRCLIB bans a client that asks too often.
		await titleField(view).fill("Soy Rock (Remaster)");
		await expectSearchesSettleAt(player, searches, 1);

		await searchAgain(view).click();
		await expectSearchesSettleAt(player, searches, 2);
		expect(queryOf(searches[1])).toMatchObject({
			title: "Soy Rock (Remaster)",
			artist: NO_LYRIC.artist,
		});

		await artistField(view).fill("Los Babasónicos");
		await artistField(view).press("Enter");
		await expectSearchesSettleAt(player, searches, 3);
		expect(queryOf(searches[2])).toMatchObject({
			title: "Soy Rock (Remaster)",
			artist: "Los Babasónicos",
		});

		await titleField(view).fill("Soy Rock");
		await titleField(view).press("Enter");
		await expectSearchesSettleAt(player, searches, 4);
		expect(queryOf(searches[3])).toMatchObject({
			title: "Soy Rock",
			artist: "Los Babasónicos",
		});

		await expect(titleField(view)).toHaveValue("Soy Rock");
		await expect(artistField(view)).toHaveValue("Los Babasónicos");
		await expectNothingWritten(player);
	});

	test("every version is listed under Synced, Plain and Instrumental in that order, the closest length first within each", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(VERSIONS));
		const view = await openSearch(page, isMobile, NO_LYRIC.row);

		await expect(
			view.getByRole("heading", { name: /^(Synced|Plain|Instrumental)\b/ }),
		).toHaveText([/^Synced/, /^Plain/, /^Instrumental/]);

		const albums = (names: string[]) => names.map((name) => new RegExp(name));
		await expect(versionsOf(view, "Synced")).toHaveText(albums(RANKED.synced));
		await expect(versionsOf(view, "Plain")).toHaveText(albums(RANKED.plain));
		await expect(versionsOf(view, "Instrumental")).toHaveText(
			albums(RANKED.instrumental),
		);

		await expect(view).toContainText(
			`${VERSIONS.length} versions for a track of ${TRACK_LENGTH}`,
		);
		await expectNothingWritten(player);
	});

	test("each version shows its title, artist, album, length and kind, and how far its length is from the track's", async ({
		page,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(VERSIONS));
		const view = await openSearch(page, isMobile, NO_LYRIC.row);

		const synced = versionsOf(view, "Synced");
		await expect(synced).toHaveCount(RANKED.synced.length);

		const same = synced.nth(0);
		await expect(same).toContainText("Soy Rock, take 4");
		await expect(same).toContainText("Los Babasónicos 4");
		await expect(same).toContainText("Album");
		await expect(same).toContainText("2:42");
		await expect(same).toContainText("Synced");
		await expect(same).toContainText("Same length");

		const distances = [
			["Same length", "same"],
			["2 s longer", "near"],
			["10 s shorter", "near"],
			["11 s longer", "far"],
			["12 s shorter", "far"],
			["31 s longer", "far"],
		];
		await expect(synced).toContainText(distances.map(([text]) => text));
		await expect
			.poll(() =>
				synced.evaluateAll((rows) =>
					rows.map((row) => row.getAttribute("data-length")),
				),
			)
			.toEqual(distances.map(([, drawnAs]) => drawnAs));
		await expect(synced.nth(1)).toContainText("2:44");
		await expect(synced.nth(4)).toContainText("2:30");

		const plain = versionsOf(view, "Plain").nth(1);
		await expect(plain).toContainText("Soy Rock, take 2");
		await expect(plain).toContainText("Los Babasónicos 2");
		await expect(plain).toContainText("Compilation");
		await expect(plain).toContainText("2:56");
		await expect(plain).toContainText("Plain");
		await expect(plain).toContainText("14 s longer");

		const instrumental = versionsOf(view, "Instrumental").nth(0);
		await expect(instrumental).toContainText("Soy Rock, take 1");
		await expect(instrumental).toContainText("Instrumentals");
		await expect(instrumental).toContainText("2:41");
		await expect(instrumental).toContainText("1 s shorter");
		await expect(instrumental).toHaveAttribute("data-length", "near");
	});

	test("an empty answer says LRCLIB has nothing, and keeps the query to change and send again", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(
			page,
			answering([]),
			answering(ONE_VERSION),
		);
		const view = await openSearch(page, isMobile, NO_LYRIC.row);

		await expect(view).toContainText("LRCLIB has nothing for this search.");
		await expect(view).toContainText("Try the title without a suffix");
		await expect(view.getByRole("listitem")).toHaveCount(0);

		await expect(titleField(view)).toHaveValue(NO_LYRIC.title);
		await expect(artistField(view)).toHaveValue(NO_LYRIC.artist);

		await titleField(view).fill("Soy");
		await searchAgain(view).click();
		await expect(versionsOf(view, "Synced")).toHaveCount(1);
		await expect(view).not.toContainText("LRCLIB has nothing for this search.");
		expect(queryOf(searches[1])).toMatchObject({ title: "Soy" });

		await expectNothingWritten(player);
	});

	test("the way back returns to the lyric the panel was showing, with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page, answering(VERSIONS));
		const view = await openSearch(page, isMobile, SYNCED.row);
		await expect(view.getByRole("listitem").first()).toBeVisible();

		await backToLyrics(view).click();

		const panel = view.page().getByRole("region", {
			name: isMobile ? "Track information" : "Current track",
		});
		await expect(view).toHaveCount(0);
		await expect(panel.getByText(SYNCED.line)).toBeVisible();
		await expect(searchButton(panel)).toBeVisible();

		await expectSearchesSettleAt(player, searches, 1);
		await expectNothingWritten(player);
	});
});

test.describe("a search that fails", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	// Longer than three retries on a doubling backoff from one second, the default of a query library.
	const LONG_ENOUGH_TO_RETRY_MS = 10_000;

	for (const [how, failure] of [
		["cannot be reached", dropping],
		["answers 500", refusing(500)],
	] as const)
		test(`when LRCLIB ${how} the panel says the search failed, and asks again only when Try again is pressed`, async ({
			page,
			player,
			isMobile,
		}) => {
			await page.clock.install();
			const searches = await interceptLrclib(
				page,
				failure,
				answering(ONE_VERSION),
			);
			const view = await openSearch(page, isMobile, NO_LYRIC.row);

			await expect(view).toContainText(FAILED);
			await expect(tryAgain(view)).toBeVisible();
			await expect(titleField(view)).toHaveValue(NO_LYRIC.title);

			await runClockFor(page, LONG_ENOUGH_TO_RETRY_MS);
			await expectSearchesSettleAt(player, searches, 1);
			await expect(view).toContainText(FAILED);

			await tryAgain(view).click();
			await expect(versionsOf(view, "Synced")).toHaveCount(1);
			await expect(view).not.toContainText(FAILED);
			await expectSearchesSettleAt(player, searches, 2);
			expect(queryOf(searches[1])).toEqual(queryOf(searches[0]));

			await expectNothingWritten(player);
		});

	test("when LRCLIB has not answered after ten seconds the panel says the search failed, and not before", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		const searches = await interceptLrclib(
			page,
			neverAnswering,
			answering(ONE_VERSION),
		);
		const view = await openSearch(page, isMobile, NO_LYRIC.row);
		await expect.poll(() => searches.length).toBe(1);

		await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);

		await runClockFor(page, 8_000);
		await expect(titleField(view)).toHaveValue(NO_LYRIC.title);
		expect(await view.getByText(FAILED).count()).toBe(0);

		await runClockFor(page, 3_000);
		await expect(view).toContainText(FAILED);
		await expect(tryAgain(view)).toBeVisible();

		await runClockFor(page, LONG_ENOUGH_TO_RETRY_MS);
		await expectSearchesSettleAt(player, searches, 1);

		await page.clock.resume();
		await tryAgain(view).click();
		await expect(versionsOf(view, "Synced")).toHaveCount(1);
		await expectSearchesSettleAt(player, searches, 2);

		await expectNothingWritten(player);
	});

	for (const status of [429, 503])
		test(`after a ${status}, nothing more is sent to LRCLIB until its Retry-After has passed`, async ({
			page,
			player,
			isMobile,
		}) => {
			await page.clock.install();
			const searches = await interceptLrclib(
				page,
				refusing(status, { "Retry-After": "30" }),
				answering(ONE_VERSION),
			);
			const view = await openSearch(page, isMobile, NO_LYRIC.row);
			await expect(tryAgain(view)).toBeVisible();
			await expectSearchesSettleAt(player, searches, 1);

			await runClockFor(page, 20_000);
			await pressRegardless(tryAgain(view));
			await pressRegardless(searchAgain(view));
			await titleField(view).press("Enter");
			await expectSearchesSettleAt(player, searches, 1);
			await expect(view.getByRole("listitem")).toHaveCount(0);

			await runClockFor(page, 11_000);
			await tryAgain(view).click();
			await expect(versionsOf(view, "Synced")).toHaveCount(1);
			await expectSearchesSettleAt(player, searches, 2);

			await expectNothingWritten(player);
		});
});

const OPENED_ON = { ...SYNCED, seconds: 277 };

const NUDGED_SOURCE = [
	"[ti:Los Calientes]",
	"[00:10.00]First line",
	"[00:20.00]Second line",
	"[00:30.00]Third line",
].join("\n");

const PLAIN_SOURCE = "Plain one\nPlain two\n\nPlain three";

const record = (
	id: number,
	albumName: string,
	apart: number,
	lyrics: { synced?: string; plain: string },
): Version => ({
	id,
	trackName: `Los Calientes, take ${id}`,
	artistName: "Babasónicos",
	albumName,
	duration: OPENED_ON.seconds + apart,
	instrumental: false,
	plainLyrics: lyrics.plain,
	syncedLyrics: lyrics.synced ?? null,
});

const CLOSEST = record(11, "Album", 0, {
	synced: NUDGED_SOURCE,
	plain: "First line\nSecond line\nThird line",
});
const NEXT_CLOSEST = record(12, "Deluxe", 2, {
	synced: "[00:10.00]Other first\n[00:20.00]Other second",
	plain: "Other first\nOther second",
});
const UNTIMED = record(13, "Reissue", 0, { plain: PLAIN_SOURCE });

const PREVIEWED = [UNTIMED, NEXT_CLOSEST, CLOSEST];

const lyricsPanel = (page: Page, isMobile: boolean) =>
	page.getByRole("region", {
		name: isMobile ? "Track information" : "Current track",
	});

const preview = (panel: Locator) =>
	panel.getByRole("region", { name: "Preview", exact: true });

const openPreviewOf = async (
	page: Page,
	isMobile: boolean,
	kind: "Synced" | "Plain",
	nth: number,
) => {
	const view = await openSearch(page, isMobile, OPENED_ON.row);
	await versionsOf(view, kind).nth(nth).getByRole("button").click();
	const shown = preview(lyricsPanel(page, isMobile));
	await expect(shown).toBeVisible();
	return shown;
};

const backToVersions = (shown: Locator) =>
	shown.getByRole("button", {
		name: `${PREVIEWED.length} versions`,
		exact: true,
	});

const lineOf = (shown: Locator, text: string) =>
	shown.getByRole("button", { name: text, exact: true });

const sungLine = (within: Locator) =>
	within.locator('[aria-current="true"]:not(nav *)');

const holdAt = (player: FakePlayer, position: number) =>
	player.patchPlayer({ position, playbackState: "paused" });

const DURING_FIRST = 13;
const DURING_SECOND = 21;
const DURING_THIRD = 31;

const FAR = 8;

type Scope = "This line" | "All lines";

const stepperFor = async (shown: Locator, isMobile: boolean, scope: Scope) => {
	if (isMobile) {
		const choose = shown.getByRole("button", { name: scope, exact: true });
		await choose.click();
		await expect(choose).toHaveAttribute("aria-pressed", "true");
	}
	return shown.getByRole("group", { name: scope, exact: true });
};

type Step = "−1 s" | "−0.1" | "+0.1" | "+1 s";

const step = (stepper: Locator, by: Step, presses = 1) =>
	times(presses, () =>
		stepper.getByRole("button", { name: by, exact: true }).click(),
	);

const seeks = (player: FakePlayer) =>
	requestsTo(player, "/api/playback/seek").filter(
		(one) => one.method === "POST",
	);

const playingLyricTag = (player: FakePlayer) => {
	const { playlistId, index } = player.player.activeItem;
	return player.playlistById(playlistId)?.items[index]?.[
		`$meta(${LYRIC_FIELD})`
	];
};

test.describe("previewing a version", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	test("a synced version is previewed following the playing position, with word that nothing is written until Save", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);

		await expect(shown).toContainText(CLOSEST.albumName);
		await expect(shown).toContainText(
			isMobile
				? "Not saved yet"
				: "Preview. Nothing is written until you save.",
		);

		holdAt(player, DURING_SECOND);
		await expect(sungLine(shown)).toHaveText("Second line");

		holdAt(player, DURING_THIRD);
		await expect(sungLine(shown)).toHaveText("Third line");

		// A preview counting on by itself reaches a later line by waiting, never an earlier one.
		holdAt(player, DURING_FIRST);
		await expect(sungLine(shown)).toHaveText("First line");

		await expect(shown).not.toContainText("[ti:");
	});

	test("a plain version is previewed as plain text, with no line followed", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Plain", 0);
		holdAt(player, DURING_SECOND);

		await expect(shown).toContainText(UNTIMED.albumName);
		await expect(shown.getByText("Plain one")).toBeVisible();
		await expect(shown.getByText("Plain three")).toBeVisible();

		await untilQuiet(player);
		expect(await sungLine(shown).count()).toBe(0);
	});

	test("a preview writes nothing, seeks nothing, and leaves the panel's lyric as it was", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		const before = playingLyricTag(player);
		expect(before).toContain(OPENED_ON.line);
		holdAt(player, DURING_SECOND);
		await expect(sungLine(shown)).toHaveText("Second line");
		const seeksBefore = seeks(player).length;

		await lineOf(shown, "Third line").click();
		await expect(lineOf(shown, "Third line")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await step(await stepperFor(shown, isMobile, "All lines"), "+1 s");

		await expectNothingWritten(player);
		expect(seeks(player)).toHaveLength(seeksBefore);

		await backToVersions(shown).click();
		const panel = lyricsPanel(page, isMobile);
		await backToLyrics(searchView(panel)).click();

		await expect(panel.getByText(OPENED_ON.line)).toBeVisible();
		await expect(panel).not.toContainText("Second line");
		await expectNothingWritten(player);
		expect(playingLyricTag(player)).toBe(before);
	});

	test("the arrows and the list step between versions in ranked order, and a nudge does not survive the step", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		holdAt(player, DURING_SECOND);

		await expect(shown).toContainText(`1 of ${PREVIEWED.length}`);
		const all = await stepperFor(shown, isMobile, "All lines");
		await step(all, "+1 s", FAR);
		await expect(all).toContainText("+8.00 s");
		await expect(sungLine(shown)).toHaveText("First line");

		await shown.getByRole("button", { name: "Next version" }).click();
		await expect(shown).toContainText(`2 of ${PREVIEWED.length}`);
		await expect(shown).toContainText(NEXT_CLOSEST.albumName);
		await expect(sungLine(shown)).toHaveText("Other second");

		await shown.getByRole("button", { name: "Next version" }).click();
		await expect(shown).toContainText(`3 of ${PREVIEWED.length}`);
		await expect(shown).toContainText(UNTIMED.albumName);
		await expect(shown.getByText("Plain one")).toBeVisible();

		await shown.getByRole("button", { name: "Previous version" }).click();
		await shown.getByRole("button", { name: "Previous version" }).click();
		await expect(shown).toContainText(`1 of ${PREVIEWED.length}`);
		await expect(sungLine(shown)).toHaveText("Second line");
		await expect(shown).not.toContainText("+8.00 s");

		await step(await stepperFor(shown, isMobile, "All lines"), "+1 s", FAR);
		await expect(sungLine(shown)).toHaveText("First line");
		await backToVersions(shown).click();
		const view = searchView(lyricsPanel(page, isMobile));
		await versionsOf(view, "Synced").nth(1).getByRole("button").click();
		await expect(shown).toContainText(`2 of ${PREVIEWED.length}`);
		await backToVersions(shown).click();
		await versionsOf(view, "Synced").nth(0).getByRole("button").click();
		await expect(shown).toContainText(`1 of ${PREVIEWED.length}`);
		await expect(sungLine(shown)).toHaveText("Second line");

		await expectNothingWritten(player);
	});

	test("every line at once is moved later and earlier, by a tenth of a second and by a second", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		const all = await stepperFor(shown, isMobile, "All lines");

		holdAt(player, DURING_SECOND);
		await expect(sungLine(shown)).toHaveText("Second line");

		await step(all, "+0.1");
		await expect(all).toContainText("+0.10 s");
		await step(all, "+1 s");
		await expect(all).toContainText("+1.10 s");
		await step(all, "−0.1");
		await expect(all).toContainText("+1.00 s");

		await step(all, "+1 s", FAR - 1);
		await expect(all).toContainText("+8.00 s");
		await expect(sungLine(shown)).toHaveText("First line");

		await step(all, "−1 s", FAR);
		await expect(all).not.toContainText("1.00 s");
		await expect(sungLine(shown)).toHaveText("Second line");

		holdAt(player, DURING_FIRST);
		await expect(sungLine(shown)).toHaveText("First line");

		await step(all, "−0.1");
		await expect(all).toContainText("−0.10 s");
		await step(all, "−1 s");
		await expect(all).toContainText("−1.10 s");

		await step(all, "−1 s", FAR - 1);
		await expect(all).toContainText("−8.10 s");
		await expect(sungLine(shown)).toHaveText("Second line");
	});

	test("one selected line is moved by the same steps, and the lines around it stay where they were", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);

		holdAt(player, DURING_SECOND);
		await expect(sungLine(shown)).toHaveText("Second line");

		await lineOf(shown, "Second line").click();
		await expect(lineOf(shown, "Second line")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const one = await stepperFor(shown, isMobile, "This line");

		await step(one, "+0.1");
		await expect(one).toContainText("+0.10 s");
		await step(one, "+1 s");
		await expect(one).toContainText("+1.10 s");
		await step(one, "−0.1");
		await expect(one).toContainText("+1.00 s");

		await step(one, "+1 s", FAR - 1);
		await expect(one).toContainText("+8.00 s");
		await expect(sungLine(shown)).toHaveText("First line");

		holdAt(player, DURING_THIRD);
		await expect(sungLine(shown)).toHaveText("Third line");

		await step(one, "−1 s", FAR);
		await expect(one).not.toContainText("1.00 s");
		holdAt(player, DURING_SECOND);
		await expect(sungLine(shown)).toHaveText("Second line");

		await step(one, "−0.1");
		await expect(one).toContainText("−0.10 s");
		await step(one, "−1 s");
		await expect(one).toContainText("−1.10 s");

		await lineOf(shown, "Third line").click();
		await expect(
			await stepperFor(shown, isMobile, "This line"),
		).not.toContainText("1.10 s");

		await expectNothingWritten(player);
	});
});

const LONG_NAMED = {
	...record(
		14,
		"The Complete Original Soundtrack Recordings: Collector's Edition",
		3,
		{
			synced: NUDGED_SOURCE,
			plain: "First line\nSecond line\nThird line",
		},
	),
	artistName: "Babasónicos and the Orchestra of the Long Afternoon",
};
const LONG_NAMED_LENGTH = "4:40";
const NARROWEST_PHONE = { width: 320, height: 720 };

// Text an ancestor clips is still in the page, so a clipped length reads whole to a locator.
const clippedBy = (drawn: Locator) =>
	drawn.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const clips: string[] = [];
		for (
			let ancestor = element.parentElement;
			ancestor;
			ancestor = ancestor.parentElement
		) {
			if (getComputedStyle(ancestor).overflowX === "visible") continue;
			const within = ancestor.getBoundingClientRect();
			if (box.left < within.left - 0.5 || box.right > within.right + 0.5)
				clips.push(ancestor.tagName.toLowerCase());
		}
		if (box.left < 0 || box.right > document.documentElement.clientWidth)
			clips.push("viewport");
		if (element.scrollWidth > element.clientWidth) clips.push("itself");
		return clips;
	});

const expectDrawnWhole = async (length: Locator) => {
	await expect(length).toHaveCount(1);
	await expect(length).toBeVisible();
	await expect.poll(() => clippedBy(length)).toEqual([]);
};

test.describe("a version whose artist and album are long", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	const lengthIn = (within: Locator) =>
		within.getByText(LONG_NAMED_LENGTH, { exact: true });

	test("the preview draws its length whole, and the names give way", async ({
		page,
		isMobile,
	}) => {
		await interceptLrclib(page, answering([LONG_NAMED]));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);

		await expect(shown).toContainText(LONG_NAMED.albumName);
		await expectDrawnWhole(lengthIn(shown));
	});

	test.describe("on the narrowest phone", () => {
		test.skip(
			({ isMobile }) => !isMobile,
			"the desktop's window is never this narrow",
		);

		test("the versions list and the preview both draw its length whole", async ({
			page,
		}) => {
			await page.setViewportSize(NARROWEST_PHONE);
			await interceptLrclib(page, answering([LONG_NAMED]));
			const view = await openSearch(page, true, OPENED_ON.row);
			const row = versionsOf(view, "Synced").first();

			await expect(row).toContainText(LONG_NAMED.albumName);
			await expectDrawnWhole(lengthIn(row));

			await row.getByRole("button").click();
			const shown = preview(lyricsPanel(page, true));
			await expect(shown).toBeVisible();
			await expectDrawnWhole(lengthIn(shown));
		});
	});
});

test.describe("saving a preview", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	const save = (shown: Locator) =>
		shown.getByRole("button", { name: "Save", exact: true });

	const lyricWrites = (player: FakePlayer) =>
		tagWrites(player).map((one) => one.body?.fields);

	const nudge = async (shown: Locator, isMobile: boolean) => {
		const all = await stepperFor(shown, isMobile, "All lines");
		await step(all, "+1 s", FAR);
		await step(all, "−0.1");
		await lineOf(shown, "Second line").click();
		const one = await stepperFor(shown, isMobile, "This line");
		await step(one, "−1 s");
		await step(one, "+0.1");
	};

	const ALL_MOVED = "+7.90 s";

	const NUDGED = [
		"[ti:Los Calientes]",
		"[00:17.90]First line",
		"[00:27.00]Second line",
		"[00:37.90]Third line",
	].join("\n");

	test("Save writes the lyric as nudged, once, and the panel shows it at once with no toast", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		await nudge(shown, isMobile);

		await save(shown).click();

		const panel = lyricsPanel(page, isMobile);
		await expect(panel.getByText("Second line")).toBeVisible();
		await expect(shown).toHaveCount(0);
		await expect(searchView(panel)).toHaveCount(0);
		await expect(panel).not.toContainText(OPENED_ON.line);

		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: NUDGED },
		]);
		expect(await toasts(page).count()).toBe(0);

		holdAt(player, DURING_SECOND);
		await expect(sungLine(panel)).toHaveText("First line");

		await page.reload();
		const reread = await openPanels(page, isMobile);
		await panelTab(reread, "Lyrics").click();
		await expect(reread.getByText("Third line")).toBeVisible();
		await expect(reread).not.toContainText(OPENED_ON.line);
		expect(playingLyricTag(player)).toBe(NUDGED);
	});

	test("a plain version is saved as plain text, with no stamps and no header rows", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Plain", 0);
		await expect(shown.getByText("Plain one")).toBeVisible();

		await save(shown).click();

		const panel = lyricsPanel(page, isMobile);
		await expect(shown).toHaveCount(0);
		await expect(panel.getByText("Plain three")).toBeVisible();
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: PLAIN_SOURCE },
		]);
		expect(await toasts(page).count()).toBe(0);
	});

	for (const [status, said] of [
		[500, "The lyric was not saved to Los Calientes"],
		[403, "does not allow lyrics to be written"],
	] as const)
		test.describe(`where the player answers the write ${status}`, () => {
			test.use({ fooJean: { ...SAVING_POSSIBLE, failWrites: status } });

			test("a toast says the lyric was not saved, and the preview stays open with its nudges", async ({
				page,
				player,
				isMobile,
			}) => {
				await interceptLrclib(page, answering(PREVIEWED));
				const shown = await openPreviewOf(page, isMobile, "Synced", 0);
				const before = playingLyricTag(player);
				expect(before).toContain(OPENED_ON.line);
				holdAt(player, DURING_SECOND);
				await nudge(shown, isMobile);
				await expect(sungLine(shown)).toHaveText("First line");

				await save(shown).click();

				await expect(toastRegion(page).getByText(said)).toBeVisible();
				await untilQuiet(player);

				await expect(shown).toBeVisible();
				await expect(shown).toContainText(CLOSEST.albumName);
				await expect(sungLine(shown)).toHaveText("First line");
				await expect(
					await stepperFor(shown, isMobile, "All lines"),
				).toContainText(ALL_MOVED);
				await expect(save(shown)).toBeVisible();
				expect(playingLyricTag(player)).toBe(before);
			});
		});
});

const OPENED_ON_TITLE = "Los Calientes";

const savePreview = (shown: Locator) =>
	shown.getByRole("button", { name: "Save", exact: true });

const ALL_LATER = "+8.00 s";

const nudgeEveryLineLater = async (shown: Locator, isMobile: boolean) => {
	const all = await stepperFor(shown, isMobile, "All lines");
	await step(all, "+1 s", FAR);
	await expect(all).toContainText(ALL_LATER);
};

const LATER = [
	"[ti:Los Calientes]",
	"[00:18.00]First line",
	"[00:28.00]Second line",
	"[00:38.00]Third line",
].join("\n");

interface Leaving {
	by: string;
	leave: (page: Page, isMobile: boolean) => Promise<unknown>;
	expectLeft: (page: Page, isMobile: boolean) => Promise<unknown>;
}

const LEAVINGS: Leaving[] = [
	{
		by: "choosing another tab",
		leave: (page, isMobile) =>
			panelTab(lyricsPanel(page, isMobile), "Details").click(),
		expectLeft: (page, isMobile) =>
			expectPanelOpen(lyricsPanel(page, isMobile), "Details"),
	},
	{
		by: "closing the screen the panel is on",
		leave: (page, isMobile) =>
			isMobile
				? trackInfo(page)
						.getByRole("button", { name: "Close track information" })
						.click()
				: page.keyboard.press("Escape"),
		expectLeft: (page, isMobile) =>
			expect(isMobile ? trackInfo(page) : nowPlayingScreen(page)).toBeHidden(),
	},
	{
		by: "the browser's Back",
		leave: (page) => page.goBack(),
		expectLeft: (page) => expect(page).not.toHaveURL(/#\/playing/),
	},
];

test.describe("leaving a preview", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	for (const { by, leave, expectLeft } of LEAVINGS) {
		test(`${by} with a nudge not saved asks first: Keep editing returns to the preview as nudged, and Discard leaves it with nothing written`, async ({
			page,
			player,
			isMobile,
		}) => {
			await interceptLrclib(page, answering(PREVIEWED));
			const shown = await openPreviewOf(page, isMobile, "Synced", 0);
			const before = playingLyricTag(player);
			await nudgeEveryLineLater(shown, isMobile);
			holdAt(player, DURING_SECOND);
			await expect(sungLine(shown)).toHaveText("First line");

			await leave(page, isMobile);
			const prompt = await expectDiscardPrompt(page);
			await keepEditingButton(prompt).click();

			await expect(prompt).toHaveCount(0);
			await expectTheScreenIsStillOpen(page);
			await expect(shown).toBeVisible();
			await expect(shown).toContainText(CLOSEST.albumName);
			await expect(
				await stepperFor(shown, isMobile, "All lines"),
			).toContainText(ALL_LATER);
			await expect(sungLine(shown)).toHaveText("First line");

			await leave(page, isMobile);
			await expectDiscardPrompt(page);
			await discardButton(prompt).click();

			await expect(prompt).toHaveCount(0);
			await expect(shown).toHaveCount(0);
			await expectNothingWritten(player);
			expect(playingLyricTag(player)).toBe(before);
		});

		test(`${by} from a preview nothing was nudged in leaves without asking`, async ({
			page,
			player,
			isMobile,
		}) => {
			await recordPromptsEverShown(page);
			await interceptLrclib(page, answering(PREVIEWED));
			const shown = await openPreviewOf(page, isMobile, "Synced", 0);
			await lineOf(shown, "Second line").click();
			await expect(lineOf(shown, "Second line")).toHaveAttribute(
				"aria-pressed",
				"true",
			);

			await leave(page, isMobile);

			await expectLeft(page, isMobile);
			await untilQuiet(player);
			expect(await promptsEverShown(page)).toEqual([]);
			await expectNothingWritten(player);
		});
	}

	test("after a Save that landed, nothing asks, then or on the next way out", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		await nudgeEveryLineLater(shown, isMobile);

		await savePreview(shown).click();

		await expect(shown).toHaveCount(0);
		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		const panel = lyricsPanel(page, isMobile);
		await panelTab(panel, "Details").click();
		await expectPanelOpen(panel, "Details");
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toEqual([]);
	});
});

test.describe("the track changes under an open preview", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	const SKIPPED_TO = "Fizz";

	const EARLIER = "−12.00 s";

	test("the preview stays with its nudges and follows no line of the other song, and follows again when its own track plays", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		const all = await stepperFor(shown, isMobile, "All lines");
		await step(all, "−1 s", 12);
		await expect(all).toContainText(EARLIER);
		await expect(sungLine(shown)).toHaveCount(1);

		player.next();
		await untilThePageKnowsPlaying(page, SKIPPED_TO);
		await untilQuiet(player);

		await expect(shown).toBeVisible();
		await expect(shown).toContainText(CLOSEST.albumName);
		await expect(await stepperFor(shown, isMobile, "All lines")).toContainText(
			EARLIER,
		);
		expect(await sungLine(shown).count()).toBe(0);

		await step(await stepperFor(shown, isMobile, "All lines"), "+1 s");
		await expect(await stepperFor(shown, isMobile, "All lines")).toContainText(
			"−11.00 s",
		);

		player.previous();
		await untilThePageKnowsPlaying(page, OPENED_ON_TITLE);
		await expect(sungLine(shown)).toHaveCount(1);
		await expect(await stepperFor(shown, isMobile, "All lines")).toContainText(
			"−11.00 s",
		);
		await expectNothingWritten(player);
	});

	test("Save writes once, to the track the preview opened on, and the playing track's lyric is left alone", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		await nudgeEveryLineLater(shown, isMobile);
		const others = lyricTagOf(player, SKIPPED_TO);
		expect(others).toContain(PLAIN.line);

		player.next();
		await untilThePageKnowsPlaying(page, SKIPPED_TO);
		await expect(savePreview(shown)).toBeVisible();
		await savePreview(shown).click();

		await expect(shown).toHaveCount(0);
		await expectSettlesAt(
			player,
			() => tagWrites(player).map((one) => one.body?.fields),
			[{ [LYRIC_FIELD]: LATER }],
		);
		expect(titleAddressedBy(player, tagWrites(player)[0]?.body)).toBe(
			OPENED_ON_TITLE,
		);
		expect(lyricTagOf(player, OPENED_ON_TITLE)).toBe(LATER);
		expect(lyricTagOf(player, SKIPPED_TO)).toBe(others);
		expect(await toasts(page).count()).toBe(0);

		const panel = lyricsPanel(page, isMobile);
		await expect(panel).toContainText(PLAIN.line);
		await expect(panel).not.toContainText("Second line");
	});
});

test.describe("leaving the Lyrics tab with a search open, and coming back", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	// Twice, so a view that survived the first trip by luck of what was still mounted is tested again.
	const toDetailsAndBack = (page: Page, isMobile: boolean) => {
		const panel = lyricsPanel(page, isMobile);
		return times(2, async () => {
			await panelTab(panel, "Details").click();
			await expectPanelOpen(panel, "Details");
			await panelTab(panel, "Lyrics").click();
			await expectPanelOpen(panel, "Lyrics");
		});
	};

	test("the versions are still listed, and LRCLIB has been asked once", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page, answering(PREVIEWED));
		const view = await openSearch(page, isMobile, OPENED_ON.row);
		await expect(versionsOf(view, "Synced")).toHaveCount(2);
		await expectSearchesSettleAt(player, searches, 1);

		await toDetailsAndBack(page, isMobile);

		await expect(view).toBeVisible();
		await expect(versionsOf(view, "Synced")).toHaveCount(2);
		await expect(versionsOf(view, "Plain")).toHaveCount(1);
		await expectSearchesSettleAt(player, searches, 1);
		await expectNothingWritten(player);
	});

	test("a preview nothing was nudged in is still the one shown, and LRCLIB has been asked once", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const searches = await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, isMobile, "Synced", 1);
		await expect(shown).toContainText(`2 of ${PREVIEWED.length}`);
		await expectSearchesSettleAt(player, searches, 1);

		await toDetailsAndBack(page, isMobile);

		await expect(shown).toBeVisible();
		await expect(shown).toContainText(`2 of ${PREVIEWED.length}`);
		await expect(shown).toContainText(NEXT_CLOSEST.albumName);
		await expectSearchesSettleAt(player, searches, 1);
		expect(await promptsEverShown(page)).toEqual([]);
	});
});

const editorOver = (page: Page) =>
	page.getByRole("dialog", { name: "Edit lyrics", exact: true });

test.describe("a nudged preview opened in the editor", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });

	const NUDGED_FIRST = /0:18\.00\s*First line/;

	const openNudgedInEditor = async (page: Page, isMobile: boolean) => {
		const shown = await openPreviewOf(page, isMobile, "Synced", 0);
		await nudgeEveryLineLater(shown, isMobile);
		await shown
			.getByRole("button", { name: "Open in editor", exact: true })
			.click();
		const editor = editorOver(page);
		await expect(editor).toContainText(NUDGED_FIRST);
		return { shown, editor };
	};

	const expectStillNudged = async (shown: Locator, isMobile: boolean) => {
		await expect(shown).toBeVisible();
		await expect(await stepperFor(shown, isMobile, "All lines")).toContainText(
			ALL_LATER,
		);
	};

	test("closing the editor with nothing changed in it returns to the preview as nudged without asking, and leaving the preview then asks", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		await interceptLrclib(page, answering(PREVIEWED));
		const { shown, editor } = await openNudgedInEditor(page, isMobile);

		await editor.getByRole("button", { name: "Close", exact: true }).click();

		await expect(editor).toHaveCount(0);
		await expectStillNudged(shown, isMobile);
		expect(await promptsEverShown(page)).toEqual([]);

		await panelTab(lyricsPanel(page, isMobile), "Details").click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();
		await expectStillNudged(shown, isMobile);
		await expectNothingWritten(player);
	});

	test("the browser's Back from the editor with nothing changed in it asks first: Keep editing keeps the editor and the nudges under it, and Discard leaves with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const { shown, editor } = await openNudgedInEditor(page, isMobile);
		const before = playingLyricTag(player);

		await page.goBack();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);
		await expect(editor).toBeVisible();
		await expect(editor).toContainText(NUDGED_FIRST);
		await editor.getByRole("button", { name: "Close", exact: true }).click();
		await expect(editor).toHaveCount(0);
		await expectStillNudged(shown, isMobile);

		await page.goBack();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expect(shown).toHaveCount(0);
		await expectNothingWritten(player);
		expect(playingLyricTag(player)).toBe(before);
	});
});

test.describe("a link on the screen, pressed over a nudged preview", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });
	test.skip(
		({ isMobile }) => isMobile,
		"on the phone the preview is in a layer over the whole screen, and no link is in it",
	);

	test("Keep editing leaves the history as it was, and Back then leaves the screen once, for the list it was opened from", async ({
		page,
		player,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, false, "Synced", 0);
		await nudgeEveryLineLater(shown, false);
		const entries = () => page.evaluate(() => history.length);
		const before = await entries();
		const playing = page.url();

		await nowPlayingScreen(page)
			.getByRole("link", { name: "Babasónicos", exact: true })
			.first()
			.click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expect(page).toHaveURL(playing);
		await expectTheScreenIsStillOpen(page);
		await expect(await stepperFor(shown, false, "All lines")).toContainText(
			ALL_LATER,
		);
		expect(await entries()).toBe(before);

		await page.goBack();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expect(page).toHaveURL(
			new RegExp(`#/${guidOfPlaylist(player, "p7")}$`),
		);
		await expect(nowPlayingScreen(page)).toBeHidden();
		await expectNothingWritten(player);
	});
});

test.describe("touch targets in the search and the preview", () => {
	test.use({ ...TAGGED, fooJean: SAVING_POSSIBLE });
	test.skip(
		({ isMobile }) => !isMobile,
		"a touch target is the phone's, and the desktop's controls are sized for a pointer",
	);

	// A label wraps its input, so tapping the label focuses the box.
	const fieldOf = (view: Locator, name: "Title" | "Artist") =>
		view
			.locator("label")
			.filter({ has: view.page().getByRole("textbox", { name, exact: true }) });

	test("every control of the versions list is at least as tall as the queue's controls", async ({
		page,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const view = await openSearch(page, true, OPENED_ON.row);
		await expect(versionsOf(view, "Synced")).toHaveCount(2);

		await expectTouchTargets([
			["Back to lyrics", backToLyrics(view)],
			["Title", fieldOf(view, "Title")],
			["Artist", fieldOf(view, "Artist")],
			["Search again", searchAgain(view)],
			...(await view.getByRole("listitem").getByRole("button").all()).map(
				(row, at) => [`version ${at + 1}`, row] as const,
			),
		]);
	});

	test("Try again on a failed search is at least as tall as the queue's controls", async ({
		page,
	}) => {
		await interceptLrclib(page, refusing(500));
		const view = await openSearch(page, true, OPENED_ON.row);
		await expect(view).toContainText(FAILED);

		await expectTouchTargets([["Try again", tryAgain(view)]]);
	});

	test("every control of the preview is at least as tall as the queue's controls", async ({
		page,
	}) => {
		await interceptLrclib(page, answering(PREVIEWED));
		const shown = await openPreviewOf(page, true, "Synced", 0);
		await lineOf(shown, "Second line").click();
		const button = (name: string) =>
			shown.getByRole("button", { name, exact: true });
		const stepper = shown.getByRole("group", {
			name: "This line",
			exact: true,
		});

		await expectTouchTargets([
			["the way back to the versions", backToVersions(shown)],
			["Previous version", button("Previous version")],
			["Next version", button("Next version")],
			["This line", button("This line")],
			["All lines", button("All lines")],
			...(["−1 s", "−0.1", "+0.1", "+1 s"] as const).map(
				(by) =>
					[by, stepper.getByRole("button", { name: by, exact: true })] as const,
			),
			["Open in editor", button("Open in editor")],
			["Save", button("Save")],
		]);
	});
});
