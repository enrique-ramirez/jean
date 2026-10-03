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
		// Soy Rock is left with no lyric tag at all, the common case in a real
		// library, and it is library row 3. Every case that wants a track with no
		// lyric plays that row.
	},
};

export const writeLyric = (
	player: FakePlayer,
	lyric: string,
	tag = "unsynced lyrics",
) => {
	const written = player.retagPlaying({ [`$meta(${tag})`]: lyric });
	if (!written) throw new Error("nothing is playing to write a lyric onto");
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

export const titleAddressedBy = (
	player: FakePlayer,
	body: Record<string, unknown> | null | undefined,
) => {
	if (typeof body?.track === "string") {
		const subsong = Number(body.subsong ?? 0);
		const held = player.playlists
			.flatMap((playlist) => playlist.items)
			.find(
				(track) =>
					player.libraryPathFor(track) === body.track &&
					(Number(track["%subsong%"]) || 0) === subsong,
			);
		return held?.["%title%"] ?? null;
	}
	if (typeof body?.playlist === "string")
		return (
			player.playlistByGuid(body.playlist)?.items[Number(body.index)]?.[
				"%title%"
			] ?? null
		);
	if (typeof body?.ordinal === "number")
		return player.ordinalOrder()[body.ordinal]?.track["%title%"] ?? null;
	return null;
};

export const lyricTagOf = (
	player: FakePlayer,
	title: string,
	tag = "unsynced lyrics",
) =>
	player
		.playlistById("p7")
		?.items.find((track) => track["%title%"] === title)?.[`$meta(${tag})`];

export const untilThePageKnowsPlaying = (page: Page, title: string) =>
	expect(page).toHaveTitle(
		new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `),
	);

export const discardPrompt = (page: Page) => page.getByRole("alertdialog");

export const keepEditingButton = (prompt: Locator) =>
	prompt.getByRole("button", { name: "Keep editing", exact: true });

export const discardButton = (prompt: Locator) =>
	prompt.getByRole("button", { name: "Discard", exact: true });

const PROMPT_TITLE = "Discard your changes?";

export const expectDiscardPrompt = async (page: Page, description?: string) => {
	const prompt = discardPrompt(page);
	await expect(prompt).toBeVisible();
	await expect(prompt).toHaveAccessibleName(PROMPT_TITLE);
	await expect(prompt.getByText(PROMPT_TITLE, { exact: true })).toBeVisible();
	if (description === undefined)
		await expect(prompt).toHaveAccessibleDescription(/\S/);
	else {
		await expect(prompt).toHaveAccessibleDescription(description);
		await expect(prompt).toContainText(description);
	}
	// A screen reader's cursor is not held by a focus trap; aria-modal keeps it off the page behind.
	await expect(prompt).toHaveAttribute("aria-modal", "true");
	await expect(prompt.getByRole("button")).toHaveCount(2);
	await expect(discardButton(prompt)).toBeVisible();
	await expect(keepEditingButton(prompt)).toBeFocused();
	return prompt;
};

export const recordPromptsEverShown = (page: Page) =>
	page.addInitScript(() => {
		const shown: string[] = [];
		const seen = new WeakSet<Element>();
		Object.assign(window, { promptsShown: shown });
		const look = () => {
			for (const prompt of document.querySelectorAll('[role="alertdialog"]')) {
				if (seen.has(prompt)) continue;
				seen.add(prompt);
				shown.push(prompt.querySelector("h1, h2, h3")?.textContent ?? "");
			}
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
		});
	});

export const promptsEverShown = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { promptsShown: string[] }).promptsShown,
	);

const TOUCH_TARGET = 44;

export const expectTouchTargets = async (
	controls: readonly (readonly [name: string, control: Locator])[],
) => {
	for (const [name, control] of controls) {
		await expect(control, `${name} is not drawn`).toBeVisible();
		const height = Math.round((await control.boundingBox())?.height ?? 0);
		expect
			.soft(height, `${name} is ${height} px tall`)
			.toBeGreaterThanOrEqual(TOUCH_TARGET);
	}
};
