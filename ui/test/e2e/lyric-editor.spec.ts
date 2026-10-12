import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectDisabledWithReason,
	expectNothingRefusedSent,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	playbackCommands,
	requestsTo,
	test,
	times,
	toastRegion,
	toasts,
	tokenColourIn,
	untilQuiet,
} from "./fixtures.ts";
import {
	discardButton,
	discardPrompt,
	expectDiscardPrompt,
	expectTouchTargets,
	keepEditingButton,
	lyricTagOf,
	openPanels,
	panelTab,
	playRow,
	promptsEverShown,
	recordPromptsEverShown,
	titleAddressedBy,
	untilThePageKnowsPlaying,
	writeLyric,
} from "./nowPlaying.ts";

const LYRIC_FIELD = "unsynced lyrics";

const SAVING_POSSIBLE = { allowedFields: ["rating", LYRIC_FIELD] };

const TITLE = "Los Calientes";
const ARTIST = "Babasónicos";

const HEADED = [
	`[ti:${TITLE}]`,
	`[ar:${ARTIST}]`,
	"[00:10.00]First line",
	"[00:20.00]Second line",
	"[00:31.00]",
	"[01:02.10]Fourth line",
].join("\r\n");

const PART_TIMED = [
	"[00:10.00]First line",
	"Second line",
	"[00:30.00]Third line",
].join("\r\n");

const UNTIMED_WORDS = ["Plain one", "Plain two", "Plain three"];

const WITH_HEADERS = 0;
const PART_SYNCED = 1;
const UNSYNCED = 2;
const NO_LYRIC = { row: 3, title: "Soy Rock" };

const EDITABLE = {
	retagged: {
		[TITLE]: { [`$meta(${LYRIC_FIELD})`]: HEADED },
		Fizz: { [`$meta(${LYRIC_FIELD})`]: PART_TIMED },
		Deléctrico: { [`$meta(${LYRIC_FIELD})`]: UNTIMED_WORDS.join("\r\n") },
	},
	fooJean: SAVING_POSSIBLE,
};

const lyricsPanel = (page: Page, isMobile: boolean) =>
	page.getByRole("region", {
		name: isMobile ? "Track information" : "Current track",
	});

const editButton = (panel: Locator) =>
	panel.getByRole("button", { name: "Edit", exact: true });

const openLyricsOf = async (page: Page, isMobile: boolean, row: number) => {
	await playRow(page, row);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Lyrics").click();
	return panel;
};

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

const TRACK_SECONDS = 277;

const record = (
	id: number,
	albumName: string,
	lyrics: { synced?: string; plain: string },
): Version => ({
	id,
	trackName: `${TITLE}, take ${id}`,
	artistName: ARTIST,
	albumName,
	duration: TRACK_SECONDS,
	instrumental: false,
	plainLyrics: lyrics.plain,
	syncedLyrics: lyrics.synced ?? null,
});

const ON_LRCLIB = record(21, "Album", {
	synced: [
		`[ti:${TITLE}]`,
		"[00:10.00]First line",
		"[00:20.00]Second line",
		"[00:30.00]Third line",
	].join("\n"),
	plain: "First line\nSecond line\nThird line",
});

const PLAIN_WORDS = "Plain one\nPlain two\n\nPlain three";

const PLAIN_ON_LRCLIB = record(22, "Reissue", {
	plain: `[ar:${ARTIST}]\n${PLAIN_WORDS}`,
});

// LRCLIB is another origin, so a browser sends a CORS preflight OPTIONS before each GET.
// It is answered here and not counted.
const CROSS_ORIGIN = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "*",
	"access-control-expose-headers": "Retry-After",
};

const interceptLrclib = async (page: Page, records: Version[] = []) => {
	const searches: string[] = [];
	await page.route("https://lrclib.net/**", (route) => {
		const request = route.request();
		if (request.method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: CROSS_ORIGIN });
		searches.push(request.url());
		return route.fulfill({ json: records, headers: CROSS_ORIGIN });
	});
	return searches;
};

const preview = (panel: Locator) =>
	panel.getByRole("region", { name: "Preview", exact: true });

const openPreviewOf = async (
	page: Page,
	isMobile: boolean,
	kind: "Synced" | "Plain",
) => {
	const panel = await openLyricsOf(page, isMobile, WITH_HEADERS);
	await panel.getByRole("button", { name: "Search", exact: true }).click();
	await panel
		.getByRole("region", { name: "Versions on LRCLIB" })
		.getByRole("list", { name: new RegExp(`^${kind}\\b`) })
		.getByRole("listitem")
		.first()
		.getByRole("button")
		.click();
	const shown = preview(panel);
	await expect(shown).toBeVisible();
	return shown;
};

const openInEditor = async (shown: Locator) => {
	const open = shown.getByRole("button", {
		name: "Open in editor",
		exact: true,
	});
	await expect(open).toBeVisible();
	await open.click();
};

const lyricWrites = (player: FakePlayer) =>
	requestsTo(player, "/api/tags")
		.filter((one) => one.method === "POST")
		.map((one) => one.body?.fields);

const expectNothingWritten = (player: FakePlayer) =>
	expectSettlesAt(player, () => lyricWrites(player).length, 0);

const expectSearchesSettleAt = (
	player: FakePlayer,
	searches: string[],
	count: number,
) => expectSettlesAt(player, () => searches.length, count);

const holdAt = (player: FakePlayer, position: number) =>
	player.patchPlayer({ position, playbackState: "paused" });

const sungLine = (within: Locator) =>
	within.locator('[aria-current="true"]:not(nav *)');

const editorOf = (page: Page) =>
	page.getByRole("dialog", { name: "Edit lyrics", exact: true });

const openEditor = async (page: Page, isMobile: boolean, row: number) => {
	const panel = await openLyricsOf(page, isMobile, row);
	await editButton(panel).click();
	const editor = editorOf(page);
	await expect(editor).toBeVisible();
	return editor;
};

const saveButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Save", exact: true });

const closeButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Close", exact: true });

const lineRows = (editor: Locator) =>
	editor.locator('[role="row"][aria-selected]');

const selectedRows = (editor: Locator) =>
	editor.locator('[role="row"][aria-selected="true"]');

const lineRow = (editor: Locator, text: string) =>
	lineRows(editor).filter({ hasText: text });

const selectLine = async (editor: Locator, text: string) => {
	await lineRow(editor, text).getByText(text, { exact: true }).click();
	await expect(lineRow(editor, text)).toHaveAttribute("aria-selected", "true");
};

type Shown = readonly [at: string | null, text: string];

const A_TIME = String.raw`\d+:\d\d\.\d\d`;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const reading = ([at, text]: Shown) =>
	at === null
		? new RegExp(`^(?!\\s*${A_TIME})[\\s\\S]*?${literal(text)}`)
		: new RegExp(`^\\s*${literal(at)}\\s*${literal(text)}`);

const expectLines = (editor: Locator, lines: Shown[]) =>
	expect(lineRows(editor)).toHaveText(lines.map(reading));

const BREAK = "Instrumental break";

const HEADED_LINES: Shown[] = [
	["0:10.00", "First line"],
	["0:20.00", "Second line"],
	["0:31.00", BREAK],
	["1:02.10", "Fourth line"],
];

type Scope = "This line" | "All lines";

const stepperFor = async (editor: Locator, isMobile: boolean, scope: Scope) => {
	if (isMobile) {
		const choose = editor.getByRole("button", { name: scope, exact: true });
		await choose.click();
		await expect(choose).toHaveAttribute("aria-pressed", "true");
	}
	return editor.getByRole("group", { name: scope, exact: true });
};

// The minus is U+2212.
type Step = "−1 s" | "−0.1" | "+0.1" | "+1 s";

const step = (stepper: Locator, by: Step, presses = 1) =>
	times(presses, () =>
		stepper.getByRole("button", { name: by, exact: true }).click(),
	);

const recordSelectionsEverMade = (page: Page) =>
	page.addInitScript(() => {
		const selected = new Set<string>();
		Object.assign(window, { lyricRowsSelected: selected });
		const look = () => {
			for (const row of document.querySelectorAll(
				'[role="dialog"] [aria-selected="true"]',
			))
				selected.add(row.textContent ?? "");
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
		});
	});

const selectionsEverMade = (page: Page) =>
	page.evaluate(() => [
		...(window as unknown as { lyricRowsSelected: Set<string> })
			.lyricRowsSelected,
	]);

test.describe("opening the editor", () => {
	test.use(EDITABLE);

	test("Edit beside a synced lyric opens a full-screen editor on that lyric, each line with its time", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page);
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		await expectLines(editor, HEADED_LINES);

		await expect(editor).toContainText(
			isMobile ? `Saves to ${TITLE}` : `Saves to ${TITLE} by ${ARTIST}`,
		);

		const viewport = page.viewportSize();
		await expect
			.poll(async () => {
				const box = await editor.boundingBox();
				return box && [box.x, box.y, box.width, box.height].map(Math.round);
			})
			.toEqual([0, 0, viewport?.width, viewport?.height]);

		await expectNothingWritten(player);
		expect(searches).toEqual([]);
	});

	test("Edit on an empty panel opens the editor with no lines, bound to the playing track", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page);
		const editor = await openEditor(page, isMobile, NO_LYRIC.row);

		await expect(editor).toContainText(`Saves to ${NO_LYRIC.title}`);
		await expect(saveButton(editor)).toBeVisible();

		await expectNothingWritten(player);
		expect(await lineRows(editor).count()).toBe(0);
		expect(searches).toEqual([]);
	});

	test("Open in editor on a preview opens the editor on that version, with the preview's nudges in its times", async ({
		page,
		player,
		isMobile,
	}) => {
		const searches = await interceptLrclib(page, [ON_LRCLIB]);
		const shown = await openPreviewOf(page, isMobile, "Synced");

		const all = await stepperFor(shown, isMobile, "All lines");
		await step(all, "+1 s", 8);
		await step(all, "−0.1");
		await shown
			.getByRole("button", { name: "Second line", exact: true })
			.click();
		const one = await stepperFor(shown, isMobile, "This line");
		await step(one, "−1 s");
		await step(one, "+0.1");

		await openInEditor(shown);

		const editor = editorOf(page);
		await expectLines(editor, [
			["0:17.90", "First line"],
			["0:27.00", "Second line"],
			["0:37.90", "Third line"],
		]);
		await expect(
			editor.getByText(`[ti:${TITLE}]`, { exact: true }),
		).toBeVisible();
		await expect(editor).toContainText(`Saves to ${TITLE}`);

		await expectSearchesSettleAt(player, searches, 1);
		await expectNothingWritten(player);
	});

	test("header lines are drawn at the top, labelled header, and never take the selection", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordSelectionsEverMade(page);
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		const title = editor.getByText(`[ti:${TITLE}]`, { exact: true });
		const artist = editor.getByText(`[ar:${ARTIST}]`, { exact: true });
		await expect(title).toBeVisible();
		await expect(artist).toBeVisible();
		await expect(editor.getByText("header", { exact: true })).toHaveCount(2);

		await expectLines(editor, HEADED_LINES);

		const top = async (of: Locator) =>
			(await of.boundingBox())?.y ?? Number.NaN;
		const firstLine = await top(lineRow(editor, "First line"));
		expect(await top(title)).toBeLessThan(await top(artist));
		expect(await top(artist)).toBeLessThan(firstLine);

		await title.click();
		await artist.click();
		await selectLine(editor, "Second line");

		if (!isMobile) {
			await page.keyboard.press("ControlOrMeta+a");
			await expect(selectedRows(editor)).toHaveCount(HEADED_LINES.length);
		}

		const everSelected = await selectionsEverMade(page);
		expect(everSelected.join("\n")).toContain("Second line");
		expect(everSelected.filter((row) => /\[(ti|ar):/.test(row))).toEqual([]);

		await expectNothingWritten(player);
	});

	test("an empty timed line reads Instrumental break beside its time", async ({
		page,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		await expect(lineRow(editor, BREAK)).toHaveText(
			reading(["0:31.00", BREAK]),
		);
		await expect(editor.getByText(BREAK, { exact: true })).toHaveCount(1);
	});

	test("the close control closes an editor nothing was changed in, without asking and without writing", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await expectLines(editor, HEADED_LINES);

		await closeButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expect(page.getByRole("alertdialog")).toHaveCount(0);
		const panel = lyricsPanel(page, isMobile);
		await expect(panel.getByText("Fourth line")).toBeVisible();
		await expect(editButton(panel)).toBeVisible();
		await expectNothingWritten(player);
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"Escape is a key, and the phone has none",
		);

		test("Escape closes an editor nothing was changed in, and leaves the screen under it open", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			await expectLines(editor, HEADED_LINES);

			await page.keyboard.press("Escape");

			await expect(editor).toHaveCount(0);
			await expect(page.getByRole("alertdialog")).toHaveCount(0);
			await untilQuiet(player);
			await expectTheScreenIsStillOpen(page);
			await expect(
				lyricsPanel(page, false).getByText("Fourth line"),
			).toBeVisible();
			await expectNothingWritten(player);
		});
	});
});

test.describe("saving from the editor", () => {
	test.use(EDITABLE);

	const SAVED = [
		`[ti:${TITLE}]`,
		`[ar:${ARTIST}]`,
		"[00:18.00]First line",
		"[00:27.90]Second line",
		"[00:39.00]",
		"[01:10.10]Fourth line",
	].join("\n");

	const TELLS_THEM_APART = 23;

	test("Save writes the lyric once as LRC, headers first and the shift inside the stamps, then closes onto the saved lyric with no toast", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await step(await stepperFor(editor, isMobile, "All lines"), "+1 s", 8);
		await selectLine(editor, "Second line");
		await step(await stepperFor(editor, isMobile, "This line"), "−0.1");
		await expectLines(editor, [
			["0:18.00", "First line"],
			["0:27.90", "Second line"],
			["0:39.00", BREAK],
			["1:10.10", "Fourth line"],
		]);
		await expectNothingWritten(player);

		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: SAVED },
		]);
		expect(await toasts(page).count()).toBe(0);

		const panel = lyricsPanel(page, isMobile);
		holdAt(player, TELLS_THEM_APART);
		await expect(sungLine(panel)).toHaveText("First line");
	});

	test("a lyric with no timed line is saved as plain text, with no stamps, and a row in brackets kept as a line of it", async ({
		page,
		player,
		isMobile,
	}) => {
		await interceptLrclib(page, [PLAIN_ON_LRCLIB]);
		const shown = await openPreviewOf(page, isMobile, "Plain");
		await openInEditor(shown);

		const editor = editorOf(page);
		await expect(lineRow(editor, "Plain three")).toHaveText(
			reading([null, "Plain three"]),
		);

		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: `[ar:${ARTIST}]\n${PLAIN_WORDS}` },
		]);
		expect(await toasts(page).count()).toBe(0);
	});
});

test.describe("shifting lines in the editor", () => {
	test.use(EDITABLE);

	test("one selected line moves by each of the four steps, and the lines around it stay where they were", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await selectLine(editor, "Second line");
		const one = await stepperFor(editor, isMobile, "This line");

		const withSecondAt = (at: string): Shown[] => [
			["0:10.00", "First line"],
			[at, "Second line"],
			["0:31.00", BREAK],
			["1:02.10", "Fourth line"],
		];

		await step(one, "+1 s");
		await expectLines(editor, withSecondAt("0:21.00"));
		await step(one, "+0.1");
		await expectLines(editor, withSecondAt("0:21.10"));
		await step(one, "−1 s", 2);
		await expectLines(editor, withSecondAt("0:19.10"));
		await step(one, "−0.1", 3);
		await expectLines(editor, withSecondAt("0:18.80"));

		await selectLine(editor, "Fourth line");
		await step(await stepperFor(editor, isMobile, "This line"), "−0.1");
		await expectLines(editor, [
			["0:10.00", "First line"],
			["0:18.80", "Second line"],
			["0:31.00", BREAK],
			["1:02.00", "Fourth line"],
		]);

		await expectNothingWritten(player);
	});

	test("every timed line moves by each of the four steps, and a line with no time stays without one", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, PART_SYNCED);
		const all = await stepperFor(editor, isMobile, "All lines");

		const movedTo = (first: string, third: string): Shown[] => [
			[first, "First line"],
			[null, "Second line"],
			[third, "Third line"],
		];

		await expectLines(editor, movedTo("0:10.00", "0:30.00"));
		await step(all, "+1 s");
		await expectLines(editor, movedTo("0:11.00", "0:31.00"));
		await step(all, "+0.1");
		await expectLines(editor, movedTo("0:11.10", "0:31.10"));
		await step(all, "−1 s", 2);
		await expectLines(editor, movedTo("0:09.10", "0:29.10"));
		await step(all, "−0.1", 3);
		await expectLines(editor, movedTo("0:08.80", "0:28.80"));
		await expectNothingWritten(player);

		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{
				[LYRIC_FIELD]: [
					"[00:08.80]First line",
					"Second line",
					"[00:28.80]Third line",
				].join("\n"),
			},
		]);
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"the phone has no keyboard, and docks one stepper where the desktop gives the selected line its own",
		);

		test("a click selects a line, the arrow keys move the selection, and the selected line carries its stepper", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			const ownStepper = (text: string) =>
				lineRow(editor, text).getByRole("group", {
					name: "This line",
					exact: true,
				});

			await selectLine(editor, "Second line");
			await expect(selectedRows(editor)).toHaveText([/Second line/]);
			await expect(ownStepper("Second line")).toBeVisible();

			await page.keyboard.press("ArrowDown");
			await expect(selectedRows(editor)).toHaveText([new RegExp(BREAK)]);
			await expect(ownStepper(BREAK)).toBeVisible();
			await expect(ownStepper("Second line")).toHaveCount(0);

			await page.keyboard.press("ArrowUp");
			await page.keyboard.press("ArrowUp");
			await expect(selectedRows(editor)).toHaveText([/First line/]);
			await expect(ownStepper("First line")).toBeVisible();

			await expect(
				editor.getByRole("group", { name: "All lines", exact: true }),
			).toBeVisible();
			await expectLines(editor, HEADED_LINES);
			await expectNothingWritten(player);
		});

		test("Alt with an arrow moves the selected line a tenth of a second, with Shift a second, and after Ctrl or Cmd+A every line", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			await selectLine(editor, "Second line");
			const commandsBefore = playbackCommands(player).length;

			const withSecondAt = (at: string): Shown[] => [
				["0:10.00", "First line"],
				[at, "Second line"],
				["0:31.00", BREAK],
				["1:02.10", "Fourth line"],
			];

			await page.keyboard.press("Alt+ArrowRight");
			await expectLines(editor, withSecondAt("0:20.10"));
			await page.keyboard.press("Alt+Shift+ArrowRight");
			await expectLines(editor, withSecondAt("0:21.10"));
			await page.keyboard.press("Alt+ArrowLeft");
			await page.keyboard.press("Alt+ArrowLeft");
			await expectLines(editor, withSecondAt("0:20.90"));
			await page.keyboard.press("Alt+Shift+ArrowLeft");
			await page.keyboard.press("Alt+Shift+ArrowLeft");
			await expectLines(editor, withSecondAt("0:18.90"));

			await page.keyboard.press("ArrowUp");
			await expect(selectedRows(editor)).toHaveText([/First line/]);
			await page.keyboard.press("Alt+ArrowRight");
			await expectLines(editor, [
				["0:10.10", "First line"],
				["0:18.90", "Second line"],
				["0:31.00", BREAK],
				["1:02.10", "Fourth line"],
			]);

			await page.keyboard.press("ControlOrMeta+a");
			await expect(selectedRows(editor)).toHaveCount(HEADED_LINES.length);

			await page.keyboard.press("Alt+Shift+ArrowRight");
			await expectLines(editor, [
				["0:11.10", "First line"],
				["0:19.90", "Second line"],
				["0:32.00", BREAK],
				["1:03.10", "Fourth line"],
			]);
			await page.keyboard.press("Alt+ArrowLeft");
			await page.keyboard.press("Alt+ArrowLeft");
			await expectLines(editor, [
				["0:10.90", "First line"],
				["0:19.70", "Second line"],
				["0:31.80", BREAK],
				["1:02.90", "Fourth line"],
			]);
			await page.keyboard.press("Alt+Shift+ArrowLeft");
			await page.keyboard.press("Alt+ArrowRight");
			await expectLines(editor, [
				["0:10.00", "First line"],
				["0:18.80", "Second line"],
				["0:30.90", BREAK],
				["1:02.00", "Fourth line"],
			]);

			await expectNothingWritten(player);
			expect(playbackCommands(player)).toHaveLength(commandsBefore);

			await saveButton(editor).click();
			await expect(editor).toHaveCount(0);
			await expectSettlesAt(player, () => lyricWrites(player), [
				{
					[LYRIC_FIELD]: [
						`[ti:${TITLE}]`,
						`[ar:${ARTIST}]`,
						"[00:10.00]First line",
						"[00:18.80]Second line",
						"[00:30.90]",
						"[01:02.00]Fourth line",
					].join("\n"),
				},
			]);
		});
	});
});

const LIBRARY_PLAYLIST = "p7";

const openEditorOnWhatThePlayerPlays = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
	row: number,
) => {
	player.playItem(LIBRARY_PLAYLIST, row);
	await openLibrary(page);
	await openNowPlaying(page);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Lyrics").click();
	await editButton(panel).click();
	const editor = editorOf(page);
	await expect(editor).toBeVisible();
	return editor;
};

const playhead = (editor: Locator) => editor.locator("[data-playhead]");

const secondsRead = (text: string | null | undefined) => {
	const read = /^\s*(\d+):(\d\d)\.(\d+)/.exec(text ?? "");
	return read ? Number(read[1]) * 60 + Number(`${read[2]}.${read[3]}`) : null;
};

const playheadSeconds = async (editor: Locator) =>
	secondsRead((await playhead(editor).allTextContents())[0]);

const POLL_AGE = 3;

const holdTheClockAt = async (
	editor: Locator,
	player: FakePlayer,
	position: number,
) => {
	holdAt(player, position);
	let last: number | null = null;
	await expect
		.poll(
			async () => {
				const now = await playheadSeconds(editor);
				const isHeld =
					now !== null &&
					now === last &&
					now >= position &&
					now < position + POLL_AGE;
				last = now;
				return isHeld ? "held" : `playhead at ${now}`;
			},
			{ intervals: [250] },
		)
		.toBe("held");
	return last ?? Number.NaN;
};

// The playhead shows tenths and a stamp holds hundredths, so a clock may drop or round the
// rest: 12.2 can hold up to 12.3. The allowance is that tenth and half of another.
const STAMP_TOLERANCE = 0.15;

const expectStamped = (row: Locator, at: number) =>
	expect
		.poll(async () => {
			const shown = secondsRead((await row.allTextContents())[0]);
			if (shown === null) return "not timed";
			return Math.abs(shown - at) <= STAMP_TOLERANCE
				? "on time"
				: `at ${shown}, clock held ${at}`;
		})
		.toBe("on time");

const stampButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Stamp", exact: true });

const stamp = (page: Page, editor: Locator, isMobile: boolean) =>
	isMobile ? stampButton(editor).click() : page.keyboard.press("Enter");

const top = async (of: Locator) => (await of.boundingBox())?.y ?? Number.NaN;

const expectPlayheadBetween = (editor: Locator, above: string, below: string) =>
	expect
		.poll(async () => {
			const at = await top(playhead(editor));
			const [over, under] = [
				await top(lineRow(editor, above)),
				await top(lineRow(editor, below)),
			];
			return over < at && at < under
				? "between"
				: `playhead at ${at}, rows at ${over} and ${under}`;
		})
		.toBe("between");

const seeksSent = (player: FakePlayer) =>
	requestsTo(player, "/api/playback/seek")
		.filter((one) => one.method === "POST")
		.map((one) => one.body);

const playFrom = (editor: Locator, time: string) =>
	editor.getByRole("button", { name: `Play from ${time}`, exact: true });

const anyPlayFrom = (editor: Locator) =>
	editor.getByRole("button", { name: /^Play from\b/ });

const playPauseButton = (editor: Locator) =>
	editor.getByRole("button", { name: /^(Play|Pause)($| \()/ });

const seekBackButton = (editor: Locator) =>
	editor.getByRole("button", { name: /^Seek back 5 seconds/ });

const seekForwardButton = (editor: Locator) =>
	editor.getByRole("button", { name: /^Seek forward 5 seconds/ });

const positionAtThePlayer = (player: FakePlayer) =>
	Math.round(player.player.activeItem.position);

test.describe("stamping lines against the song", () => {
	test.use(EDITABLE);

	test("a stamp sets the selected line to the audible position and selects the next line, and on the last line the selection stays", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, PART_SYNCED);
		await selectLine(editor, "Second line");

		const first = await holdTheClockAt(editor, player, 20);
		await stamp(page, editor, isMobile);
		await expectStamped(lineRow(editor, "Second line"), first);
		await expect(selectedRows(editor)).toHaveText([/Third line/]);

		const second = await holdTheClockAt(editor, player, 41);
		await stamp(page, editor, isMobile);
		await expectStamped(lineRow(editor, "Third line"), second);
		await expect(selectedRows(editor)).toHaveText([/Third line/]);

		const third = await holdTheClockAt(editor, player, 45);
		await stamp(page, editor, isMobile);
		await expectStamped(lineRow(editor, "Third line"), third);
		await expect(selectedRows(editor)).toHaveText([/Third line/]);

		await expect(lineRow(editor, "First line")).toHaveText(
			reading(["0:10.00", "First line"]),
		);
		await expect(lineRows(editor)).toHaveCount(3);
		await expectNothingWritten(player);
	});

	test("while the song plays, a stamp takes the position the clock has reached and not the one the player last answered", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, PART_SYNCED);
		await selectLine(editor, "Second line");
		player.patchPlayer({ position: 40, playbackState: "playing" });

		await expect
			.poll(async () => (await playheadSeconds(editor)) ?? 0)
			.toBeGreaterThanOrEqual(42);
		const before = (await playheadSeconds(editor)) ?? 0;
		expect(before).toBeLessThan(60);
		await stamp(page, editor, isMobile);

		const SLOW_PRESS = 10;
		await expect
			.poll(async () => {
				const shown = secondsRead(
					(await lineRow(editor, "Second line").allTextContents())[0],
				);
				if (shown === null) return "not timed";
				return shown >= before - 0.1 && shown <= before + SLOW_PRESS
					? "on time"
					: `at ${shown}, playhead was at ${before}`;
			})
			.toBe("on time");
		await expectNothingWritten(player);
	});

	test("stamping every line of an untimed lyric and saving writes LRC with those times", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, UNSYNCED);
		await expectLines(
			editor,
			UNTIMED_WORDS.map((words) => [null, words] as const),
		);
		await selectLine(editor, UNTIMED_WORDS[0]);

		const held: number[] = [];
		for (const [index, at] of [12, 24, 36].entries()) {
			held.push(await holdTheClockAt(editor, player, at));
			await stamp(page, editor, isMobile);
			await expectStamped(lineRow(editor, UNTIMED_WORDS[index]), held[index]);
		}
		await expectNothingWritten(player);

		await saveButton(editor).click();
		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player).length, 1);

		const written = String(lyricWrites(player)[0]?.[LYRIC_FIELD]).split("\n");
		const stamped = written.map((line) => {
			const read = /^\[(\d\d):(\d\d)\.(\d\d)\](.*)$/.exec(line);
			return read
				? {
						at: Number(read[1]) * 60 + Number(`${read[2]}.${read[3]}`),
						words: read[4],
					}
				: { at: null, words: line };
		});
		expect(stamped.map((line) => line.words)).toEqual(UNTIMED_WORDS);
		for (const [index, at] of held.entries())
			expect(Math.abs((stamped[index].at ?? -1) - at)).toBeLessThanOrEqual(
				STAMP_TOLERANCE,
			);
	});

	test("the playhead sits between the lines the audible position falls between, and moves with it both ways", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		await holdTheClockAt(editor, player, 25);
		await expectPlayheadBetween(editor, "Second line", BREAK);

		await holdTheClockAt(editor, player, 45);
		await expectPlayheadBetween(editor, BREAK, "Fourth line");

		await holdTheClockAt(editor, player, 25);
		await expectPlayheadBetween(editor, "Second line", BREAK);
		await expect(playhead(editor)).toHaveCount(1);
		await expectNothingWritten(player);
	});

	test("a timed line offers to play from two seconds before it, held at zero, and the press sends one seek to that time", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		await selectLine(editor, "Second line");
		await playFrom(editor, "0:18.00").click();
		await expectSettlesAt(player, () => seeksSent(player), [{ seconds: 18 }]);

		await selectLine(editor, "First line");
		await step(await stepperFor(editor, isMobile, "This line"), "−1 s", 9);
		await playFrom(editor, "0:00.00").click();
		await expectSettlesAt(player, () => seeksSent(player), [
			{ seconds: 18 },
			{ seconds: 0 },
		]);

		await expect(anyPlayFrom(editor)).toHaveCount(1);
		await expectNothingWritten(player);
	});

	test("the editor's own transport seeks five seconds either way and plays and pauses", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await holdTheClockAt(editor, player, 40);
		const before = playbackCommands(player).length;
		const sent = () => playbackCommands(player).slice(before);

		await seekBackButton(editor).click();
		await expectSettlesAt(player, sent, ["/api/playback/seek"]);
		expect(positionAtThePlayer(player)).toBe(35);

		await seekForwardButton(editor).click();
		await seekForwardButton(editor).click();
		await expectSettlesAt(player, sent, [
			"/api/playback/seek",
			"/api/playback/seek",
			"/api/playback/seek",
		]);
		expect(positionAtThePlayer(player)).toBe(45);

		await expect(playPauseButton(editor)).toHaveAccessibleName("Play");
		await playPauseButton(editor).click();
		await expect(playPauseButton(editor)).toHaveAccessibleName("Pause");
		await expectSettlesAt(
			player,
			() => sent().at(-1),
			"/api/playback/play-pause",
		);
		expect(sent()).toHaveLength(4);
		expect(player.player.playbackState).toBe("playing");

		await expectLines(editor, HEADED_LINES);
		await expectNothingWritten(player);
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"Space and Enter are keys, and the phone has none",
		);

		test("Space plays and pauses and stamps nothing", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, PART_SYNCED);
			await selectLine(editor, "Second line");
			const before = playbackCommands(player).length;

			await page.keyboard.press("Space");

			await expectSettlesAt(
				player,
				() => playbackCommands(player).slice(before),
				["/api/playback/play-pause"],
			);
			expect(player.player.playbackState).toBe("paused");
			await expectLines(editor, [
				["0:10.00", "First line"],
				[null, "Second line"],
				["0:30.00", "Third line"],
			]);
			await expect(selectedRows(editor)).toHaveText([/Second line/]);
		});

		test("Space on a line leaves a selection of every line as it is", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, PART_SYNCED);
			await selectLine(editor, "Second line");
			await page.keyboard.press("ControlOrMeta+a");
			await expect(selectedRows(editor)).toHaveCount(3);
			const before = playbackCommands(player).length;

			await page.keyboard.press("Space");

			await expectSettlesAt(
				player,
				() => playbackCommands(player).slice(before),
				["/api/playback/play-pause"],
			);
			await expect(selectedRows(editor)).toHaveCount(3);
		});

		test("Space on one of the editor's buttons presses it and does not play", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, PART_SYNCED);
			await selectLine(editor, "Second line");
			const held = await holdTheClockAt(editor, player, 20);
			const before = playbackCommands(player).length;

			await stampButton(editor).focus();
			await page.keyboard.press("Space");

			await expectStamped(lineRow(editor, "Second line"), held);
			await expectSettlesAt(
				player,
				() => playbackCommands(player).slice(before),
				[],
			);
		});

		test("the Stamp button stamps as Enter does", async ({ page, player }) => {
			const editor = await openEditor(page, false, PART_SYNCED);
			await selectLine(editor, "Second line");
			const held = await holdTheClockAt(editor, player, 20);

			await stampButton(editor).click();

			await expectStamped(lineRow(editor, "Second line"), held);
			await expect(selectedRows(editor)).toHaveText([/Third line/]);
			await expectNothingWritten(player);
		});
	});

	test.describe("with playback control off at the player", () => {
		test.use({ fooJean: { ...SAVING_POSSIBLE, canControlPlayback: false } });

		test("stamping still works, no line offers to play from it, and nothing in the editor sends a playback command", async ({
			page,
			player,
			isMobile,
		}) => {
			const editor = await openEditorOnWhatThePlayerPlays(
				page,
				player,
				isMobile,
				WITH_HEADERS,
			);
			await selectLine(editor, "Second line");
			const held = await holdTheClockAt(editor, player, 25);
			await expectPlayheadBetween(editor, "Second line", BREAK);

			await stamp(page, editor, isMobile);
			await expectStamped(lineRow(editor, "Second line"), held);
			await expect(selectedRows(editor)).toHaveText([new RegExp(BREAK)]);

			const transport = [
				seekBackButton(editor),
				playPauseButton(editor),
				seekForwardButton(editor),
			];
			for (const control of transport) await expectDisabledWithReason(control);
			// A control that is only `aria-disabled` still receives the click.
			for (const control of transport) await control.click({ force: true });
			if (!isMobile) await page.keyboard.press("Space");

			await selectLine(editor, "Fourth line");
			await expectNothingRefusedSent(player);
			expect(await anyPlayFrom(editor).count()).toBe(0);
			await expectNothingWritten(player);
		});
	});
});

const textField = (editor: Locator) => editor.getByRole("textbox");

const editWordsOf = async (
	page: Page,
	editor: Locator,
	isMobile: boolean,
	text: string,
) => {
	if (isMobile) {
		await lineRow(editor, text).getByText(text, { exact: true }).dblclick();
	} else {
		await selectLine(editor, text);
		await page.keyboard.press("F2");
	}
	await expect(textField(editor)).toHaveValue(text);
	await expect(textField(editor)).toBeFocused();
	return textField(editor);
};

const viewSwitch = (editor: Locator, view: "Lines" | "Text") =>
	editor.getByRole("button", { name: view, exact: true });

const showView = async (editor: Locator, view: "Lines" | "Text") => {
	await viewSwitch(editor, view).click();
	await expect(viewSwitch(editor, view)).toHaveAttribute(
		"aria-pressed",
		"true",
	);
};

const pasteLyric = async (editor: Locator, text: string) => {
	await showView(editor, "Text");
	await textField(editor).fill(text);
	await showView(editor, "Lines");
};

const lineBelowButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Line below", exact: true });

const removeButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Remove", exact: true });

const undoButton = (editor: Locator) =>
	editor.getByRole("button", { name: "Undo", exact: true });

const changeCount = (editor: Locator, count = "[1-9]\\d*") =>
	editor.getByText(new RegExp(`^\\s*${count} changes?\\s*$`));

const expectChanges = (editor: Locator, count: number) =>
	expect(changeCount(editor, String(count))).toBeVisible();

const HEADED_TEXT = [
	`[ti:${TITLE}]`,
	`[ar:${ARTIST}]`,
	"[00:10.00]First line",
	"[00:20.00]Second line",
	"[00:31.00]",
	"[01:02.10]Fourth line",
].join("\n");

test.describe("changing words and lines", () => {
	test.use(EDITABLE);

	test("Remove stays red under the pointer", async ({ page, isMobile }) => {
		test.skip(isMobile, "nothing hovers on a phone");

		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await selectLine(editor, "Second line");
		const danger = await tokenColourIn(editor, "--danger");
		await expect(removeButton(editor)).toHaveCSS("color", danger);

		// Read in one step with whether the pointer is still on it: a colour read after the pointer
		// has left is the resting red, which the button had all along.
		await expect
			.poll(async () => {
				await removeButton(editor).hover();
				return removeButton(editor).evaluate((button) =>
					button.matches(":hover")
						? getComputedStyle(button).color
						: "not under the pointer",
				);
			})
			.toBe(danger);
	});

	test("a line's words are changed in a text field, kept by Enter and by leaving the field", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		const first = await editWordsOf(page, editor, isMobile, "Second line");
		await first.fill("Second line, mended");
		await first.press("Enter");
		await expect(textField(editor)).toHaveCount(0);
		await expectLines(editor, [
			["0:10.00", "First line"],
			["0:20.00", "Second line, mended"],
			["0:31.00", BREAK],
			["1:02.10", "Fourth line"],
		]);
		await expect(selectedRows(editor)).toHaveText([/Second line, mended/]);

		const second = await editWordsOf(page, editor, isMobile, "Fourth line");
		await second.fill("Fourth line, mended");
		await lineRow(editor, "First line")
			.getByText("First line", { exact: true })
			.click();
		await expect(textField(editor)).toHaveCount(0);
		await expectLines(editor, [
			["0:10.00", "First line"],
			["0:20.00", "Second line, mended"],
			["0:31.00", BREAK],
			["1:02.10", "Fourth line, mended"],
		]);

		await expect(editor).toBeVisible();
		await expectNothingWritten(player);
	});

	test("Line below adds an untimed line under the selected one and selects it, and Remove takes the selected line and selects a neighbour", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);

		await selectLine(editor, "Second line");
		await lineBelowButton(editor).click();
		await expectLines(editor, [
			HEADED_LINES[0],
			HEADED_LINES[1],
			[null, ""],
			HEADED_LINES[2],
			HEADED_LINES[3],
		]);
		await expect(selectedRows(editor)).toHaveCount(1);
		await expect(lineRows(editor).nth(2)).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await removeButton(editor).click();
		await expectLines(editor, HEADED_LINES);
		await expect(selectedRows(editor)).toHaveText([
			new RegExp(`Second line|${BREAK}`),
		]);

		await selectLine(editor, "Fourth line");
		await removeButton(editor).click();
		await expectLines(editor, HEADED_LINES.slice(0, 3));
		await expect(selectedRows(editor)).toHaveText([new RegExp(BREAK)]);

		await expectNothingWritten(player);
	});

	test("Text shows the lyric as the LRC Save would write, and a lyric put there is read back into lines without loss", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await expect(viewSwitch(editor, "Lines")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await showView(editor, "Text");
		await expect(textField(editor)).toHaveValue(HEADED_TEXT);

		await textField(editor).fill(
			[
				"[ti:Pasted]",
				"[offset:500]",
				"[00:12.00][00:40.00]Refrain",
				"Spoken aside",
				"[00:20.00]Verse",
			].join("\n"),
		);
		await showView(editor, "Lines");
		await expectLines(editor, [
			["0:11.50", "Refrain"],
			["0:39.50", "Refrain"],
			[null, "Spoken aside"],
			["0:19.50", "Verse"],
		]);
		await expect(
			editor.getByText("[ti:Pasted]", { exact: true }),
		).toBeVisible();
		await expect(editor.getByText("header", { exact: true })).toHaveCount(1);

		await showView(editor, "Text");
		await expect(textField(editor)).toHaveValue(
			[
				"[ti:Pasted]",
				"[00:11.50]Refrain",
				"[00:39.50]Refrain",
				"Spoken aside",
				"[00:19.50]Verse",
			].join("\n"),
		);

		await textField(editor).fill("[00:30.00]Sung second\n[00:10.00]Sung first");
		await showView(editor, "Lines");
		await expectLines(editor, [
			["0:10.00", "Sung first"],
			["0:30.00", "Sung second"],
		]);
		await expectNothingWritten(player);

		await pasteLyric(editor, "Plain first\n\nPlain last");
		await expectLines(editor, [
			[null, "Plain first"],
			[null, ""],
			[null, "Plain last"],
		]);

		await saveButton(editor).click();
		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: "Plain first\n\nPlain last" },
		]);
	});

	test("Undo walks back one change at a time to the lyric the editor opened on, the count follows, and then Undo and Save are both off", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await expectLines(editor, HEADED_LINES);
		await expect(undoButton(editor)).toBeDisabled();
		await expect(saveButton(editor)).toBeDisabled();
		await expect(changeCount(editor)).toHaveCount(0);

		const shifted: Shown[] = [
			["0:10.00", "First line"],
			["0:21.00", "Second line"],
			["0:31.00", BREAK],
			["1:02.10", "Fourth line"],
		];
		await selectLine(editor, "Second line");
		await step(await stepperFor(editor, isMobile, "This line"), "+1 s");
		await expectLines(editor, shifted);
		await expectChanges(editor, 1);
		await expect(saveButton(editor)).toBeEnabled();

		const held = await holdTheClockAt(editor, player, 45);
		await selectLine(editor, BREAK);
		await stamp(page, editor, isMobile);
		await expectStamped(lineRow(editor, BREAK), held);
		const stampedAt =
			/\d+:\d\d\.\d\d/.exec(
				(await lineRow(editor, BREAK).textContent()) ?? "",
			)?.[0] ?? "";
		const stamped: Shown[] = [
			shifted[0],
			shifted[1],
			[stampedAt, BREAK],
			shifted[3],
		];
		await expectLines(editor, stamped);
		await expectChanges(editor, 2);

		const reworded: Shown[] = [
			...stamped.slice(0, 3),
			["1:02.10", "Fourth line, mended"],
		];
		const field = await editWordsOf(page, editor, isMobile, "Fourth line");
		await field.fill("Fourth line, mended");
		await field.press("Enter");
		await expectLines(editor, reworded);
		await expectChanges(editor, 3);

		const added: Shown[] = [...reworded, [null, ""]];
		await selectLine(editor, "Fourth line, mended");
		await lineBelowButton(editor).click();
		await expectLines(editor, added);
		await expectChanges(editor, 4);

		const removed = added.slice(1);
		await selectLine(editor, "First line");
		await removeButton(editor).click();
		await expectLines(editor, removed);
		await expectChanges(editor, 5);

		await pasteLyric(editor, "Pasted one\nPasted two");
		await expectLines(editor, [
			[null, "Pasted one"],
			[null, "Pasted two"],
		]);
		await expectChanges(editor, 6);

		for (const [changes, lines] of [
			[5, removed],
			[4, added],
			[3, reworded],
			[2, stamped],
			[1, shifted],
		] as const) {
			await undoButton(editor).click();
			await expectLines(editor, [...lines]);
			await expectChanges(editor, changes);
		}

		await undoButton(editor).click();
		await expectLines(editor, HEADED_LINES);
		await expect(undoButton(editor)).toBeDisabled();
		await expect(saveButton(editor)).toBeDisabled();
		await expect(
			editor.getByText(`[ti:${TITLE}]`, { exact: true }),
		).toBeVisible();
		await expect(changeCount(editor)).toHaveCount(0);

		await showView(editor, "Text");
		await expect(textField(editor)).toHaveValue(HEADED_TEXT);
		await expectNothingWritten(player);
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"these are keys, and the phone has none",
		);

		test("a double-click on a line's words opens the field, and Escape there drops the change and leaves the editor open", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);

			await lineRow(editor, "Second line")
				.getByText("Second line", { exact: true })
				.dblclick();
			await expect(textField(editor)).toHaveValue("Second line");
			await expect(textField(editor)).toBeFocused();

			await textField(editor).fill("Something else");
			await page.keyboard.press("Escape");

			await expect(textField(editor)).toHaveCount(0);
			await expectLines(editor, HEADED_LINES);
			await expect(editor).toBeVisible();
			await expect(saveButton(editor)).toBeDisabled();
			await expectNothingWritten(player);
		});

		test("Ctrl or Cmd with Enter adds a line below, with Backspace removes the selected line, and with Z undoes each", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			await selectLine(editor, "Second line");

			await page.keyboard.press("ControlOrMeta+Enter");
			await expect(lineRows(editor)).toHaveCount(5);
			await expect(lineRows(editor).nth(2)).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expectLines(editor, [
				HEADED_LINES[0],
				HEADED_LINES[1],
				[null, ""],
				HEADED_LINES[2],
				HEADED_LINES[3],
			]);

			await selectLine(editor, "First line");
			await page.keyboard.press("ControlOrMeta+Backspace");
			await expectLines(editor, [
				HEADED_LINES[1],
				[null, ""],
				HEADED_LINES[2],
				HEADED_LINES[3],
			]);
			await expectChanges(editor, 2);

			await page.keyboard.press("ControlOrMeta+z");
			await expect(lineRows(editor)).toHaveCount(5);
			await expectChanges(editor, 1);
			await page.keyboard.press("ControlOrMeta+z");
			await expectLines(editor, HEADED_LINES);
			await expect(undoButton(editor)).toBeDisabled();
			await expect(saveButton(editor)).toBeDisabled();

			await page.keyboard.press("ControlOrMeta+z");
			await expectNothingWritten(player);
			await expectLines(editor, HEADED_LINES);
		});

		test("while a line's field has the focus, the arrows, Enter, Space and Ctrl or Cmd with A or Z belong to the text", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			await selectLine(editor, "Second line");
			await step(await stepperFor(editor, false, "This line"), "+1 s");
			await holdTheClockAt(editor, player, 45);
			const before = playbackCommands(player).length;

			const field = await editWordsOf(page, editor, false, "Second line");
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("ArrowUp");
			await expect(field).toHaveValue("Second line");

			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.type("Sung twice");
			await expect(field).toHaveValue("Sung twice");

			await page.keyboard.press("ControlOrMeta+z");
			await field.fill("Second line, mended");
			await page.keyboard.press("Enter");

			await expect(textField(editor)).toHaveCount(0);
			await expectLines(editor, [
				["0:10.00", "First line"],
				["0:21.00", "Second line, mended"],
				["0:31.00", BREAK],
				["1:02.10", "Fourth line"],
			]);
			await expect(selectedRows(editor)).toHaveText([/Second line, mended/]);
			await expectNothingWritten(player);
			expect(playbackCommands(player)).toHaveLength(before);
		});

		test("while the lyric's text has the focus, Enter, Space, the arrows and Ctrl or Cmd with A belong to the text", async ({
			page,
			player,
		}) => {
			const editor = await openEditor(page, false, WITH_HEADERS);
			await showView(editor, "Text");
			const before = playbackCommands(player).length;

			await textField(editor).focus();
			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.type("One two");
			await page.keyboard.press("Enter");
			await page.keyboard.type("Three");
			await page.keyboard.press("ArrowUp");
			await page.keyboard.press("ArrowDown");
			await expect(textField(editor)).toHaveValue("One two\nThree");

			await showView(editor, "Lines");
			await expectLines(editor, [
				[null, "One two"],
				[null, "Three"],
			]);
			await expectNothingWritten(player);
			expect(playbackCommands(player)).toHaveLength(before);
		});
	});
});

const SKIPPED_TO = "Fizz";

const TRACK_CHANGED = `${SKIPPED_TO} is playing now. This draft is still for ${TITLE} and saves to it. Stamping and playing from a line are off, because they follow the song that is playing.`;

const ANOTHER_SONG = "is playing now";

const NO_CLOCK = /(^|[^–])–:––\.–([^–]|$)/;

const skipToTheNextTrack = async (page: Page, player: FakePlayer) => {
	player.next();
	await untilThePageKnowsPlaying(page, SKIPPED_TO);
};

const playTheFirstTrackAgain = async (page: Page, player: FakePlayer) => {
	player.previous();
	await untilThePageKnowsPlaying(page, TITLE);
};

const stampTool = (editor: Locator) =>
	editor.getByRole("button", { name: /^Stamp\b/ });

const clockTools = (editor: Locator) => [
	stampTool(editor),
	anyPlayFrom(editor),
	seekBackButton(editor),
	seekForwardButton(editor),
];

const tagWritesSent = (player: FakePlayer) =>
	requestsTo(player, "/api/tags").filter((one) => one.method === "POST");

test.describe("the track changes under an open editor", () => {
	test.use(EDITABLE);

	const SHIFTED: Shown[] = [
		["0:10.00", "First line"],
		["0:21.00", "Second line"],
		["0:31.00", BREAK],
		["1:02.10", "Fourth line"],
	];

	const openEditorWithOneChange = async (page: Page, isMobile: boolean) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await selectLine(editor, "Second line");
		await step(await stepperFor(editor, isMobile, "This line"), "+1 s");
		await expectLines(editor, SHIFTED);
		await expectChanges(editor, 1);
		return editor;
	};

	test("the editor stays open on its draft, still says which track it saves to, and says which song is playing and what is off", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditorWithOneChange(page, isMobile);
		await expect(editor).not.toContainText(ANOTHER_SONG);

		await skipToTheNextTrack(page, player);

		await expect(editor).toContainText(TRACK_CHANGED);
		await expect(editor).toBeVisible();
		await expectLines(editor, SHIFTED);
		await expectChanges(editor, 1);
		await expect(selectedRows(editor)).toHaveText([/Second line/]);
		await expect(editor).toContainText(
			isMobile ? `Saves to ${TITLE}` : `Saves to ${TITLE} by ${ARTIST}`,
		);
		await expect(saveButton(editor)).toBeEnabled();
		await expectNothingWritten(player);
	});

	test("Stamp, Play from and both seeks are marked off, and neither a press nor a key stamps a line or sends the player anything", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditorWithOneChange(page, isMobile);
		await expect(playFrom(editor, "0:19.00")).toBeVisible();

		await skipToTheNextTrack(page, player);
		await expect(editor).toContainText(TRACK_CHANGED);
		holdAt(player, 40);
		const before = playbackCommands(player).length;

		for (const tool of clockTools(editor)) {
			await expect(tool).toBeVisible();
			await expect(tool).toHaveAttribute("aria-disabled", "true");
			await tool.focus();
			await expect(tool).toBeFocused();
		}
		// A control that is only `aria-disabled` still receives the click.
		for (const tool of clockTools(editor)) await tool.click({ force: true });

		if (!isMobile) {
			await selectLine(editor, "Second line");
			await page.keyboard.press("Enter");
			await page.keyboard.press("Shift+Enter");
			await page.keyboard.press("ArrowLeft");
			await page.keyboard.press("ArrowRight");
		}

		await expectSettlesAt(
			player,
			() => playbackCommands(player).slice(before),
			[],
		);
		await expectLines(editor, SHIFTED);
		await expect(selectedRows(editor)).toHaveText([/Second line/]);
		await expectChanges(editor, 1);
		await expectNothingWritten(player);
	});

	test("the playhead is hidden and the clock reads no time while the other track plays", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditorWithOneChange(page, isMobile);
		await holdTheClockAt(editor, player, 25);
		await expect(playhead(editor)).toHaveCount(1);
		await expect(editor).not.toContainText(NO_CLOCK);

		await skipToTheNextTrack(page, player);
		await expect(editor).toContainText(TRACK_CHANGED);
		holdAt(player, 25);
		await untilQuiet(player);

		await expect(playhead(editor)).toHaveCount(0);
		await expect(editor).toContainText(NO_CLOCK);
		if (!isMobile)
			await expect(editor).toContainText(`${TITLE} is not playing`);
	});

	test("play and pause, shifts, a line's words and undo all still work", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditorWithOneChange(page, isMobile);
		await skipToTheNextTrack(page, player);
		await expect(editor).toContainText(TRACK_CHANGED);
		const before = playbackCommands(player).length;
		const sent = () => playbackCommands(player).slice(before);

		await expect(playPauseButton(editor)).toHaveAccessibleName("Pause");
		await expect(playPauseButton(editor)).not.toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await playPauseButton(editor).click();
		await expect(playPauseButton(editor)).toHaveAccessibleName("Play");
		await expectSettlesAt(player, sent, ["/api/playback/play-pause"]);
		expect(player.player.playbackState).toBe("paused");

		await step(await stepperFor(editor, isMobile, "This line"), "+0.1");
		await step(await stepperFor(editor, isMobile, "All lines"), "+1 s");
		const moved: Shown[] = [
			["0:11.00", "First line"],
			["0:22.10", "Second line"],
			["0:32.00", BREAK],
			["1:03.10", "Fourth line"],
		];
		await expectLines(editor, moved);
		await expectChanges(editor, 3);

		const field = await editWordsOf(page, editor, isMobile, "Second line");
		await field.fill("Second line, mended");
		await field.press("Enter");
		await expectLines(editor, [
			moved[0],
			["0:22.10", "Second line, mended"],
			moved[2],
			moved[3],
		]);
		await expectChanges(editor, 4);

		await undoButton(editor).click();
		await expectLines(editor, moved);
		await expectChanges(editor, 3);

		if (!isMobile) {
			await selectLine(editor, "Second line");
			await page.keyboard.press("Alt+ArrowLeft");
			await expectLines(editor, [
				moved[0],
				["0:22.00", "Second line"],
				moved[2],
				moved[3],
			]);
			await page.keyboard.press("ControlOrMeta+z");
			await expectLines(editor, moved);
			await page.keyboard.press("Space");
			await expect(playPauseButton(editor)).toHaveAccessibleName("Pause");
			await expectSettlesAt(player, sent, [
				"/api/playback/play-pause",
				"/api/playback/play-pause",
			]);
		}

		await expect(editor).toContainText(TRACK_CHANGED);
		await expectNothingWritten(player);
	});

	// A fake that only counted writes would pass a lyric saved into the wrong file.
	test("Save writes once, to the track the editor opened on, and the playing track's lyric is left alone", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await step(await stepperFor(editor, isMobile, "All lines"), "+1 s", 8);
		const saved = [
			`[ti:${TITLE}]`,
			`[ar:${ARTIST}]`,
			"[00:18.00]First line",
			"[00:28.00]Second line",
			"[00:39.00]",
			"[01:10.10]Fourth line",
		].join("\n");

		await skipToTheNextTrack(page, player);
		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: saved },
		]);
		expect(titleAddressedBy(player, tagWritesSent(player)[0]?.body)).toBe(
			TITLE,
		);
		expect(lyricTagOf(player, TITLE)).toBe(saved);
		expect(lyricTagOf(player, SKIPPED_TO)).toBe(PART_TIMED);
		expect(await toasts(page).count()).toBe(0);

		const panel = lyricsPanel(page, isMobile);
		await expect(panel).toContainText("Third line");
		await expect(panel).not.toContainText("Fourth line");

		await playTheFirstTrackAgain(page, player);
		holdAt(player, 23);
		await expect(sungLine(panel)).toHaveText("First line");
	});

	test("when the first track plays again the notice goes, and stamping, playing from a line, seeking and the playhead come back", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditorWithOneChange(page, isMobile);
		await skipToTheNextTrack(page, player);
		await expect(editor).toContainText(TRACK_CHANGED);
		await expect(playhead(editor)).toHaveCount(0);

		await playTheFirstTrackAgain(page, player);

		await expect(editor).not.toContainText(ANOTHER_SONG);
		await expectLines(editor, SHIFTED);
		await expectChanges(editor, 1);
		const held = await holdTheClockAt(editor, player, 25);
		await expectPlayheadBetween(editor, "Second line", BREAK);
		for (const tool of clockTools(editor))
			await expect(tool).not.toHaveAttribute("aria-disabled", "true");

		const before = playbackCommands(player).length;
		await playFrom(editor, "0:19.00").click();
		await expectSettlesAt(player, () => seeksSent(player), [{ seconds: 19 }]);
		await seekForwardButton(editor).click();
		await expectSettlesAt(
			player,
			() => playbackCommands(player).slice(before),
			["/api/playback/seek", "/api/playback/seek"],
		);
		expect(positionAtThePlayer(player)).toBe(24);

		const again = await holdTheClockAt(editor, player, held > 26 ? 27 : 26);
		await selectLine(editor, BREAK);
		await stamp(page, editor, isMobile);
		await expectStamped(lineRow(editor, BREAK), again);
		await expectNothingWritten(player);
	});
});

test.describe("the tag changes under an open draft", () => {
	test.use(EDITABLE);

	const DRAFT_TEXT = "[00:10.00]Draft one\n[00:20.00]Draft two";
	const DRAFT: Shown[] = [
		["0:10.00", "Draft one"],
		["0:20.00", "Draft two"],
	];
	const UNDERNEATH = "[00:05.00]Written underneath";

	// foo_openlyrics can fetch a lyric mid-play, and only a track with none is read again.
	const UNTIL_THE_NEXT_LOOK = 25_000;

	test("a lyric written to the file while the editor is open leaves every row of the draft as it was, and Save writes the draft over it", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, NO_LYRIC.row);
		await pasteLyric(editor, DRAFT_TEXT);
		await expectLines(editor, DRAFT);
		await expectChanges(editor, 1);

		writeLyric(player, UNDERNEATH);
		const panel = lyricsPanel(page, isMobile);
		await expect(panel).toContainText("Written underneath", {
			timeout: UNTIL_THE_NEXT_LOOK,
		});

		await expectLines(editor, DRAFT);
		await expectChanges(editor, 1);
		await expect(editor).not.toContainText("Written underneath");
		await showView(editor, "Text");
		await expect(textField(editor)).toHaveValue(DRAFT_TEXT);
		await expect(discardPrompt(page)).toHaveCount(0);
		await expectNothingWritten(player);

		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: DRAFT_TEXT },
		]);
		expect(lyricTagOf(player, NO_LYRIC.title)).toBe(DRAFT_TEXT);
		await expect(panel).toContainText("Draft two");
		await expect(panel).not.toContainText("Written underneath");
	});
});

const CHANGED: Shown[] = [
	["0:10.00", "First line"],
	["0:22.00", "Second line"],
	["0:31.00", BREAK],
	["1:02.10", "Fourth line"],
];

const UNSAVED = `The lyrics for ${TITLE} have 2 changes that are not saved. Discarding leaves the file as it is.`;

const openChangedEditor = async (page: Page, isMobile: boolean) => {
	const editor = await openEditor(page, isMobile, WITH_HEADERS);
	await selectLine(editor, "Second line");
	await step(await stepperFor(editor, isMobile, "This line"), "+1 s", 2);
	await expectLines(editor, CHANGED);
	await expectChanges(editor, 2);
	return editor;
};

type Closing = (page: Page, editor: Locator) => Promise<unknown>;

const byTheCloseControl: Closing = (_page, editor) =>
	closeButton(editor).click();

const byEscape: Closing = (page) => page.keyboard.press("Escape");

const byTheBrowsersBack: Closing = (page) => page.goBack();

const box = async (of: Locator) => {
	const found = await of.boundingBox();
	if (!found) throw new Error("nothing is drawn to measure");
	return found;
};

test.describe("closing the editor with changes not saved", () => {
	test.use(EDITABLE);

	// Asked, kept, asked again, discarded: a guard that asks once loses the draft on the second press.
	const asksThenKeepsThenDiscards = async (
		page: Page,
		player: FakePlayer,
		isMobile: boolean,
		close: Closing,
	) => {
		const editor = await openChangedEditor(page, isMobile);

		await close(page, editor);
		const prompt = await expectDiscardPrompt(page, UNSAVED);
		await expect(editor).toBeVisible();

		await keepEditingButton(prompt).click();
		await expect(prompt).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);
		await expect(editor).toBeVisible();
		await expectLines(editor, CHANGED);
		await expectChanges(editor, 2);
		await expect(selectedRows(editor)).toHaveText([/Second line/]);
		await expect(saveButton(editor)).toBeEnabled();

		await close(page, editor);
		await expectDiscardPrompt(page, UNSAVED);
		await discardButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expect(editor).toHaveCount(0);
		await expectNothingWritten(player);
		expect(lyricTagOf(player, TITLE)).toBe(HEADED);
	};

	const expectTheFilesLyricAgain = async (page: Page, isMobile: boolean) => {
		await expectTheScreenIsStillOpen(page);
		const panel = lyricsPanel(page, isMobile);
		await expect(panel.getByText("Fourth line")).toBeVisible();
		await editButton(panel).click();
		const reopened = editorOf(page);
		await expectLines(reopened, HEADED_LINES);
		await expect(saveButton(reopened)).toBeDisabled();
		await expect(changeCount(reopened)).toHaveCount(0);
	};

	test("the close control asks first: Keep editing returns to the draft as it was, and Discard closes the editor with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		await asksThenKeepsThenDiscards(page, player, isMobile, byTheCloseControl);
		await expectTheFilesLyricAgain(page, isMobile);

		expect(await promptsEverShown(page)).toHaveLength(2);
	});

	test("the browser's Back asks first: Keep editing stays on the screen with the draft as it was, and Discard closes the editor with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		await asksThenKeepsThenDiscards(page, player, isMobile, byTheBrowsersBack);
	});

	test("words typed under Text and not yet read back into lines are a change too, and the close control asks about them", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await showView(editor, "Text");
		await textField(editor).fill(`${HEADED_TEXT}\n[01:20.00]Typed last`);
		await expect(saveButton(editor)).toBeEnabled();

		await closeButton(editor).click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expect(textField(editor)).toHaveValue(
			`${HEADED_TEXT}\n[01:20.00]Typed last`,
		);

		await closeButton(editor).click();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();
		await expect(editor).toHaveCount(0);
		await expectNothingWritten(player);
	});

	test("the prompt is small and centred over the editor, with Discard before Keep editing on the desktop and Keep editing on top on the phone", async ({
		page,
		isMobile,
	}) => {
		const editor = await openChangedEditor(page, isMobile);
		await closeButton(editor).click();
		const prompt = await expectDiscardPrompt(page, UNSAVED);

		const viewport = page.viewportSize();
		if (!viewport) throw new Error("the page has no viewport");
		const alert = await box(prompt);
		const keep = await box(keepEditingButton(prompt));
		const discard = await box(discardButton(prompt));

		expect(alert.x).toBeGreaterThan(0);
		expect(alert.y).toBeGreaterThan(0);
		expect(alert.x + alert.width).toBeLessThan(viewport.width);
		expect(alert.y + alert.height).toBeLessThan(viewport.height);
		expect(alert.height).toBeLessThan(viewport.height / 2);

		const CENTRED_WITHIN = { across: 4, down: viewport.height / 10 };
		expect(
			Math.abs(alert.x + alert.width / 2 - viewport.width / 2),
		).toBeLessThanOrEqual(CENTRED_WITHIN.across);
		expect(
			Math.abs(alert.y + alert.height / 2 - viewport.height / 2),
		).toBeLessThanOrEqual(CENTRED_WITHIN.down);

		if (isMobile) {
			const TOUCH_TARGET = 44;
			expect(keep.y + keep.height).toBeLessThanOrEqual(discard.y);
			expect(Math.abs(keep.x - discard.x)).toBeLessThanOrEqual(1);
			expect(keep.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
			expect(discard.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
		} else {
			expect(discard.x + discard.width).toBeLessThanOrEqual(keep.x);
			expect(
				Math.abs(discard.y + discard.height / 2 - (keep.y + keep.height / 2)),
			).toBeLessThanOrEqual(2);
		}

		await expect(editor).toBeVisible();
		const layer = await box(editor);
		expect(alert.width).toBeLessThan(layer.width);
	});

	test("an editor whose changes were all undone closes without asking", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const editor = await openChangedEditor(page, isMobile);
		await undoButton(editor).click();
		await undoButton(editor).click();
		await expectLines(editor, HEADED_LINES);
		await expect(saveButton(editor)).toBeDisabled();

		await closeButton(editor).click();

		await expect(editor).toHaveCount(0);
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toEqual([]);
		await expectNothingWritten(player);
	});

	test("the browser's Back closes an editor nothing was changed in without asking", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await expectLines(editor, HEADED_LINES);

		await page.goBack();

		await expect(editor).toHaveCount(0);
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toEqual([]);
		await expectNothingWritten(player);
	});

	test("after a Save that landed, nothing asks", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const editor = await openChangedEditor(page, isMobile);

		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player).length, 1);
		expect(await promptsEverShown(page)).toEqual([]);
		await expectTheScreenIsStillOpen(page);
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"Escape, Enter and Tab are keys, and the phone has none",
		);

		test("Escape asks first: Keep editing returns to the draft as it was, and Discard closes the editor with nothing written", async ({
			page,
			player,
		}) => {
			await asksThenKeepsThenDiscards(page, player, false, byEscape);
			await expectTheFilesLyricAgain(page, false);
		});

		test("while the prompt is up the keys are the prompt's: Escape and Enter each keep editing, and no key reaches the draft, the song or the screen under them", async ({
			page,
			player,
		}) => {
			const editor = await openChangedEditor(page, false);
			const before = playbackCommands(player).length;

			await page.keyboard.press("Escape");
			const prompt = await expectDiscardPrompt(page, UNSAVED);

			await page.keyboard.press("ControlOrMeta+z");
			await page.keyboard.press("Alt+ArrowRight");
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("ArrowLeft");
			await expect(prompt).toBeVisible();

			await page.keyboard.press("Escape");
			await expect(prompt).toHaveCount(0);
			await expect(editor).toBeVisible();
			await expectTheScreenIsStillOpen(page);
			await expectLines(editor, CHANGED);
			await expectChanges(editor, 2);
			await expect(selectedRows(editor)).toHaveText([/Second line/]);

			await page.keyboard.press("Alt+ArrowRight");
			await expectLines(editor, [
				CHANGED[0],
				["0:22.10", "Second line"],
				CHANGED[2],
				CHANGED[3],
			]);
			await page.keyboard.press("Alt+ArrowLeft");
			await expectLines(editor, CHANGED);

			await page.keyboard.press("Escape");
			await expect(keepEditingButton(prompt)).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(prompt).toHaveCount(0);
			await expect(editor).toBeVisible();
			await expectLines(editor, CHANGED);
			await expect(selectedRows(editor)).toHaveText([/Second line/]);

			await expectSettlesAt(
				player,
				() => playbackCommands(player).slice(before),
				[],
			);
			await expectNothingWritten(player);
		});

		test("Tab and Shift+Tab move between Discard and Keep editing and never leave the prompt", async ({
			page,
		}) => {
			const editor = await openChangedEditor(page, false);
			await closeButton(editor).click();
			const prompt = await expectDiscardPrompt(page, UNSAVED);
			const keep = keepEditingButton(prompt);
			const discard = discardButton(prompt);

			await page.keyboard.press("Tab");
			await expect(discard).toBeFocused();
			await page.keyboard.press("Tab");
			await expect(keep).toBeFocused();
			await page.keyboard.press("Shift+Tab");
			await expect(discard).toBeFocused();
			await page.keyboard.press("Shift+Tab");
			await expect(keep).toBeFocused();

			await expect(prompt).toBeVisible();
			await expectLines(editor, CHANGED);
		});
	});
});

test.describe("a plain lyric with section rows in brackets", () => {
	// Section marks written into plain lyrics are not LRC tags, and with no timed line there is
	// no LRC for one to head.
	const SECTIONED = [
		"[Verse: Adrián]",
		"First line",
		"Second line",
		"[Chorus: Diego]",
		"Third line",
		"Drop me",
	];

	test.use({
		retagged: {
			[TITLE]: { [`$meta(${LYRIC_FIELD})`]: SECTIONED.join("\r\n") },
		},
		fooJean: SAVING_POSSIBLE,
	});

	// A row read as a header is left out of a plain Save, so editing another line took both
	// section marks out of the file.
	test("the bracketed rows are lines of the lyric, and removing another line and saving writes them back", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openEditor(page, isMobile, WITH_HEADERS);
		await expectLines(
			editor,
			SECTIONED.map((words) => [null, words] as const),
		);
		await expect(editor.getByText("header", { exact: true })).toHaveCount(0);

		await selectLine(editor, "Drop me");
		await removeButton(editor).click();
		await expectLines(
			editor,
			SECTIONED.slice(0, -1).map((words) => [null, words] as const),
		);
		await saveButton(editor).click();

		await expect(editor).toHaveCount(0);
		await expectSettlesAt(player, () => lyricWrites(player), [
			{ [LYRIC_FIELD]: SECTIONED.slice(0, -1).join("\n") },
		]);
	});
});

test.describe("a Save the player refuses, from the editor", () => {
	for (const [status, said] of [
		[500, `The lyric was not saved to ${TITLE}`],
		[403, "does not allow lyrics to be written"],
	] as const)
		test.describe(`where the player answers the write ${status}`, () => {
			test.use({
				...EDITABLE,
				fooJean: { ...SAVING_POSSIBLE, failWrites: status },
			});

			test("a toast says the lyric was not saved, and the editor stays open with the draft, its count and Save", async ({
				page,
				player,
				isMobile,
			}) => {
				const editor = await openChangedEditor(page, isMobile);

				await saveButton(editor).click();

				await expect(toastRegion(page).getByText(said)).toBeVisible();
				await untilQuiet(player);
				await expect(editor).toBeVisible();
				await expectLines(editor, CHANGED);
				await expectChanges(editor, 2);
				await expect(selectedRows(editor)).toHaveText([/Second line/]);
				await expect(saveButton(editor)).toBeVisible();
				await expect(discardPrompt(page)).toHaveCount(0);
				expect(lyricTagOf(player, TITLE)).toBe(HEADED);
			});
		});
});

test.describe("leaving while a Save is on its way", () => {
	test.use(EDITABLE);

	const WRITE_TAKES_MS = 1500;

	// Back moves the address while the editor is asked about a draft. The route it held must be
	// released on close, or Back cannot close the screen left over.
	test("after Back during the write, the screen drawn and the address agree once the write has landed", async ({
		page,
		player,
		isMobile,
	}) => {
		const editor = await openChangedEditor(page, isMobile);
		player.latency = WRITE_TAKES_MS;

		await saveButton(editor).click();
		await page.goBack();

		await expectSettlesAt(player, () => lyricWrites(player).length, 1);
		player.latency = 0;
		await expect(editor).toHaveCount(0);
		await expect(discardPrompt(page)).toHaveCount(0);

		const agreement = async () => {
			const onTheRoute = /#\/playing(\/|$)/.test(page.url());
			const isDrawn = await nowPlayingScreen(page).isVisible();
			return onTheRoute === isDrawn
				? "agree"
				: `the address is ${new URL(page.url()).hash} and the screen is ${isDrawn ? "drawn" : "not drawn"}`;
		};
		await expect.poll(agreement).toBe("agree");
		await untilQuiet(player);
		expect(await agreement()).toBe("agree");
	});
});

test.describe("the editor holds the keyboard's focus", () => {
	test.use(EDITABLE);
	test.skip(({ isMobile }) => isMobile, "Tab is a key, and the phone has none");

	const LONGEST_WALK = 80;

	const stopAfter = (page: Page, key: string) =>
		page.keyboard.press(key).then(() =>
			page.evaluate(() => {
				const held = window as unknown as {
					stop?: Element | null;
					stopBefore?: Element | null;
				};
				const at = document.activeElement;
				held.stopBefore = held.stop;
				held.stop = at;
				return {
					isInside: Boolean(at?.closest('[role="dialog"]')),
					name: (
						at?.getAttribute("aria-label") ??
						at?.textContent ??
						at?.tagName ??
						""
					)
						.trim()
						.slice(0, 40),
				};
			}),
		);

	test("Tab from the first control comes back round to it without leaving the editor, and Shift+Tab from it lands on the last", async ({
		page,
	}) => {
		const editor = await openEditor(page, false, WITH_HEADERS);
		const first = closeButton(editor);
		await first.focus();
		await expect(first).toBeFocused();

		const outside: string[] = [];
		let presses = 0;
		let hasWrapped = false;
		while (presses < LONGEST_WALK && !hasWrapped) {
			const stop = await stopAfter(page, "Tab");
			presses += 1;
			if (!stop.isInside) outside.push(stop.name);
			hasWrapped = await first.evaluate((el) => el === document.activeElement);
		}

		expect(outside, "stops outside the editor").toEqual([]);
		expect(hasWrapped, `no wrap within ${LONGEST_WALK} presses`).toBe(true);
		expect(presses).toBeGreaterThan(3);
		await page.evaluate(() => {
			const held = window as unknown as {
				stopBefore?: Element | null;
				last?: Element | null;
			};
			held.last = held.stopBefore;
		});

		await page.keyboard.press("Shift+Tab");

		expect(
			await page.evaluate(() => {
				const { last } = window as unknown as { last?: Element | null };
				return last instanceof Element && last === document.activeElement;
			}),
			"Shift+Tab from the first control lands on the last one Tab reached",
		).toBe(true);
		await expect(editor).toBeVisible();
	});
});

test.describe("touch targets in the editor", () => {
	test.use(EDITABLE);
	test.skip(
		({ isMobile }) => !isMobile,
		"a touch target is the phone's, and the desktop's controls are sized for a pointer",
	);

	test("every control of the editor is at least as tall as the queue's controls", async ({
		page,
	}) => {
		const editor = await openEditor(page, true, WITH_HEADERS);
		await selectLine(editor, "Second line");
		const stepper = await stepperFor(editor, true, "This line");
		await step(stepper, "+1 s");
		await expect(undoButton(editor)).toBeEnabled();

		const button = (name: string | RegExp) =>
			editor.getByRole("button", { name, exact: true });

		await expectTouchTargets([
			["Close", closeButton(editor)],
			["Undo", undoButton(editor)],
			["Save", saveButton(editor)],
			["Lines", viewSwitch(editor, "Lines")],
			["Text", viewSwitch(editor, "Text")],
			["This line", button("This line")],
			["All lines", button("All lines")],
			...(["−1 s", "−0.1", "+0.1", "+1 s"] as const).map(
				(by) =>
					[by, stepper.getByRole("button", { name: by, exact: true })] as const,
			),
			["Seek back", seekBackButton(editor)],
			["Play or pause", playPauseButton(editor)],
			["Seek forward", seekForwardButton(editor)],
			["Stamp", stampButton(editor)],
			["Play from", anyPlayFrom(editor)],
			["Line below", lineBelowButton(editor)],
			["Remove", removeButton(editor)],
		]);
	});
});
