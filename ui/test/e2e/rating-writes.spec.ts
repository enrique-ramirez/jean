import { en } from "../../src/shared/i18n/en.ts";
import {
	fill,
	formOf,
	type Message,
	type Values,
} from "../../src/shared/i18n/message.ts";
import { STALLED_READ_MS } from "../fake-api/fooJean.ts";
import type { RecordedRequest, Track } from "../fake-api/state.ts";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	inSequence,
	nowPlayingScreen,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSettings,
	pressAndHold,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";
import { openPanels, panelTab, writeLyric } from "./nowPlaying.ts";

// The fake serves `foo_jean` on a second port, so everything here crosses a
// real origin boundary.

// Row numbers below are positions in the captured `Library` playlist: 0 Los
// Calientes, 1 Fizz, 2 Deléctrico, 3 Soy Rock, 4 Pendejo. The column set is
// pinned for the reason `rating.spec.ts` gives.
const RATED = {
	settings: { "jean.columns": ["duration", "rating"] },
	retagged: {
		"Los Calientes": { "%rating%": "5" }, // native scale, writable
		Deléctrico: { "%rating%": "3" }, // native scale, writable
		"Soy Rock": { "%rating%": "0" }, // unrated, writable
		Pendejo: { "%rating%": "100" }, // 0-100 scale -- read-only
	},
};

// Row 2 as the media library holds it: the path under the library root,
// forward-slashed. It is the address `GET /api/artwork?track=` takes, and the
// only one a write may name a file by.
const DELECTRICO = "B/Babasónicos/(2001) Jessico/03. Deléctrico.mp3";
const I_STAY_AWAY =
	"A/Alice in Chains/(1994) Jar Of Flies/03. I Stay Away.flac";
const FIZZ = "B/Babasónicos/(2001) Jessico/02. Fizz.mp3";
const LOS_CALIENTES = "B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3";
const SOY_ROCK = "B/Babasónicos/(2001) Jessico/04. Soy Rock.mp3";

const readOnlyStars = (page: Page, row: number) =>
	trackRow(page, row).getByRole("img", { name: /stars|Unrated/ });

const ratingOf = (page: Page, row: number) =>
	readOnlyStars(page, row).or(
		trackRow(page, row).getByRole("group", { name: /stars|Unrated/ }),
	);

const star = (page: Page, row: number, value: number) =>
	trackRow(page, row).getByRole("button", { name: `Rate ${value} of 5` });

// The now-playing screen's interactive control rather than the inert one beside
// it: `Stars` is an `img` and `StarsInput` a `group`, so the role is half the
// assertion wherever this is used.
const starsOnScreen = (page: Page) =>
	nowPlayingScreen(page).getByRole("group", { name: /stars|Unrated/ });

const tagWrites = (player: FakePlayer) => requestsTo(player, "/api/tags");

const routeOf = (path: string) => path.split("?")[0];

// Everything a click cost: the write and anything sent to work out what to
// write to. Left out because it is nobody's click: the player poll, which
// runs once a second whatever happens.
const asksSince = (player: FakePlayer, from: number) =>
	player.requests
		.slice(from)
		.filter((entry) => routeOf(entry.path) !== "/api/state")
		.map((entry) => `${entry.method} ${routeOf(entry.path)}`);

// A view asks for a cover per record on the way in, and those are nobody's
// click. Letting the request log stop moving before anything is counted is what
// keeps them out of the count, and it says on the way past that nothing has been
// written yet.
const nothingWrittenYet = (player: FakePlayer) =>
	expectSettlesAt(player, () => tagWrites(player).length, 0);

// Every message the page puts up from here on. A toast takes itself down after a
// few seconds, so looking for one afterwards cannot tell "never said" from "said
// and gone", and a retrying `toHaveCount(0)` waits a real one out and passes.
// Several cases here promise silence, so silence has to mean nothing was ever
// said.
const watchWhatIsSaid = async (page: Page) => {
	await page.evaluate(() => {
		const said: string[] = [];
		(window as unknown as { said: string[] }).said = said;
		new MutationObserver(() => {
			for (const layer of document.querySelectorAll('[role="status"]')) {
				const text = layer.textContent ?? "";
				if (text && !said.includes(text)) said.push(text);
			}
		}).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});

	return () =>
		page.evaluate(() => (window as unknown as { said: string[] }).said);
};

// The address a write named, with what it wrote and the subsong set aside: an
// ordinary file's subsong is omitted and read as 0, so it is read rather than
// compared.
const addressOf = (entry: RecordedRequest) => {
	const address = { ...entry.body };
	delete address.fields;
	delete address.subsong;
	return address;
};

const subsongOf = (entry: RecordedRequest) => entry.body?.subsong ?? 0;

interface WriteBody {
	track?: string;
	fields?: Record<string, string>;
}

// Writes stopped at the door on their way out of the browser, so what the client
// has open is exactly what the test has not let through. A write counted here is
// one the client chose to send: it is the only way to tell a second write in
// flight from a second write sent after the first came back. Every one is let go
// before the test ends, or the route handler outlives it.
const holdTheWrites = async (page: Page) => {
	const sent: WriteBody[] = [];
	const waiting: (() => void)[] = [];
	let open = false;

	await page.route(
		(url) => url.pathname === "/api/tags",
		async (route) => {
			sent.push(route.request().postDataJSON() as WriteBody);
			if (!open) await new Promise<void>((resolve) => waiting.push(resolve));
			return route.continue();
		},
	);

	return {
		sent,
		letOneThrough: () => waiting.shift()?.(),
		openTheDoor: () => {
			open = true;
			while (waiting.length > 0) waiting.shift()?.();
		},
	};
};

// Rendered through the app's own formatter rather than by hand, so a phrase that
// counts its stars reads here the way the toast reads it.
const saying = (message: Message, values: Values) =>
	fill(
		formOf(message, values, new Intl.PluralRules("en")),
		values,
		new Intl.NumberFormat("en"),
	);

const didNotLand = (track: string, stars: number) =>
	saying(en["rate.didNotLand"], { track, count: stars });

const notRemoved = (track: string) => saying(en["rate.notRemoved"], { track });

// The tail of this one is the component's own words for what went wrong, so what
// is matched is the half the catalogue writes.
const wasNotRated = (label: string) =>
	saying(en["rate.failed"], { label, message: "" }).trim();

// The ordinal the media library holds a track at: its position in the snapshot's
// own order, which is the position an export hands a client and the one address
// that names a single track wherever two roots hold the same relative path.
const ordinalOf = (player: FakePlayer, track: string) => {
	const at = player.ordinalOrder().findIndex((entry) => entry.path === track);
	if (at < 0) throw new Error(`the media library holds no ${track}`);
	return at;
};

// Read off the player's own copy of the file, so a star painted before the write
// went out is no evidence that anything was written.
const libraryRatingOf = (player: FakePlayer, track: string) =>
	player.ordinalOrder().find((entry) => entry.path === track)?.track[
		"%rating%"
	];

const ratingsWritten = (player: FakePlayer) =>
	tagWrites(player).map((entry) => [
		entry.body?.track,
		entry.body?.fields.rating,
	]);

test.describe("with writing switched off", () => {
	test.use({
		...RATED,
		fooJean: { allowedFields: [] },
	});

	test("draws the same read-only column", async ({ page }) => {
		await openLibrary(page);
		await expect(readOnlyStars(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 0).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
	});
});

test.describe("with foo_jean connected", () => {
	test.use({ ...RATED, fooJean: {} });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("clicking a star sends one request and no other, naming the row's library path", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		await nothingWrittenYet(player);

		const before = player.requests.length;
		await star(page, 2, 4).click();

		await expectSettlesAt(player, () => asksSince(player, before), [
			"POST /api/tags",
		]);
		const [write] = tagWrites(player);
		// A playlist row the media library holds is written by its path and not by
		// its position: the path survives a reorder and the position does not.
		expect(addressOf(write)).toEqual({ track: DELECTRICO });
		expect(subsongOf(write)).toBe(0);
		expect(write.body).toMatchObject({ fields: { rating: "4" } });

		// Optimistic, since beefweb pushes nothing when a track's tags change.
		await expect(page.locator('[role="row"][data-row="2"]')).toContainText(
			"Deléctrico",
		);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
		await expect(
			trackRow(page, 2).getByRole("button", { name: /^Clear rating/ }),
		).toBeVisible();
	});

	// Read back off the player rather than out of Jean's own cache.
	test("the value survives a reload", async ({ page, player }) => {
		await openLibrary(page);
		await star(page, 2, 2).click();
		await expectSettlesAt(player, () => tagWrites(player).length, 1);

		await page.reload();
		await openLibrary(page);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("2 of 5 stars");
	});

	test("clicking the star already set clears the rating", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2)
			.getByRole("button", { name: "Clear rating (3 of 5 stars)" })
			.click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "" },
		});

		await page.reload();
		await openLibrary(page);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("Unrated");
	});

	// `100` is a rating on the 0-100 scale, and writing a native `4` over it would
	// turn 4% into four stars.
	test("a track on another scale is read-only and sends nothing", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		await expect(readOnlyStars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 4).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);

		// Per track rather than the column giving up.
		await expect(star(page, 2, 4)).toBeVisible();
		await expectSettlesAt(player, () => tagWrites(player), []);
	});

	test("five digits on one row send the first, then one write for the fifth, and never two at once", async ({
		page,
		player,
	}) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await expect(star(page, 2, 1)).toBeVisible();

		// Each star is one above the last, so every one is still labelled "Rate",
		// and none of the five is the one that clears.
		for (const value of [1, 2, 3, 4, 5]) await star(page, 2, value).click();
		await expect(ratingOf(page, 2)).toHaveAccessibleName("5 of 5 stars");

		// The first digit goes at once, with nothing to wait behind. The other four
		// are pressed while it is open, and it stays the only write in flight.
		await expectSettlesAt(player, () => writes.sent.length, 1);
		expect(writes.sent[0]).toMatchObject({ fields: { rating: "1" } });

		writes.letOneThrough();

		// One write for the four digits behind it, carrying the last of them.
		// Nothing is ever sent for 2, 3 or 4.
		await expect.poll(() => writes.sent.length).toBe(2);
		expect(writes.sent[1]).toMatchObject({ fields: { rating: "5" } });
		await expectSettlesAt(player, () => writes.sent.length, 2);

		writes.openTheDoor();
		await expectSettlesAt(player, () => ratingsWritten(player), [
			[DELECTRICO, "1"],
			[DELECTRICO, "5"],
		]);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("5 of 5 stars");
	});

	// Hovering the star that would clear a rating fades the stars, and clicking a
	// star must not leave the clearing preview armed under a pointer that has not
	// moved.
	test("keep showing the rating they hold, hovered and clicked", async ({
		page,
	}) => {
		await openLibrary(page);

		await trackRow(page, 0)
			.getByRole("button", { name: "Clear rating (5 of 5 stars)" })
			.hover();
		await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");

		await star(page, 2, 5).hover();
		await star(page, 2, 5).click();
		await expect(ratingOf(page, 2)).toHaveAccessibleName("5 of 5 stars");
	});

	test("rows rated while a write is open each keep the rating they were given", async ({
		page,
		player,
	}) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await expect(star(page, 0, 1)).toBeVisible();

		// Row 0's write holds the door, so rows 2 and 3 are waiting together rather
		// than one behind the other. One pending value for the whole column drops
		// row 2 here.
		await star(page, 0, 1).click();
		await star(page, 2, 4).click();
		await star(page, 3, 2).click();

		await expectSettlesAt(player, () => writes.sent.length, 1);
		writes.openTheDoor();

		await expectSettlesAt(player, () => ratingsWritten(player), [
			[LOS_CALIENTES, "1"],
			[DELECTRICO, "4"],
			[SOY_ROCK, "2"],
		]);
		await expect(ratingOf(page, 0)).toHaveAccessibleName("1 of 5 stars");
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
		await expect(ratingOf(page, 3)).toHaveAccessibleName("2 of 5 stars");
	});

	// The component answers with the tag as it now stands, and a player keeping
	// ratings on a scale of its own does not store the digit it was handed.
	test.describe("a player that keeps a rating its own way", () => {
		test.use({ fooJean: { storesRatingAs: "2" } });

		test("the star takes the rating the component stored, not the one clicked", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await star(page, 2, 4).click();

			await expectSettlesAt(player, () => ratingsWritten(player), [
				[DELECTRICO, "4"],
			]);
			await expect(ratingOf(page, 2)).toHaveAccessibleName("2 of 5 stars");
		});
	});

	test.describe("a library with no ratings at all", () => {
		test.use({ withoutFields: ["%rating%"] });

		test("can be given its first rating", async ({ page }) => {
			await openLibrary(page);
			await expect(star(page, 0, 4)).toBeVisible();
		});
	});
});

// `#/all` is the media library itself rather than a playlist of it, so these are
// the rows the component's own snapshot answers for.
test.describe("rating from All music", () => {
	test.use({ ...RATED, fooJean: {} });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	// Rows come back in library-path order, so row 2 is the third track of a
	// seven-track album. Deliberately not the first: a cover has been addressed by
	// its album's own first track since 013, and a write that read the same table
	// would rate `01. Rotten Apple` here and pass every test that never opens two
	// tracks of one album.
	test("writes to the row under the cursor, not to the first track of its album", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		await expect(trackRow(page, 2)).toContainText("I Stay Away");

		await nothingWrittenYet(player);

		const before = player.requests.length;
		await star(page, 2, 4).click();

		// One request, and it is the write: nothing is sent first to find out what
		// to write to, here or to beefweb.
		await expectSettlesAt(player, () => asksSince(player, before), [
			"POST /api/tags",
		]);
		const [write] = tagWrites(player);
		expect(addressOf(write)).toEqual({ track: I_STAY_AWAY });
		expect(write.body).toMatchObject({ fields: { rating: "4" } });

		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
	});

	// A cue sheet or a disc image: several tracks in one file, sharing a path and
	// told apart by nothing else. Row 1 is the second of them.
	test.describe("a library of files holding two tracks each", () => {
		test.use({ libraryShape: { tracks: 4, subsongsPerFile: 2 } });

		test("writes to the track under the cursor, not to the first in its file", async ({
			page,
			player,
		}) => {
			await openAllMusic(page);
			await expect(trackRow(page, 1)).toContainText("Track 2");

			await nothingWrittenYet(player);

			const before = player.requests.length;
			await star(page, 1, 4).click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
			]);
			const [write] = tagWrites(player);
			expect(addressOf(write)).toEqual({ track: "1.mp3" });
			expect(subsongOf(write)).toBe(2);

			await expect(ratingOf(page, 1)).toHaveAccessibleName("4 of 5 stars");
			await expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated");
		});
	});
});

// `foo_jean` carries an empty relative path for a library track foobar2000
// answers no relative path for, and a row read out of the library has no second
// address to fall back on. So there is nothing to name this track to the player
// by, and a rating control over it can only take a rating and drop it.
test.describe("a library row the component has no address for", () => {
	test.use({
		// `retagged` in place of the seed the rest of the file uses: the library
		// root is where this track's own path ends, which leaves it nothing under
		// the root to be addressed by, and every other track keeps the unrated,
		// writable scale it was captured with.
		settings: RATED.settings,
		retagged: { Fizz: { "%path%": "C:\\Music\\" } },
		fooJean: {},
	});

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("shows the rating it holds and offers no way to change it, saying nothing", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		// An empty path sorts before every other, so the row with no address is the
		// first one.
		await expect(trackRow(page, 0)).toContainText("Fizz");
		// The rest of the column is writable, so read-only stars on row 0 are about
		// the address and not about the scale, the switch or the component.
		await expect(star(page, 1, 4)).toBeVisible();

		const said = await watchWhatIsSaid(page);

		await expect(readOnlyStars(page, 0)).toHaveAccessibleName("Unrated");
		await expect(
			trackRow(page, 0).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);

		await pressAndHold(page, trackRow(page, 0));
		await expect(
			page.getByRole("menuitem", { name: "Add to queue" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);
		await page.keyboard.press("Escape");

		await trackRow(page, 0).click();
		await page.keyboard.press("4");

		await expectSettlesAt(player, () => tagWrites(player), []);
		await expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated");
		// Rare enough not to earn a phrase, so there is nothing to say and nothing
		// is said.
		expect(await said()).toEqual([]);
	});
});

// A file dragged into foobar2000 from a folder the media library does not scan,
// dropped into the middle of the playlist rather than onto the end so the row is
// on screen without scrolling. It is the only kind of row the library form
// cannot address, and so the only one the playlist form is for.
const OFF_LIBRARY: Track = {
	"%path%": "D:\\Incoming\\Night Sessions\\01 Fourth Wall.flac",
	"%title%": "Fourth Wall",
	"%artist%": "The Dry Season",
	"%album%": "Night Sessions",
	"%album artist%": "The Dry Season",
	"%tracknumber%": "01",
	"%length_seconds%": "212",
	"%length%": "3:32",
};

// The same file on a NAS, reached over a UNC share. It carries no scheme, so it
// is as local as any other file, and nothing decides a refusal from the shape of
// a path any more.
const ON_A_SHARE: Track = {
	...OFF_LIBRARY,
	"%path%": "\\\\nas\\share\\Night Sessions\\01 Fourth Wall.flac",
};

const OFF_LIBRARY_ROW = 2;

// Read off the player's own copy of the file rather than out of Jean's optimism:
// a star painted before the write went out stays painted through a write that
// named a track the player never found.
const ratingHeldAt = (player: FakePlayer, row: number) =>
	player.playlistById("p7")?.items[row]?.["%rating%"];

const dropItIntoTheLibraryPlaylist = async (
	page: Page,
	player: FakePlayer,
	track: Track = OFF_LIBRARY,
) => {
	const playlist = player.playlistById("p7");
	if (!playlist) throw new Error("no Library playlist to drop into");
	// A copy, because a tag written at the fake is written into the track object
	// itself. One worker runs many of these tests in turn, so a fixture spliced in
	// by reference carries the rating the last one gave it into the next.
	playlist.items.splice(OFF_LIBRARY_ROW, 0, { ...track });

	await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
	await expect(trackRow(page, OFF_LIBRARY_ROW)).toContainText("Fourth Wall");
};

test.describe("rating a row the media library does not hold", () => {
	test.use({ ...RATED, fooJean: {} });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("names the playlist, the position and the generation the rows were read at", async ({
		page,
		player,
	}) => {
		await dropItIntoTheLibraryPlaylist(page, player);

		await nothingWrittenYet(player);

		const before = player.requests.length;
		await star(page, OFF_LIBRARY_ROW, 4).click();

		await expectSettlesAt(player, () => asksSince(player, before), [
			"POST /api/tags",
		]);
		expect(addressOf(tagWrites(player)[0])).toEqual({
			playlist: guidOfPlaylist(player, "p7"),
			index: OFF_LIBRARY_ROW,
			// Sent as it arrived. A generation is far past what a double holds, so a
			// client that read it as a number would send a neighbour of it back.
			structure: String(player.playlistById("p7")?.structure),
		});

		await expect(ratingOf(page, OFF_LIBRARY_ROW)).toHaveAccessibleName(
			"4 of 5 stars",
		);
	});
});

// A player that has just started holds no media library snapshot until a client
// asks it for an export, and until it does, every library address it is handed is
// a track it cannot find. The library view has no rows at all in that window, so
// what has to survive it is a playlist row, whose library path the component
// works out from the handle rather than from the snapshot, and the playing track,
// whose address `GET /api/state` carries the same way.
test.describe("before the player has built its library snapshot", () => {
	test.use({
		...RATED,
		fooJean: { libraryReady: false },
	});

	test.describe("a row in a playlist", () => {
		test.skip(
			({ isMobile }) => Boolean(isMobile),
			"the row's stars are a pointer control; touch uses the track menu",
		);

		test("still rates, by the position it is at", async ({ page, player }) => {
			await openLibrary(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			await star(page, 2, 4).click();

			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			expect(addressOf(tagWrites(player)[0])).toEqual({
				playlist: guidOfPlaylist(player, "p7"),
				index: 2,
				structure: String(player.playlistById("p7")?.structure),
			});

			// Off the player's own copy of the file: a star painted before the write
			// went out stays painted through a write the player refused.
			await expect.poll(() => ratingHeldAt(player, 2)).toBe("4");
			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
			expect(await said()).toEqual([]);
		});
	});

	test("the now-playing stars rate the row the track is playing from", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);
		await nothingWrittenYet(player);
		const said = await watchWhatIsSaid(page);

		const stars = starsOnScreen(page);
		await stars.getByRole("button", { name: "Rate 4 of 5" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(addressOf(tagWrites(player)[0])).toEqual({
			playlist: guidOfPlaylist(player, "p7"),
			index: 2,
			structure: String(player.playlistById("p7")?.structure),
		});

		await expect.poll(() => ratingHeldAt(player, 2)).toBe("4");
		await expect(stars).toHaveAccessibleName("4 of 5 stars");
		expect(await said()).toEqual([]);
	});

	// The other edge of the same gate: the state document names a library path for
	// this track too, and with no snapshot behind it and no playlist row to fall
	// back on there is nothing to name the track to the player by.
	test.describe("a playing track the player cannot place in a playlist", () => {
		test.use({
			// Follow-playback off, so the row behind the layer is a track the write
			// path could reach and a digit falling through to it would land.
			// `settings` replaces rather than merges, so the column set has to be
			// restated, and so does the readiness this describe is about.
			settings: { ...RATED.settings, "jean.followPlayback": false },
			fooJean: { libraryReady: false, knowsPlayingLocation: false },
		});

		test("draws stars that take no rating, and says nothing", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			// A click moves the cursor and leaves playback alone, so the marked row
			// and the playing track are now two different tracks.
			await trackRow(page, 0).click();

			await openNowPlaying(page);
			await expect(
				nowPlayingScreen(page).getByRole("img", { name: /stars|Unrated/ }),
			).toHaveAccessibleName("3 of 5 stars");
			await expect(
				nowPlayingScreen(page).getByRole("button", { name: /^Rate / }),
			).toHaveCount(0);

			const said = await watchWhatIsSaid(page);
			await page.keyboard.press("4");

			await expectSettlesAt(player, () => tagWrites(player), []);

			// Los Calientes, under the cursor behind the layer, keeps the five it
			// had: a digit the screen refuses is refused rather than passed on.
			await nowPlayingScreen(page)
				.getByRole("button", { name: "Close now playing" })
				.click();
			await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");
			expect(await said()).toEqual([]);
		});
	});
});

// Somebody edited the playlist between the rows being read and the star being
// clicked, so the position the write named is no longer that track's. The player
// writes nothing, and Jean must not leave a star standing for a rating that is
// not there.
test.describe("when the playlist moved under a rating", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 409 },
	});

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("takes the star back and says the playlist changed", async ({
		page,
		player,
	}) => {
		await dropItIntoTheLibraryPlaylist(page, player);
		await expect(ratingOf(page, OFF_LIBRARY_ROW)).toHaveAccessibleName(
			"Unrated",
		);

		await star(page, OFF_LIBRARY_ROW, 4).click();

		await expect(page.getByRole("status")).toContainText(en["rate.moved"]);
		await expect(ratingOf(page, OFF_LIBRARY_ROW)).toHaveAccessibleName(
			"Unrated",
		);
		// Refused rather than failed, so nothing is sent again: a second attempt at
		// the same position could land on whatever moved into it.
		await expectSettlesAt(player, () => tagWrites(player).length, 1);
	});
});

// Two media library roots holding one relative path, so `track` plus `subsong`
// names a track under each and the component refuses rather than write to
// whichever sorts first. It is decided before anything is written, which is what
// makes it the one refusal in the rating path a client may answer by trying
// again: every surface holds a second address that names one track, and the
// retry carries the one that surface read the row at.
test.describe("when a library address names more than one track", () => {
	test.use({ ...RATED });

	const ROWS_ARE_A_POINTER_CONTROL =
		"the row's stars are a pointer control; touch uses the track menu";

	const playDelectrico = async (page: Page) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);
	};

	test.describe("a row read from the media library", () => {
		test.use({ fooJean: { twoRootsHold: I_STAY_AWAY } });
		test.skip(({ isMobile }) => Boolean(isMobile), ROWS_ARE_A_POINTER_CONTROL);

		test("is rated again by its ordinal, and the star the user set lands", async ({
			page,
			player,
		}) => {
			await openAllMusic(page);
			await expect(trackRow(page, 2)).toContainText("I Stay Away");
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await star(page, 2, 4).click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"POST /api/tags",
			]);
			const [first, second] = tagWrites(player);
			expect(addressOf(first)).toEqual({ track: I_STAY_AWAY });
			expect(addressOf(second)).toEqual({
				ordinal: ordinalOf(player, I_STAY_AWAY),
				structure: player.libraryFeed.structure,
			});

			await expect.poll(() => libraryRatingOf(player, I_STAY_AWAY)).toBe("4");
			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
			// Refused once and sent again, and none of that reaches the person.
			expect(await said()).toEqual([]);
		});
	});

	// After the path form was refused, the ordinal is the only address that
	// names the track the write went to, so it is the only one the read after a
	// timeout can go back with. Without it the rating is unreadable for the rest
	// of the session and a write that never landed goes unmentioned.
	test.describe("a row whose retry by ordinal then times out", () => {
		test.use({ fooJean: { twoRootsHold: I_STAY_AWAY, failWrites: 504 } });
		test.skip(({ isMobile }) => Boolean(isMobile), ROWS_ARE_A_POINTER_CONTROL);

		test("is read back by the same ordinal, and the track the rating did not reach is named", async ({
			page,
			player,
		}) => {
			await openAllMusic(page);
			await expect(trackRow(page, 2)).toContainText("I Stay Away");
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await star(page, 2, 4).click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"POST /api/tags",
				"GET /api/track/library",
			]);
			const read = player.requests
				.slice(before)
				.find((entry) => routeOf(entry.path) === "/api/track/library");
			const asked = new URLSearchParams(read?.path.split("?")[1] ?? "");
			expect({
				track: asked.get("track"),
				ordinal: asked.get("ordinal"),
				structure: asked.get("structure"),
			}).toEqual({
				track: null,
				ordinal: String(ordinalOf(player, I_STAY_AWAY)),
				structure: String(player.libraryFeed.structure),
			});

			await expect.poll(said).toEqual([didNotLand("I Stay Away", 4)]);
		});
	});

	test.describe("a row read from a playlist", () => {
		test.use({ fooJean: { twoRootsHold: DELECTRICO } });
		test.skip(({ isMobile }) => Boolean(isMobile), ROWS_ARE_A_POINTER_CONTROL);

		test("is rated again by its position, and not by an ordinal it never read", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await expect(trackRow(page, 2)).toContainText("Deléctrico");
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await star(page, 2, 4).click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"POST /api/tags",
			]);
			const [first, second] = tagWrites(player);
			expect(addressOf(first)).toEqual({ track: DELECTRICO });
			expect(addressOf(second)).toEqual({
				playlist: guidOfPlaylist(player, "p7"),
				index: 2,
				structure: String(player.playlistById("p7")?.structure),
			});

			await expect.poll(() => ratingHeldAt(player, 2)).toBe("4");
			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
			expect(await said()).toEqual([]);
		});
	});

	test.describe("the track the now-playing screen is showing", () => {
		test.use({ fooJean: { twoRootsHold: DELECTRICO } });

		test("is rated again by the row it is playing from", async ({
			page,
			player,
		}) => {
			await playDelectrico(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await starsOnScreen(page)
				.getByRole("button", { name: "Rate 4 of 5" })
				.click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"POST /api/tags",
			]);
			expect(addressOf(tagWrites(player)[1])).toEqual({
				playlist: guidOfPlaylist(player, "p7"),
				index: 2,
				structure: String(player.playlistById("p7")?.structure),
			});

			await expect.poll(() => ratingHeldAt(player, 2)).toBe("4");
			await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");
			expect(await said()).toEqual([]);
		});
	});

	// Somebody reordered the playlist as well, so the position the retry names is
	// refused in its turn. One retry is the whole allowance: a client that answered
	// every refusal with another address would go round until it ran out of them.
	test.describe("and the address the retry names is refused too", () => {
		test.use({ fooJean: { twoRootsHold: DELECTRICO, failWrites: 409 } });
		test.skip(({ isMobile }) => Boolean(isMobile), ROWS_ARE_A_POINTER_CONTROL);

		test("the rating is not sent a third time, and the star goes back", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await expect(ratingOf(page, 2)).toHaveAccessibleName("3 of 5 stars");
			await nothingWrittenYet(player);

			const before = player.requests.length;
			await star(page, 2, 4).click();

			await expect(page.getByRole("status")).toContainText(en["rate.moved"]);
			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"POST /api/tags",
			]);
			expect(addressOf(tagWrites(player)[1])).toMatchObject({
				playlist: guidOfPlaylist(player, "p7"),
			});
			await expect(ratingOf(page, 2)).toHaveAccessibleName("3 of 5 stars");
		});
	});

	// `playingLocation` is null, so the screen holds the ambiguous address and
	// nothing else. There is nowhere to try again, and a star that quietly goes
	// back is a person believing they rated a track they did not.
	test.describe("a screen holding no second address", () => {
		test.use({
			fooJean: { twoRootsHold: DELECTRICO, knowsPlayingLocation: false },
		});

		test("says the rating did not land rather than going quiet", async ({
			page,
			player,
		}) => {
			await playDelectrico(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await starsOnScreen(page)
				.getByRole("button", { name: "Rate 4 of 5" })
				.click();

			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
			]);
			await expect.poll(said).toEqual([didNotLand("Deléctrico", 4)]);
			expect(ratingHeldAt(player, 2)).toBe("3");
		});
	});
});

// The other refusals, on a row that does hold a second address: the playlist row
// above is the evidence that Jean would reach for one, so a rating that goes out
// once here went out once by choice. An ambiguity refusal is answered before
// anything is written and none of these is, so a second write could land on top
// of a rating somebody made in between.
test.describe("a refusal that is not about the address", () => {
	test.use({ ...RATED });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	for (const { status, costs } of [
		{ status: 403, costs: ["POST /api/tags"] },
		{ status: 404, costs: ["POST /api/tags"] },
		{ status: 500, costs: ["POST /api/tags"] },
		// A `504` says nothing about whether the tag was written, so the one read
		// back rides with it. The write itself still goes out once.
		{ status: 504, costs: ["POST /api/tags", "GET /api/track/library"] },
	])
		test.describe(`a ${status}`, () => {
			test.use({ fooJean: { failWrites: status } });

			test("sends the rating once and never to the row's other address", async ({
				page,
				player,
			}) => {
				await openLibrary(page);
				await expect(trackRow(page, 2)).toContainText("Deléctrico");
				await nothingWrittenYet(player);

				const before = player.requests.length;
				await star(page, 2, 4).click();

				await expectSettlesAt(player, () => asksSince(player, before), costs);
				expect(addressOf(tagWrites(player)[0])).toEqual({ track: DELECTRICO });
			});
		});
});

// A `504` is the component saying it did not answer in time, which says nothing
// about whether the tag was written: the player may have taken the rating and
// lost the answer, or taken nothing at all. Jean cannot write again to find out,
// because a second write would overwrite a rating made in between, so it reads
// the value back once and lets the answer decide whether anybody is told.
test.describe("when a rating write times out", () => {
	test.use({ ...RATED });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	// The whole cost of a timed-out rating: the write that timed out, then one
	// read. A second of either is the defect these tests exist to rule out.
	const WROTE_THEN_READ_THE_LIBRARY = [
		"POST /api/tags",
		"GET /api/track/library",
	];

	const rateDelectrico = async (page: Page, player: FakePlayer) => {
		await openLibrary(page);
		await nothingWrittenYet(player);
		const said = await watchWhatIsSaid(page);

		const before = player.requests.length;
		await star(page, 2, 4).click();
		return { before, said };
	};

	// What a request asked for, by name rather than by position in the URL.
	const askedBy = (player: FakePlayer, from: number, route: string) => {
		const found = player.requests
			.slice(from)
			.find((entry) => routeOf(entry.path) === route);
		if (!found) throw new Error(`nothing asked ${route}`);
		return new URLSearchParams(found.path.split("?")[1] ?? "");
	};

	test.describe("and the rating reached the player anyway", () => {
		test.use({ fooJean: { failWrites: 504, writesLandAnyway: true } });

		test("reads it back once, keeps the star and says nothing", async ({
			page,
			player,
		}) => {
			const { before, said } = await rateDelectrico(page, player);

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);
			// The row's own address, not its album's: a read of the neighbour that
			// happens to hold four stars would go quiet for the wrong reason.
			expect(askedBy(player, before, "/api/track/library").get("track")).toBe(
				DELECTRICO,
			);

			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
			expect(await said()).toEqual([]);
		});
	});

	test.describe("and the player kept the rating it already had", () => {
		test.use({ fooJean: { failWrites: 504 } });

		// The star stays on four while the player holds three. Nothing else can be
		// done about it without risking a write over somebody else's, so the person
		// who pressed it is told which track and which rating did not land, by name:
		// by the time this fires the screen has usually moved on.
		test("keeps the star and names the track the rating did not reach", async ({
			page,
			player,
		}) => {
			const { before, said } = await rateDelectrico(page, player);

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);
			expect(askedBy(player, before, "/api/track/library").get("track")).toBe(
				DELECTRICO,
			);

			await expect.poll(said).toEqual([didNotLand("Deléctrico", 4)]);
			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
		});
	});

	// Most tracks in most libraries carry no rating tag, and `%rating%` resolves
	// to `?` for every one of them. That is the player answering, not the player
	// failing to: it says the rating is not on the track.
	test.describe("and the track had carried no rating at all", () => {
		test.use({ fooJean: { failWrites: 504 } });

		test("names the track the player still holds no rating for", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await star(page, 1, 4).click();

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);
			expect(askedBy(player, before, "/api/track/library").get("track")).toBe(
				FIZZ,
			);

			await expect.poll(said).toEqual([didNotLand("Fizz", 4)]);
			await expect(ratingOf(page, 1)).toHaveAccessibleName("4 of 5 stars");
		});
	});

	// The same `?` from the other side. Removing a rating asks the player to hold
	// none, so a player holding none is the write having landed, and a person who
	// cleared a rating successfully has nothing to be told.
	test.describe("and the rating it cleared did reach the player", () => {
		test.use({ fooJean: { failWrites: 504, writesLandAnyway: true } });

		test("says nothing about a rating that is gone because it was removed", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await trackRow(page, 2)
				.getByRole("button", { name: "Clear rating (3 of 5 stars)" })
				.click();

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);

			await expect(ratingOf(page, 2)).toHaveAccessibleName("Unrated");
			expect(await said()).toEqual([]);
		});
	});

	// A removal asks the player to hold no rating at all, so the number in a
	// message about it is zero, and "we couldn't rate this with 0 stars" is nobody
	// asking for anything. What a person did here was take a rating off.
	test.describe("and the rating it cleared did not reach the player", () => {
		test.use({ fooJean: { failWrites: 504 } });

		test("names the track without offering it a rating of none", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await trackRow(page, 2)
				.getByRole("button", { name: "Clear rating (3 of 5 stars)" })
				.click();

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);

			await expect.poll(said).toEqual([notRemoved("Deléctrico")]);
			await expect(ratingOf(page, 2)).toHaveAccessibleName("Unrated");
		});
	});

	// Refused or gone: either way Jean knows no more than it did before it asked,
	// and a rating the user can see is better than one taken away on a guess.
	for (const status of [404, 500]) {
		test.describe(`and the read back is refused with a ${status}`, () => {
			test.use({ fooJean: { failWrites: 504, failLibraryTrack: status } });

			test("keeps the star and says nothing", async ({ page, player }) => {
				const { before, said } = await rateDelectrico(page, player);

				await expectSettlesAt(
					player,
					() => asksSince(player, before),
					WROTE_THEN_READ_THE_LIBRARY,
				);

				await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
				expect(await said()).toEqual([]);
			});
		});
	}

	test.describe("and the read back never answers either", () => {
		test.use({ fooJean: { failWrites: 504, hangLibraryTrack: true } });

		test("keeps the star, asks nothing further and says nothing", async ({
			page,
			player,
		}) => {
			const { before, said } = await rateDelectrico(page, player);

			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);

			// The read is open with nothing coming back down it, and the page is
			// free to change its mind for as long as it is waiting. Read a moment
			// after the request goes out, every assertion below holds just as well
			// on a page that takes the star back a second later, so what they are
			// read at is the point past which nothing from that read can arrive.
			await page.waitForTimeout(STALLED_READ_MS * 2);

			await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
			expect(await said()).toEqual([]);
			await expectSettlesAt(
				player,
				() => asksSince(player, before),
				WROTE_THEN_READ_THE_LIBRARY,
			);
		});
	});

	// A row the media library does not hold is addressed by its position, so its
	// value comes back from the playlist rather than from the library, and the two
	// routes answer differently enough that reading one is no evidence about the
	// other.
	test.describe("on a row the media library does not hold", () => {
		test.use({ fooJean: { failWrites: 504 } });

		test("reads the row back and names the track the rating did not reach", async ({
			page,
			player,
		}) => {
			await dropItIntoTheLibraryPlaylist(page, player, {
				...OFF_LIBRARY,
				"%rating%": "2",
			});
			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);

			const before = player.requests.length;
			await star(page, OFF_LIBRARY_ROW, 4).click();

			const rows = `/api/playlists/${guidOfPlaylist(player, "p7")}/items`;
			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				`GET ${rows}`,
			]);

			// The one row that was written to, not the page around it.
			const asked = askedBy(player, before, rows);
			expect([asked.get("offset"), asked.get("count")]).toEqual([
				String(OFF_LIBRARY_ROW),
				"1",
			]);

			await expect.poll(said).toEqual([didNotLand("Fourth Wall", 4)]);
			await expect(ratingOf(page, OFF_LIBRARY_ROW)).toHaveAccessibleName(
				"4 of 5 stars",
			);
		});
	});
});

test.describe("rating with the number keys", () => {
	test.use({ ...RATED, fooJean: {} });

	test("rates the row under the cursor", async ({ page, player }) => {
		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("4");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(addressOf(tagWrites(player)[0])).toEqual({ track: DELECTRICO });
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "4" },
		});
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
	});

	test("zero removes the rating", async ({ page, player }) => {
		await openLibrary(page);
		await page.keyboard.press("0");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "" } });
	});

	test("does nothing on a track Jean may not write", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await inSequence([0, 1, 2, 3], () => page.keyboard.press("ArrowDown"));
		await page.keyboard.press("2");

		await expect(readOnlyStars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expectSettlesAt(player, () => tagWrites(player), []);
	});

	test.describe("with the now-playing screen up", () => {
		// Off, so the cursor stays on a different track from the one playing --
		// which is the arrangement the screen has to answer for. `settings` replaces
		// rather than merges, so the column set has to be restated.
		test.use({
			settings: { ...RATED.settings, "jean.followPlayback": false },
		});

		test("they rate the track the screen is showing, not the row behind it", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			// A click moves the cursor and leaves playback alone, so the marked row
			// and the playing track are now two different tracks.
			await trackRow(page, 0).click();

			await openNowPlaying(page);
			await page.keyboard.press("4");

			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			// The media library holds the playing track, so the screen names it the
			// way a row does: by the path under the library root that `GET /api/state`
			// carries, never by the position it happens to be playing from.
			expect(addressOf(tagWrites(player)[0])).toEqual({ track: DELECTRICO });
			expect(tagWrites(player)[0].body).toMatchObject({
				fields: { rating: "4" },
			});

			// The stars on the screen move; Los Calientes, under the cursor behind
			// the layer, keeps the five it had.
			await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");
			await nowPlayingScreen(page)
				.getByRole("button", { name: "Close now playing" })
				.click();
			await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");
		});
	});

	// Away from any list there is no cursor, so the keys fall through to what is
	// playing. Success is silent everywhere; only a failure speaks.
	test("falls back to the playing track, silently", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");

		// A dialog owns the keyboard while it is open and the rating keys do not
		// fire there, so Home is the remaining place with a player and no cursor.
		await page.goto("/#/home");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		const said = await watchWhatIsSaid(page);
		await page.keyboard.press("3");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(addressOf(tagWrites(player)[0])).toEqual({ track: DELECTRICO });
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "3" },
		});
		expect(await said()).toEqual([]);
	});

	// A read-only scale is read-only however the rating is reached, and the
	// playing track is the one path with no row on screen to say so.
	test("refuses a playing track on a scale Jean does not write", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 4).dblclick();
		await expect(page.locator("footer")).toContainText("Pendejo");

		// The screen draws the `100` as five read-only stars, which is also how
		// this test knows the player has answered with the rating.
		await openNowPlaying(page);
		await expect(
			nowPlayingScreen(page).getByRole("img", { name: /stars|Unrated/ }),
		).toHaveAccessibleName("5 of 5 stars");
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		// The screen publishes what it would do with a digit for as long as it is
		// on screen, exit animation included, so the fallback is only reachable
		// once it has gone.
		await expect(nowPlayingScreen(page)).toBeHidden();

		await page.goto("/#/home");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await page.keyboard.press("2");

		await expectSettlesAt(player, () => tagWrites(player), []);
	});
});

// The now-playing screen is the one rating surface with no row under it, so its
// address comes from `GET /api/state`: the library-relative path the state
// document carries, and the playlist row playback is at where it carries none.
test.describe("rating the track the now-playing screen is showing", () => {
	test.use({ ...RATED, fooJean: {} });

	const playTheDroppedFile = async (
		page: Page,
		player: FakePlayer,
		track: Track = OFF_LIBRARY,
	) => {
		await dropItIntoTheLibraryPlaylist(page, player, track);
		await trackRow(page, OFF_LIBRARY_ROW).dblclick();
		await expect(page.locator("footer")).toContainText("Fourth Wall");
		await openNowPlaying(page);
	};

	test("names the playlist row where the media library does not hold the track", async ({
		page,
		player,
	}) => {
		await playTheDroppedFile(page, player);
		await nothingWrittenYet(player);

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(addressOf(tagWrites(player)[0])).toEqual({
			playlist: guidOfPlaylist(player, "p7"),
			index: OFF_LIBRARY_ROW,
			structure: String(player.playlistById("p7")?.structure),
		});

		await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");
		expect(ratingHeldAt(player, OFF_LIBRARY_ROW)).toBe("4");
	});

	// The component answers with the tag as it now stands, and a player keeping
	// ratings on a scale of its own does not store the digit it was handed. A row
	// takes the value back off that answer, and this screen is the other surface
	// the same write comes back to.
	test.describe("a player that keeps a rating its own way", () => {
		test.use({ fooJean: { storesRatingAs: "2" } });

		test("the stars take the rating the component stored, not the one clicked", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			await openNowPlaying(page);
			await nothingWrittenYet(player);

			const before = player.requests.length;
			await starsOnScreen(page)
				.getByRole("button", { name: "Rate 4 of 5" })
				.click();

			await expectSettlesAt(player, () => ratingsWritten(player), [
				[DELECTRICO, "4"],
			]);
			await expect(starsOnScreen(page)).toHaveAccessibleName("2 of 5 stars");
			// Off the write's own answer: reading the track again would land on the
			// same two stars and cost a request to hear what the write already said.
			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
			]);
		});
	});

	// A row keeps one pending rating and one write in flight. This screen paints
	// its optimistic star somewhere else entirely, and somebody pressing five
	// stars in a second is doing the same thing at both.
	test("five stars pressed one after another send the first, then one write for the fifth", async ({
		page,
		player,
	}) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);
		await expect(
			starsOnScreen(page).getByRole("button", { name: "Rate 1 of 5" }),
		).toBeVisible();

		// Each star is one above the last, so every one is still labelled "Rate",
		// and none of the five is the one that clears.
		for (const value of [1, 2, 3, 4, 5])
			await starsOnScreen(page)
				.getByRole("button", { name: `Rate ${value} of 5` })
				.click();
		// All five arrived. A screen that dropped four of them would send one write
		// and read as coalescing without ever coalescing anything.
		await expect(starsOnScreen(page)).toHaveAccessibleName("5 of 5 stars");

		// The first goes at once, with nothing to wait behind. The other four are
		// pressed while it is open, and it stays the only write in flight.
		await expectSettlesAt(player, () => writes.sent.length, 1);
		expect(writes.sent[0]).toMatchObject({ fields: { rating: "1" } });

		writes.letOneThrough();

		// One write for the four behind it, carrying the last of them. Nothing is
		// ever sent for 2, 3 or 4.
		await expect.poll(() => writes.sent.length).toBe(2);
		expect(writes.sent[1]).toMatchObject({ fields: { rating: "5" } });
		await expectSettlesAt(player, () => writes.sent.length, 2);

		writes.openTheDoor();
		await expectSettlesAt(player, () => ratingsWritten(player), [
			[DELECTRICO, "1"],
			[DELECTRICO, "5"],
		]);
		await expect(starsOnScreen(page)).toHaveAccessibleName("5 of 5 stars");
	});

	test("rates a track on a network share like any other", async ({
		page,
		player,
	}) => {
		await playTheDroppedFile(page, player, ON_A_SHARE);

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");
		expect(ratingHeldAt(player, OFF_LIBRARY_ROW)).toBe("4");
	});
});

// A local file the media library does not hold, playing from no playlist the
// component can name: the one track there is no address of either form for. The
// screen showing it has to refuse the digits itself, because the list under the
// layer is still mounted and would take them otherwise.
test.describe("a playing track the component has no address for", () => {
	test.use({
		...RATED,
		// Off, so the row behind the layer is a track the media library does hold,
		// and a digit that fell through to it would write. `settings` replaces
		// rather than merges, so the column set has to be restated.
		settings: { ...RATED.settings, "jean.followPlayback": false },
		fooJean: { knowsPlayingLocation: false },
	});

	test("shows the rating it holds and takes no new one, saying nothing", async ({
		page,
		player,
	}) => {
		await dropItIntoTheLibraryPlaylist(page, player);
		await trackRow(page, OFF_LIBRARY_ROW).dblclick();
		await expect(page.locator("footer")).toContainText("Fourth Wall");
		// A click moves the cursor and leaves playback alone, so the marked row and
		// the playing track are now two different tracks.
		await trackRow(page, 0).click();

		await openNowPlaying(page);
		await expect(
			nowPlayingScreen(page).getByRole("img", { name: /stars|Unrated/ }),
		).toHaveAccessibleName("Unrated");
		await expect(
			nowPlayingScreen(page).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);

		const said = await watchWhatIsSaid(page);
		await page.keyboard.press("4");

		await expectSettlesAt(player, () => tagWrites(player), []);

		// Los Calientes, under the cursor behind the layer, keeps the five it had:
		// a digit the screen refuses is refused rather than passed on.
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");

		// Rare enough not to earn a phrase, so there is nothing to say and nothing
		// is said.
		expect(await said()).toEqual([]);
	});
});

test.describe("when foo_jean refuses the field", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 403 },
	});

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("stops offering the control instead of retrying", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await star(page, 2, 4).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(
			trackRow(page, 2).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
		await expect(readOnlyStars(page, 2)).toHaveAccessibleName("3 of 5 stars");
	});
});

// The playing track has no row to overlay, so its optimistic value lives in the
// now-playing query and a refusal has to put that back.
test.describe("when a rating from the now-playing screen is refused", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 500 },
	});

	test("the stars go back to the rating the player holds", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);

		const stars = starsOnScreen(page);
		await expect(stars).toHaveAccessibleName("3 of 5 stars");
		await stars.getByRole("button", { name: "Rate 5 of 5" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(page.getByRole("status")).toContainText("was not rated");
		await expect(stars).toHaveAccessibleName("3 of 5 stars");
	});

	// Two stars pressed while nothing has come back are two writes rather than
	// one: the first is already in flight, so the second has nothing to coalesce
	// into. What each of them puts back is the rating the player agreed to, and
	// the player agreed to the same one throughout, so the star a press replaced
	// is not it.
	test("a second star pressed before the first write answers goes back to the same rating", async ({
		page,
		player,
	}) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);
		await expect(starsOnScreen(page)).toHaveAccessibleName("3 of 5 stars");

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();
		await expectSettlesAt(player, () => writes.sent.length, 1);

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 5 of 5" })
			.click();
		await expect(starsOnScreen(page)).toHaveAccessibleName("5 of 5 stars");

		writes.openTheDoor();

		// A refusal puts the star back and says so in the same turn, so a message
		// per write is both writes having been answered. Read any earlier, the
		// stars are between the two refusals and hold the right rating for a
		// moment on the way to the wrong one.
		await expect(
			page.getByRole("status").getByText(wasNotRated("Deléctrico")),
		).toHaveCount(2);

		await expect(starsOnScreen(page)).toHaveAccessibleName("3 of 5 stars");
		expect(libraryRatingOf(player, DELECTRICO)).toBe("3");
	});

	// A write that timed out and landed is agreed to by the read after it rather
	// than by an answer to itself: the player reports holding what was sent, which
	// says as much as a 200 does. So a press refused later has a newer rating to
	// put back than the one the screen fetched on its way in.
	test.describe("after a write that timed out and reached the player", () => {
		test.use({ fooJean: { failWrites: 504, writesLandAnyway: true } });

		test("the stars go back to the rating the player turned out to hold", async ({
			page,
			player,
		}) => {
			const refusal = "the player could not write the tags";
			let sent = 0;
			await page.route(
				(url) => url.pathname === "/api/tags",
				async (route) => {
					sent += 1;
					if (sent === 1) return route.continue();

					// Refused before the component writes anything, so the player keeps
					// what the first press put there.
					return route.fulfill({
						status: 500,
						contentType: "application/json",
						body: JSON.stringify({ written: false, error: refusal }),
					});
				},
			);

			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			await openNowPlaying(page);
			await expect(starsOnScreen(page)).toHaveAccessibleName("3 of 5 stars");

			await nothingWrittenYet(player);
			const said = await watchWhatIsSaid(page);
			const before = player.requests.length;

			await starsOnScreen(page)
				.getByRole("button", { name: "Rate 4 of 5" })
				.click();

			// The write, then the one read that follows it. Pressing again before
			// that read has answered would make where the stars end a question about
			// ordering rather than about what the player agreed to.
			await expectSettlesAt(player, () => asksSince(player, before), [
				"POST /api/tags",
				"GET /api/track/library",
			]);
			expect(libraryRatingOf(player, DELECTRICO)).toBe("4");

			await starsOnScreen(page)
				.getByRole("button", { name: "Rate 5 of 5" })
				.click();

			// A refusal puts the star back and says so in the same turn, so the
			// message on screen is the star having been put back. Between the press
			// and it the stars hold five, which is neither rating this is about.
			await expect(
				page.getByRole("status").getByText(wasNotRated("Deléctrico")),
			).toHaveCount(1);

			await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");
			// One message, and it is the refusal. A read that had found something
			// else would have said so, and this would be a press putting back a
			// rating nobody ever agreed to.
			expect(await said()).toEqual([
				saying(en["rate.failed"], { label: "Deléctrico", message: refusal }),
			]);
		});
	});
});

test.describe("a lyric that lands while a rating is still being written", () => {
	test.use({ ...RATED, fooJean: {} });

	test("leaves the star where it was put", async ({
		page,
		player,
		isMobile,
	}) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await trackRow(page, 3).dblclick();
		await expect(page.locator("footer")).toContainText("Soy Rock");
		await openNowPlaying(page);
		await expect(starsOnScreen(page)).toHaveAccessibleName("Unrated");

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();
		await expectSettlesAt(player, () => writes.sent.length, 1);

		writeLyric(player, "Found while the rating was on its way");
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText("Found while the rating was on its way", {
			timeout: 15_000,
		});

		// Settled first, so a re-read the lyric set off has had its chance to land.
		await expectSettlesAt(player, () => libraryRatingOf(player, SOY_ROCK), "0");
		await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");

		writes.openTheDoor();
		await expect.poll(() => libraryRatingOf(player, SOY_ROCK)).toBe("4");
	});
});

test.describe("a song a station announces while a rating is still being written", () => {
	test.use({ ...RATED, fooJean: {} });

	test("leaves the star where it was put", async ({ page, player }) => {
		const writes = await holdTheWrites(page);
		await openLibrary(page);
		await trackRow(page, 3).dblclick();
		await expect(page.locator("footer")).toContainText("Soy Rock");
		await openNowPlaying(page);
		await expect(starsOnScreen(page)).toHaveAccessibleName("Unrated");

		await starsOnScreen(page)
			.getByRole("button", { name: "Rate 4 of 5" })
			.click();
		await expectSettlesAt(player, () => writes.sent.length, 1);

		// Counted by their columns: a lyric look at this bare track asks for one,
		// and the announcement's read of the song asks for the whole row.
		const songReads = () =>
			requestsTo(player, "/api/track/playing").filter(
				(entry) =>
					entry.method === "GET" &&
					new URLSearchParams(entry.path.split("?")[1]).getAll("columns")
						.length > 1,
			).length;
		const readsBefore = songReads();
		player.announceSong({ title: "Ocean Floor", artist: "Gravity Wave" });

		await expectSettlesAt(player, () => songReads() > readsBefore, true);
		await expect(starsOnScreen(page)).toHaveAccessibleName("4 of 5 stars");

		writes.openTheDoor();
		await expect.poll(() => libraryRatingOf(player, SOY_ROCK)).toBe("4");
	});
});

// A refusal is the component saying this install writes no ratings at all, which
// is as true of the screen as it is of a row. A row stops offering its stars
// after one; this is the other surface the same answer has to reach.
test.describe("when foo_jean refuses the field from the now-playing screen", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 403 },
	});

	test("stops offering the stars instead of leaving them live", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);

		const stars = starsOnScreen(page);
		await expect(stars).toHaveAccessibleName("3 of 5 stars");
		await stars.getByRole("button", { name: "Rate 5 of 5" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(
			nowPlayingScreen(page).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
		await expect(
			nowPlayingScreen(page).getByRole("img", { name: /stars|Unrated/ }),
		).toHaveAccessibleName("3 of 5 stars");
	});
});

test.describe("the track actions on the now-playing screen", () => {
	test.use({ ...RATED, fooJean: {} });

	test("offer no rating until the player has answered with one", async ({
		page,
	}) => {
		let answer = () => {};
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		await page.route(
			(url) => url.pathname === "/api/track/playing",
			async (route) => {
				if (route.request().method() === "GET") await answered;
				await route.continue();
			},
		);

		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await openNowPlaying(page);
		await page.getByRole("button", { name: "Track actions" }).click();

		await expect(
			page.getByRole("menuitem", { name: "Add to queue" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);

		answer();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toBeVisible();
	});
});

test.describe("rating from the track menu", () => {
	test.use({ ...RATED, fooJean: {} });

	test("a hold opens a rating page that writes", async ({ page, player }) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 2));

		await page.getByRole("menuitem", { name: "Rating" }).click();
		await page.getByRole("menuitem", { name: "4 stars" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "4" },
		});
	});

	test("the page offers a way to remove the rating", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 2));

		await page.getByRole("menuitem", { name: "Rating" }).click();
		await page.getByRole("menuitem", { name: "No rating" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "" } });
	});

	test("is absent for a track on a scale Jean does not write", async ({
		page,
	}) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 4));

		await expect(
			page.getByRole("menuitem", { name: "Add to queue" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);
	});
});

const settings = async (page: Page) => {
	await openSettings(page);
	await expect(
		page.getByRole("heading", { level: 2, name: "foo_jean" }),
	).toBeVisible();
};

test.describe("what the settings screen says", () => {
	test.describe("a component that is not answering", () => {
		test.use({ fooJean: { reachable: false } });

		test("names the fix rather than going quiet", async ({ page }) => {
			await settings(page);
			await expect(page.getByText("Not connected")).toBeVisible();
			await expect(
				page.getByText("foo_jean is not answering right now."),
			).toBeVisible();
			await expect(
				page.getByText(
					"Check that foobar2000 is still running, then try again.",
				),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Check again" }),
			).toBeVisible();
		});
	});

	// The component's allowlist is the ceiling; these choose from underneath it.
	test.describe("choosing what Jean may write", () => {
		test.use({ ...RATED, fooJean: {} });

		test("draws one switch per permitted field, on by default", async ({
			page,
		}) => {
			await settings(page);
			await expect(
				page.getByRole("switch", { name: "Ratings" }),
			).toHaveAttribute("aria-checked", "true");
		});

		// A phone never draws the stars, so their absence would pass either way;
		// the track menu is the one surface both projects share.
		test("switching a field off takes the control away everywhere", async ({
			page,
			player,
		}) => {
			await settings(page);
			await page.getByRole("switch", { name: "Ratings" }).click();

			await openLibrary(page);
			await expect(
				trackRow(page, 2).getByRole("button", { name: /^Rate / }),
			).toHaveCount(0);
			await expect(readOnlyStars(page, 2)).toHaveAccessibleName("3 of 5 stars");

			await pressAndHold(page, trackRow(page, 2));
			await expect(
				page.getByRole("menuitem", { name: "Add to queue" }),
			).toBeVisible();
			await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(
				0,
			);

			await expectSettlesAt(player, () => tagWrites(player), []);
		});

		test("switching it back on restores the control", async ({ page }) => {
			await settings(page);
			await page.getByRole("switch", { name: "Ratings" }).click();
			await page.getByRole("switch", { name: "Ratings" }).click();

			await openLibrary(page);
			await pressAndHold(page, trackRow(page, 2));
			await expect(
				page.getByRole("menuitem", { name: "Rating" }),
			).toBeVisible();
		});
	});

	test.describe("connected with writing switched off", () => {
		test.use({ fooJean: { allowedFields: [] } });

		test("says the allowlist is empty rather than claiming to be broken", async ({
			page,
		}) => {
			await settings(page);
			await expect(page.getByText("Connected", { exact: true })).toBeVisible();
			await expect(
				page.getByText(/permits no fields to be written/),
			).toBeVisible();
			await expect(page.getByText(/Fields this may write/)).toBeVisible();
			// Scoped to this panel: Settings has other switches.
			await expect(
				page
					.getByRole("region", { name: "foo_jean" })
					.or(
						page
							.locator("section")
							.filter({ has: page.getByRole("heading", { name: "foo_jean" }) }),
					)
					.getByRole("switch"),
			).toHaveCount(0);
		});
	});
});
