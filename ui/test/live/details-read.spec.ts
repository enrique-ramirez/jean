import { NOW_PLAYING_EXPRESSIONS } from "../../src/features/now-playing/nowPlayingFields.ts";
import {
	nowPlayingScreen,
	openNowPlaying,
	statusBar,
	trackRow,
} from "../e2e/fixtures.ts";
import { expectPanelOpen, panelTab } from "../e2e/nowPlaying.ts";
import {
	COMPONENT,
	component,
	playRow,
	removePlaylist,
	TOKEN,
} from "./component.ts";
import {
	api,
	expect,
	type Locator,
	type Page,
	post,
	reset,
	seedToken,
	test,
} from "./fixtures.ts";

// Criteria 4, 16, 21, 27, 30 and 33 of 016 on a real foobar2000: the details panel and the
// lyric read through `GET /api/track/playing`, on a library track, on one the library does not
// hold, on a station announcing songs, and across a manual skip. The fake answers a column by
// dictionary lookup, so only a player can say whether it evaluates these expressions the way
// the panel needs, and only a player can crash on leaving a stream.
//
// Plays nothing unless the player is already muted, since the library and the room are the
// owner's.

const STREAM =
	process.env.LIVE_STREAM ?? "http://ice1.somafm.com/groovesalad-128-mp3";
// beefweb adds a local file only from its own music directories, which are the library's, so a
// file the library has never indexed is reached by URL instead.
const REMOTE_FILE =
	process.env.LIVE_REMOTE_FILE ??
	"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
const PROBE = "#Jean 016 probe";

// An announcement lands when the station's song ends, and a station plays whole songs.
const ANNOUNCEMENT_WAIT_MS = 9 * 60_000;

const LYRIC_LOOKS_END_MS = 20_000;
const SAMPLES = 9;

const NOTHING_PLAYING = "Nothing playing.";

interface Playing {
	playback: string;
	path: string | null;
	subsong: number;
	title: string | null;
	artist: string | null;
	libraryPath: string | null;
	muted: boolean;
}

const playing = () =>
	component<{ player: Playing; library: { ready: boolean } }>("/api/state");

interface Read {
	status: number;
	columnCount: number;
	path?: string;
	subsong?: number;
	columns?: string[];
}

// What the page itself asked the component and heard back, which is the only way to see a
// column the panel reads and does not draw.
const watchReads = (page: Page) => {
	const reads: Read[] = [];
	page.on("response", async (response) => {
		const url = new URL(response.url());
		if (!url.pathname.endsWith("/api/track/playing")) return;
		if (response.request().method() !== "GET") return;
		const read: Read = {
			status: response.status(),
			columnCount: url.searchParams.getAll("columns").length,
		};
		if (response.ok()) Object.assign(read, await response.json());
		reads.push(read);
	});
	return reads;
};

const watchTagWrites = (page: Page) => {
	const writes: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/tags"))
			writes.push(request.url());
	});
	return writes;
};

const watchForNothingPlaying = (page: Page) =>
	page.evaluate((said) => {
		const seen = { times: 0 };
		(window as unknown as { nothingPlaying: typeof seen }).nothingPlaying =
			seen;
		new MutationObserver(() => {
			if (document.body.innerText.includes(said)) seen.times += 1;
		}).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}, NOTHING_PLAYING);

const timesNothingPlayingWasSaid = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { nothingPlaying: { times: number } })
				.nothingPlaying.times,
	);

// Jean is served under a path here, so the route hash is relative: `/#/all` would reach beefweb's
// own web UI at the origin root instead. Opening every track also has Jean load the media library.
const openAllMusic = async (page: Page) => {
	await page.goto("#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

const detailRows = (panel: Locator) => panel.getByRole("term");

const rowValue = (panel: Locator, label: string) =>
	panel
		.getByRole("term")
		.filter({ hasText: new RegExp(`^${label}$`) })
		.locator("xpath=following-sibling::dd[1]");

// The gatefold picks Lyrics or Details for itself once a track's read lands, so a tab chosen
// before that is overruled. Choosing after it is what a person looking at the screen does.
const openDetails = async (page: Page, reads: Read[], path: string) => {
	await openNowPlaying(page);
	await expect.poll(() => lastGoodRead(reads, path)).toBeDefined();
	const panel = nowPlayingScreen(page);
	await panelTab(panel, "Details").click();
	await expectPanelOpen(panel, "Details");
	return panel;
};

const untilPlaying = (path: string) =>
	expect
		.poll(async () => (await playing()).player.path, { timeout: 30_000 })
		.toBe(path);

const lastGoodRead = (reads: Read[], path: string | null) =>
	reads.filter((read) => read.status === 200 && read.path === path).at(-1);

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

const timed = async (path: string) => {
	const from = performance.now();
	const response = await fetch(`${COMPONENT()}${path}`, {
		headers: { Authorization: `Bearer ${TOKEN()}` },
	});
	await response.text();
	return {
		status: response.status,
		seconds: (performance.now() - from) / 1000,
	};
};

const columnsQuery = (columns: readonly string[]) =>
	columns.map((column) => `columns=${encodeURIComponent(column)}`).join("&");

// Long enough that nothing ends under a test waiting out the lyric recheck's last look.
const LONG_ENOUGH_S = 240;

// Two library tracks for the panel and the skip, and one with no lyric tag by whoever has the
// largest share of their tracks already tagged: the likeliest for foo_openlyrics to find a lyric
// for and save while it plays.
const pickTracks = async (origin: string) => {
	const columns = [
		"%path%",
		"%artist%",
		"%length_seconds%",
		"$len($meta(unsynced lyrics))",
	];
	const { libraryItems } = await api<{
		libraryItems: { items: { columns: string[] }[] };
	}>(origin, `/library/items?columns=${encodeURIComponent(columns.join(","))}`);
	const long = libraryItems.items
		.map(({ columns: [path, artist, seconds, lyric] }) => ({
			path,
			artist,
			isBare: !(Number(lyric) > 0),
			isLong: Number(seconds) >= LONG_ENOUGH_S,
		}))
		.filter((track) => track.isLong);

	const byArtist = new Map<string, { tagged: number; bare: string[] }>();
	for (const track of long) {
		const entry = byArtist.get(track.artist) ?? { tagged: 0, bare: [] };
		if (track.isBare) entry.bare.push(track.path);
		else entry.tagged += 1;
		byArtist.set(track.artist, entry);
	}
	const share = (entry: { tagged: number; bare: string[] }) =>
		entry.tagged / (entry.tagged + entry.bare.length);
	const best = [...byArtist.values()]
		.filter((entry) => entry.bare.length > 0 && entry.tagged >= 10)
		.sort((a, b) => share(b) - share(a))[0];

	const [first, second] = long;
	if (!first || !second)
		throw new Error(
			`the library holds fewer than two tracks of ${LONG_ENOUGH_S} s`,
		);
	return {
		library: [first.path, second.path],
		lyric: best?.bare[0] ?? first.path,
	};
};

test.describe.configure({ mode: "serial" });

let probe = "";
const ROW = { library: 0, lyric: 2, stream: 3, remote: 4 };
let libraryTrack = "";
let lyricTrack = "";

test.beforeAll(async ({ install }) => {
	const { player } = await playing();
	if (!player.muted)
		throw new Error("Mute the player first: these specs play real audio.");

	const stale = (
		await component<{ playlists: { id: string; title: string }[] }>(
			"/api/playlists",
		)
	).playlists.filter((entry) => entry.title === PROBE);
	for (const entry of stale) await removePlaylist(entry.id);

	const picked = await pickTracks(install.origin);
	libraryTrack = picked.library[0];
	lyricTrack = picked.lyric;
	const created = await component<{ id: string }>("/api/playlists", {
		method: "POST",
		body: JSON.stringify({ title: PROBE }),
	});
	probe = created.id;

	// The component adds library rows only, so the URLs go in through beefweb. Adding is safe
	// there; deleting a playlist through beefweb is not, which is why it is removed below
	// through the component.
	const { playlists } = await api<{
		playlists: { id: string; title: string }[];
	}>(install.origin, "/playlists");
	const beefwebId = playlists.find((entry) => entry.title === PROBE)?.id;
	if (!beefwebId) throw new Error(`beefweb does not list ${PROBE}`);
	await post(install.origin, `/playlists/${beefwebId}/items/add`, {
		items: [libraryTrack, picked.library[1], lyricTrack, STREAM, REMOTE_FILE],
	});
});

test.afterAll(async ({ install }) => {
	await reset(install.origin);
	if (probe) await removePlaylist(probe);
});

test.beforeEach(async ({ page }) => {
	await seedToken(page);
});

test("the details panel fills for a track the media library holds", async ({
	page,
}) => {
	const reads = watchReads(page);
	await openAllMusic(page);
	await playRow(probe, ROW.library);
	await untilPlaying(libraryTrack);
	const { player } = await playing();
	expect(player.libraryPath).not.toBeNull();

	const panel = await openDetails(page, reads, libraryTrack);
	await expect(detailRows(panel).first()).toBeVisible();
	await expect(panel).not.toContainText(NOTHING_PLAYING);
	expect(lastGoodRead(reads, player.path)).toBeDefined();
	console.log(
		`[016] library track: ${await detailRows(panel).count()} rows, reads ${JSON.stringify(reads.map((read) => read.status))}`,
	);
});

test("the details panel holds its rows across a manual Next and never says nothing is playing", async ({
	page,
}) => {
	const reads = watchReads(page);
	await openAllMusic(page);
	await playRow(probe, ROW.library);
	await untilPlaying(libraryTrack);
	const before = libraryTrack;
	const panel = await openDetails(page, reads, libraryTrack);
	await expect(detailRows(panel).first()).toBeVisible();

	await watchForNothingPlaying(page);
	await statusBar(page).getByRole("button", { name: "Next track" }).click();
	await expect.poll(async () => (await playing()).player.path).not.toBe(before);
	const after = (await playing()).player.path;

	await expect.poll(() => lastGoodRead(reads, after)).toBeDefined();
	await expect(detailRows(panel).first()).toBeVisible();
	expect(await timesNothingPlayingWasSaid(page)).toBe(0);
	console.log(
		`[016] after Next: ${after}, ${await detailRows(panel).count()} rows`,
	);
});

test("the details panel fills for a track the media library does not hold", async ({
	page,
}) => {
	const reads = watchReads(page);
	await openAllMusic(page);
	await playRow(probe, ROW.remote);
	await untilPlaying(REMOTE_FILE);
	expect((await playing()).player.libraryPath).toBeNull();

	const panel = await openDetails(page, reads, REMOTE_FILE);
	await expect(detailRows(panel).first()).toBeVisible();
	await expect(panel).not.toContainText(NOTHING_PLAYING);
	expect(lastGoodRead(reads, REMOTE_FILE)).toBeDefined();
	console.log(
		`[016] off-library file: format ${await rowValue(panel, "Format").textContent()}, bitrate ${await rowValue(panel, "Bitrate").textContent()}`,
	);
});

test("on a station the details panel names the announced song, and follows the next announcement", async ({
	page,
}) => {
	test.setTimeout(ANNOUNCEMENT_WAIT_MS + 120_000);
	const reads = watchReads(page);
	await openAllMusic(page);
	await playRow(probe, ROW.stream);
	await untilPlaying(STREAM);
	await expect
		.poll(async () => (await playing()).player.artist, { timeout: 30_000 })
		.toBeTruthy();
	const first = (await playing()).player;

	// `%album artist%` falls back to `%artist%` in foobar2000, so this row is the announced
	// artist, drawn, where the station's stored tags carry none.
	const panel = await openDetails(page, reads, STREAM);
	await expect(rowValue(panel, "Album artist")).toHaveText(
		first.artist as string,
	);
	await expect(panel).not.toContainText("SomaFM");
	console.log(
		`[016] stream announces ${first.artist} - ${first.title}; bitrate row ${await rowValue(panel, "Bitrate").textContent()}`,
	);

	const readsBefore = reads.length;
	await expect
		.poll(
			async () => {
				const now = (await playing()).player;
				return now.title !== first.title || now.artist !== first.artist;
			},
			{ timeout: ANNOUNCEMENT_WAIT_MS, intervals: [5_000] },
		)
		.toBe(true);
	const next = (await playing()).player;
	expect(next.path).toBe(STREAM);

	await expect
		.poll(() => reads.slice(readsBefore).some((read) => read.status === 200))
		.toBe(true);
	await expect(rowValue(panel, "Album artist")).toHaveText(
		next.artist as string,
	);
	console.log(
		`[016] next announcement ${next.artist} - ${next.title}; bitrate row ${await rowValue(panel, "Bitrate").textContent()}`,
	);
});

test("foobar2000 stays up when a stream is stopped, and when one is skipped", async ({
	page,
	install,
}) => {
	// The crash needs a client to have loaded the media library since startup.
	await openAllMusic(page);
	await expect
		.poll(async () => (await playing()).library.ready, { timeout: 60_000 })
		.toBe(true);

	await playRow(probe, ROW.stream);
	await untilPlaying(STREAM);
	await post(install.origin, "/player/stop");
	await expect
		.poll(async () => (await playing()).player.playback, { timeout: 15_000 })
		.toBe("stopped");
	await expect(api(install.origin, "/player")).resolves.toBeDefined();

	await playRow(probe, ROW.stream);
	await untilPlaying(STREAM);
	await openNowPlaying(page);
	await statusBar(page).getByRole("button", { name: "Next track" }).click();
	await expect
		.poll(async () => (await playing()).player.path, { timeout: 30_000 })
		.not.toBe(STREAM);
	await expect(api(install.origin, "/player")).resolves.toBeDefined();
	console.log(
		`[016] after skipping the stream: ${(await playing()).player.path}`,
	);
});

test("a lyric saved while the track plays is caught by the recheck, and Jean writes no tag", async ({
	page,
}) => {
	test.setTimeout(LYRIC_LOOKS_END_MS + 90_000);
	const reads = watchReads(page);
	const writes = watchTagWrites(page);
	await openAllMusic(page);
	await playRow(probe, ROW.lyric);
	await untilPlaying(lyricTrack);
	const { player } = await playing();

	const panel = await openDetails(page, reads, lyricTrack);
	await expect(detailRows(panel).first()).toBeVisible();
	const first = lastGoodRead(reads, player.path);
	const lyricAtStart = first?.columns?.[0];
	test.skip(
		lyricAtStart !== "?" && lyricAtStart !== "",
		`${player.path} already carries a lyric, so there is nothing for the recheck to catch`,
	);

	await page.waitForTimeout(LYRIC_LOOKS_END_MS + 3_000);
	const looks = reads.filter((read) => read.columnCount === 1);
	const caught = looks.find(
		(read) =>
			read.columns?.[0] && read.columns[0] !== "?" && read.columns[0] !== "",
	);
	console.log(
		`[016] recheck looks: ${looks.length}, caught: ${Boolean(caught)}, tag writes: ${writes.length}`,
	);
	expect(writes).toEqual([]);
	test.skip(
		!caught,
		`foo_openlyrics saved no lyric to ${player.path} within the four looks`,
	);

	await panelTab(panel, "Lyrics").click();
	await expect(panel).not.toContainText("No lyrics found");
});

test("the playing-track read, timed beside the library read of the same track", async ({
	page,
}) => {
	await openAllMusic(page);
	await playRow(probe, ROW.library);
	await untilPlaying(libraryTrack);
	const { player } = await playing();
	const columns = columnsQuery(NOW_PLAYING_EXPRESSIONS);

	const samples: number[] = [];
	for (let at = 0; at < SAMPLES; at++) {
		const { status, seconds } = await timed(`/api/track/playing?${columns}`);
		expect(status).toBe(200);
		samples.push(seconds);
	}
	const library = await timed(
		`/api/track/library?track=${encodeURIComponent(player.libraryPath as string)}&subsong=${player.subsong}&${columns}`,
	);
	expect(library.status).toBe(200);

	console.log(
		`[016] GET /api/track/playing, ${NOW_PLAYING_EXPRESSIONS.length} columns, ${SAMPLES} reads: median ${median(samples).toFixed(3)} s, max ${Math.max(...samples).toFixed(3)} s; GET /api/track/library once: ${library.seconds.toFixed(3)} s; 014 recorded 0.28 s`,
	);
});
