import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	trackRow,
} from "./fixtures.ts";

const LYRIC = {
	// Repeated timestamps on one line: a refrain sung twice.
	synced: [
		"[00:12.00]I never meant to",
		"[00:18.50][01:02.10]Give you all my time",
		"[00:24.00]Dancing in the dark",
		"[00:31.00]",
		"[01:20.00]And I don't mind",
	].join("\r\n"),

	plain: ["Wait a minute, let me finish", "", "I came committed"].join("\r\n"),

	// Long enough to scroll the panel on any phone, and untimed so nothing
	// follows it back up while a test is reading where it was left.
	long: Array.from({ length: 80 }, (_, at) => `Line ${at + 1}`).join("\r\n"),

	// The same, timed: long enough to scroll, and spread across the track so it
	// is followable rather than boilerplate.
	longSynced: Array.from({ length: 60 }, (_, at) => {
		const second = 4 + at * 4;
		const mm = String(Math.floor(second / 60)).padStart(2, "0");
		const ss = String(second % 60).padStart(2, "0");
		return `[${mm}:${ss}.00]Line ${at + 1} of the song`;
	}).join("\r\n"),

	// A NetEase rip of an instrumental: two credit lines and a marker, all inside
	// the first five seconds of a four-minute track.
	boilerplate: [
		"[00:00.00] 作词 : Marcus Fuereder",
		"[00:01.00] 作曲 : Marcus Fuereder",
		"[00:05.00]纯音乐，请欣赏",
	].join("\r\n"),
};

export const TAGGED = {
	retagged: {
		"Los Calientes": { "$meta(unsynced lyrics)": LYRIC.synced },
		Fizz: { "$meta(unsynced lyrics)": LYRIC.plain },
		Deléctrico: { "$meta(unsynced lyrics)": LYRIC.boilerplate },
		Pendejo: { "$meta(unsynced lyrics)": LYRIC.long },
		"El Loco": { "$meta(unsynced lyrics)": LYRIC.longSynced },
		// Soy Rock is left with no lyric tag at all -- the common case in a real library.
	},
};

export const writeLyric = (player: FakePlayer, lyric: string) => {
	const item = player.player.activeItem;
	const track = player.playlistById(item.playlistId)?.items[item.index];
	if (!track) throw new Error("nothing is playing to write a lyric onto");
	track["$meta(unsynced lyrics)"] = lyric;
};

export const playRow = async (page: Page, row: number) => {
	await openLibrary(page);
	await trackRow(page, row).dblclick();
	await openNowPlaying(page);
};

export const trackInfo = (page: Page) =>
	page.getByRole("region", { name: "Track information" });

export const openPanels = async (page: Page, isMobile: boolean) => {
	if (!isMobile) return nowPlayingScreen(page);
	await nowPlayingScreen(page).getByRole("button", { name: "Lyrics" }).click();
	await expect(trackInfo(page)).toBeVisible();
	return trackInfo(page);
};

export const panelTab = (root: Locator, name: string) =>
	root.getByRole("button", { name, exact: true });

// `aria-current` rather than the `data-active` beside it. The component sets
// both from one expression, so asserting the styling hook leaves the half a
// screen reader uses free to disappear without a test noticing.
export const expectPanelOpen = async (root: Locator, name: string) => {
	await expect(panelTab(root, name)).toHaveAttribute("aria-current", "true");
};
