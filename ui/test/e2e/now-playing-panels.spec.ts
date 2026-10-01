import { KEYMAP } from "../../src/shared/keyboard/keymap.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	requestsTo,
	test,
	touchDrag,
	trackRow,
} from "./fixtures.ts";
import {
	expectPanelOpen,
	openPanels,
	panelTab,
	playRow,
	TAGGED,
	trackInfo,
} from "./nowPlaying.ts";

test.describe("which panel opens", () => {
	test.use(TAGGED);

	test("the gatefold stays on Lyrics through a track with none", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a phone opens these by pressing Lyrics, which is the answer already",
		);

		await playRow(page, 3);
		const panel = nowPlayingScreen(page);
		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).toContainText("No lyrics found");

		await playRow(page, 0);
		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).not.toContainText("No lyrics found");
	});

	test("the gatefold stays on Lyrics when the player moves on to a track with none", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone opens its panels from the Lyrics button");

		await playRow(page, 2);
		const panel = nowPlayingScreen(page);
		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).toContainText("Marcus Fuereder");

		player.next();
		await expect(panel).toContainText("No lyrics found");
		await expectPanelOpen(panel, "Lyrics");
	});
});

test.describe("a panel chosen by hand", () => {
	test.use({
		retagged: {
			...TAGGED.retagged,
			Fizz: { ...TAGGED.retagged.Fizz, "%publisher%": "Discos Dos" },
		},
	});

	test.skip(
		({ isMobile }) => isMobile,
		"a phone opens its panels from the Lyrics button, and a track change picks none",
	);

	test("stays open when the next track has lyrics", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);
		await expectPanelOpen(panel, "Lyrics");

		await panelTab(panel, "Details").click();
		await expectPanelOpen(panel, "Details");

		player.next();
		await expect(panel).toContainText("Discos Dos");
		await expectPanelOpen(panel, "Details");
	});
});

test.describe("opening a panel from the keyboard", () => {
	test.use(TAGGED);

	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("each tab answers to its own initial", async ({ page }) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);

		await page.keyboard.press("d");
		await expectPanelOpen(panel, "Details");

		await page.keyboard.press("a");
		await expectPanelOpen(panel, "Artist");

		await page.keyboard.press("l");
		await expectPanelOpen(panel, "Lyrics");
	});

	test("and the strip underlines the letter it answers to", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = nowPlayingScreen(page);

		// Read off the keymap rather than spelled out here: the hint and the
		// binding are one fact, and a letter that moved in only one of them is
		// exactly what this is for.
		for (const [id, label] of [
			["showLyrics", "Lyrics"],
			["showDetails", "Details"],
			["showArtist", "Artist"],
		]) {
			const binding = KEYMAP.find((entry) => entry.id === id);
			await expect(panelTab(panel, label).locator("span").first()).toHaveText(
				String(binding?.keys[0]),
			);
		}
	});
});

test.describe("the details panel", () => {
	test.use({
		retagged: { "Los Calientes": { "%publisher%": "Discos Manzana" } },
	});

	test("lists what this file has and drops what it does not", async ({
		page,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, isMobile);
		await panelTab(panel, "Details").click();

		await expect(panel).toContainText("Publisher");
		await expect(panel).toContainText("Discos Manzana");

		await expect(panel).not.toContainText("BPM");
		await expect(panel).not.toContainText("ReplayGain");
	});
});

test.describe("the panels a phone opens", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold keeps its tabs in a leaf beside the artwork",
	);

	test("the player carries no tabs at all", async ({ page }) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		await expect(
			screen.getByRole("navigation", { name: "Track views" }),
		).toHaveCount(0);
		await expect(screen.getByRole("button", { name: "Details" })).toHaveCount(
			0,
		);
		await expect(screen.getByRole("button", { name: "Artist" })).toHaveCount(0);
	});

	test("the Lyrics button opens them and the chevron closes them", async ({
		page,
	}) => {
		await playRow(page, 0);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Lyrics" })
			.click();

		const panel = trackInfo(page);
		await expect(panel).toBeVisible();
		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).toContainText("Dancing in the dark");

		await panel
			.getByRole("button", { name: "Close track information" })
			.click();
		await expect(panel).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("it opens on Lyrics even when the file has none", async ({ page }) => {
		// The button names the tab it opens, and the empty state is where finding
		// a lyric will go. Falling through to Details is the gatefold's rule,
		// where the strip is the only way in.
		await playRow(page, 3);
		const panel = await openPanels(page, true);

		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).toContainText("No lyrics found");
	});

	test("Escape closes them and leaves the screen up", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("a sideways flick inside them steps the tabs", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.boundingBox())!;
		const y = box.y + box.height * 0.6;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.8, y },
			{ x: box.x + box.width * 0.2, y },
		);

		await expectPanelOpen(panel, "Details");
	});

	test("a flick up closes them too", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.6 },
			{ x, y: box.y + box.height * 0.6 - 120 },
		);

		await expect(panel).toBeHidden();
	});

	test("but not while there is more lyric under it", async ({ page }) => {
		// Up is how you read on. It only means "done with this" once there is
		// nothing left below, which is the mirror of what down already does.
		await playRow(page, 4);
		const panel = await openPanels(page, true);

		const body = panel.locator('[data-tab="lyrics"]');
		await expect
			.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight + 1))
			.toBe(true);

		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		const flickUp = () =>
			touchDrag(
				page,
				{ x, y: box.y + box.height * 0.6 },
				{ x, y: box.y + box.height * 0.6 - 120 },
			);

		await flickUp();
		await expect(panel).toBeVisible();

		await body.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await flickUp();
		await expect(panel).toBeHidden();
	});

	// The attribute lives only as long as the exit, so it is watched for rather
	// than polled: a poll that lost the race would report a bug that is not there.
	const leavesTowards = async (page: Page, act: () => Promise<void>) => {
		await page.evaluate(() => {
			const layer = document.querySelector('[aria-label="Track information"]');
			if (!layer) return;
			(window as unknown as { leftTowards: string | null }).leftTowards = null;
			new MutationObserver(() => {
				const towards = layer.getAttribute("data-leaving");
				if (towards)
					(window as unknown as { leftTowards: string | null }).leftTowards =
						towards;
			}).observe(layer, {
				attributes: true,
				attributeFilter: ["data-leaving"],
			});
		});
		await act();
		await expect(trackInfo(page)).toBeHidden();
		return page.evaluate(
			() => (window as unknown as { leftTowards: string | null }).leftTowards,
		);
	};

	test("they leave the way they were sent", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const box = (await panel.boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height * 0.6;

		expect(
			await leavesTowards(page, () =>
				touchDrag(page, { x, y }, { x, y: y - 120 }),
			),
		).toBe("up");

		await openPanels(page, true);
		expect(
			await leavesTowards(page, () =>
				touchDrag(page, { x, y }, { x, y: y + 120 }),
			),
		).toBe("down");

		// A chevron names no direction, so it gets the one it came in by.
		await openPanels(page, true);
		expect(
			await leavesTowards(page, () =>
				trackInfo(page)
					.getByRole("button", { name: "Close track information" })
					.click(),
			),
		).toBe("down");
	});

	test("the first panel arrives with the layer rather than from the side", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');

		// Zero is "no sideways entrance": the layer is already sliding up, and a
		// second animation across it is what reads as arriving crooked.
		await expect(body).toHaveAttribute("data-direction", "0");

		const box = (await panel.boundingBox())!;
		const y = box.y + box.height * 0.6;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.8, y },
			{ x: box.x + box.width * 0.2, y },
		);
		await expect(panel.locator('[data-tab="details"]')).toHaveAttribute(
			"data-direction",
			"1",
		);
	});

	test("the panel reaches the edges, so its scrollbar is the screen's", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');

		const box = (await body.boundingBox())!;
		const view = page.viewportSize()!;
		expect(box.x).toBe(0);
		expect(box.x + box.width).toBe(view.width);

		const line = (await body.getByText("Dancing in the dark").boundingBox())!;
		expect(line.x).toBeGreaterThanOrEqual(20);
	});

	test("the resume pill hovers over the lyric rather than riding it", async ({
		page,
	}) => {
		await playRow(page, 5);
		const panel = await openPanels(page, true);
		const body = panel.locator('[data-tab="lyrics"]');
		const pill = panel.getByRole("button", { name: "Resume following" });

		// Any manual scroll gives the follow up, which is what puts the pill on
		// screen in the first place.
		await body.evaluate((el) => {
			el.scrollTop = 200;
		});
		await expect(pill).toBeVisible();
		const first = (await pill.boundingBox())!;

		await body.evaluate((el) => {
			el.scrollTop = 900;
		});
		const second = (await pill.boundingBox())!;

		// The scroller is the panel, so a pill positioned against *it* is part of
		// what scrolls and leaves with the verse it was over.
		expect(second.y, "the pill scrolled with the lyric").toBe(first.y);
		const view = page.viewportSize()!;
		expect(view.height - (second.y + second.height)).toBeLessThan(40);
	});

	test("a flick down the header closes them", async ({ page }) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);

		const box = (await panel.locator("header").boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height / 2 },
			{ x, y: box.y + box.height / 2 + 120 },
		);

		await expect(panel).toBeHidden();
	});
});

test.describe("the identity on a phone", () => {
	test.use(TAGGED);

	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold's identity is a column of its own and takes space from nothing",
	);

	test("the player is the caption to the picture, stars and all", async ({
		page,
	}) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		await expect(screen).toContainText("Los Calientes");
		await expect(screen).toContainText("Babasónicos");
		await expect(screen).toContainText("Jessico");
		// Either control: which one is drawn is whether this install may write a
		// rating, and `rating-writes.spec.ts` is where that is settled.
		await expect(
			screen
				.getByRole("img", { name: /stars|Unrated/ })
				.or(screen.getByRole("group", { name: /stars|Unrated/ })),
		).toBeVisible();
	});

	test("the layer over it keeps the title and the artist and drops the rest", async ({
		page,
	}) => {
		await playRow(page, 0);
		const panel = await openPanels(page, true);
		const head = panel.locator("header");

		await expect(head).toContainText("Los Calientes");
		await expect(head).toContainText("Babasónicos");
		// The album is a row in Details, two tabs away; rating is a deliberate act
		// with the screen underneath and the ⋯ menu both offering it.
		await expect(head).not.toContainText("Jessico");
		await expect(panel.getByRole("img", { name: /stars|Unrated/ })).toHaveCount(
			0,
		);
	});
});

// The layer's header title is set `nowrap`, so a long one is as wide as its
// content whatever the window is. 480 sits between the phone at 412 and the
// gatefold at 861 -- the only width where the layer and a shrinking window are
// on screen together, and neither project otherwise runs there.
test.describe("a title wider than the screen", () => {
	test.use({
		viewport: { width: 480, height: 900 },
		retagged: {
			"Los Calientes": {
				"%title%":
					"Good to Know That If I Ever Need Attention All I Have to Do Is Die",
			},
		},
	});

	test("is truncated, and takes nothing else off the screen with it", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);
		// 480px is below the JS breakpoint, so this is the compact layer at both
		// projects' settings.
		const panel = await openPanels(page, true);
		await panelTab(panel, "Details").click();

		const title = panel.locator("header p").first();

		// The title really is longer than its box, so what follows is a claim about
		// a truncation that happened rather than about a short string.
		await expect
			.poll(() =>
				title.evaluate(
					(element: HTMLElement) => element.scrollWidth - element.clientWidth,
				),
			)
			.toBeGreaterThan(0);

		const box = await panel.boundingBox();
		const edge = (box?.x ?? 0) + (box?.width ?? 0);
		for (const inside of [title, panelTab(panel, "Details")]) {
			const at = await inside.boundingBox();
			expect(
				(at?.x ?? 0) + (at?.width ?? 0),
				`${await inside.textContent()} runs past the right edge`,
			).toBeLessThanOrEqual(edge + 1);
		}
	});
});

const PUBLISHED = {
	retagged: {
		"Los Calientes": { "%publisher%": "Discos Uno" },
		Fizz: { "%publisher%": "Discos Dos" },
		Deléctrico: { "%publisher%": "Discos Tres" },
	},
};

const READING = "Reading the tags…";
const READING_LYRIC = "Reading the tag…";
const NOTHING_PLAYING = "Nothing playing.";
const NO_LYRIC = "No lyrics found";

const READ_BUDGET_MS = 8_000;

const openDetails = async (page: Page, isMobile: boolean) => {
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Details").click();
	await expectPanelOpen(panel, "Details");
	return panel;
};

const detailRows = (panel: Locator) => panel.getByRole("term");

const playingReads = (player: FakePlayer) =>
	requestsTo(player, "/api/track/playing").filter(
		(entry) => entry.method === "GET",
	);

// The panel is open before the track changes under it, so every read counted
// after this is one the track change caused, and none is a panel mounting over
// a failed query and asking again.
const detailsOpenOnFirstTrack = async (page: Page, isMobile: boolean) => {
	await playRow(page, 0);
	const panel = await openDetails(page, isMobile);
	await expect(panel).toContainText("Discos Uno");
	return panel;
};

const readsFromNow = (player: FakePlayer) => {
	const before = playingReads(player).length;
	return () => playingReads(player).length - before;
};

const stampReadsSent = (page: Page) =>
	page.addInitScript(() => {
		const sent: number[] = [];
		Object.assign(window, { readsSentAt: sent });
		const send = window.fetch.bind(window);
		window.fetch = (input, init) => {
			if (
				(input instanceof Request ? input.url : String(input)).includes(
					"/api/track/playing",
				)
			)
				sent.push(Date.now());
			return send(input, init);
		};
	});

const readsSent = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { readsSentAt: number[] }).readsSentAt,
	);

// See "A fake clock advances honestly only in small steps" in test/README.md.
const ticking =
	<T>(page: Page, read: () => T | Promise<T>) =>
	async () => {
		await page.clock.runFor(10);
		return read();
	};

const outlastBudgetOfRead = async (page: Page, index: number) => {
	await expect
		.poll(ticking(page, async () => (await readsSent(page)).length))
		.toBeGreaterThan(index);
	const sentAt = (await readsSent(page))[index];
	await page.clock.pauseAt(sentAt + READ_BUDGET_MS + 250);
};

const letTimePass = async (page: Page, ms: number) => {
	for (let passed = 0; passed < ms; passed += 250) await page.clock.runFor(250);
};

const watchTheNotice = async (page: Page, landed: string | null = null) => {
	await page.evaluate(
		({ reading, landed }) => {
			const counted = { times: 0, gaps: 0 };
			(window as unknown as { notices: typeof counted }).notices = counted;
			let showing = false;
			let seen = false;
			const look = () => {
				const text = document.body.innerText;
				const now = text.includes(reading);
				if (now && !showing) counted.times += 1;
				if (seen && !now && landed && !text.includes(landed)) counted.gaps += 1;
				showing = now;
				seen ||= now;
			};
			new MutationObserver(look).observe(document.body, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		},
		{ reading: READING, landed },
	);
	return () =>
		page.evaluate(
			() =>
				(window as unknown as { notices: { times: number; gaps: number } })
					.notices,
		);
};

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

test.describe("the details read", () => {
	test.use(PUBLISHED);

	test("fills the panel from foo_jean", async ({ page, player, isMobile }) => {
		await playRow(page, 0);
		const panel = await openDetails(page, isMobile);

		await expect(panel).toContainText("Discos Uno");
		expect(playingReads(player).length).toBeGreaterThan(0);
	});

	test("an answer for another track is never drawn, and the track is read again when it plays again", async ({
		page,
		player,
		isMobile,
	}) => {
		player.fooJean.playingTrackAnswersPath = "Elsewhere/Overtaken.flac";

		await playRow(page, 0);
		const panel = await openDetails(page, isMobile);

		await expectSettlesAt(player, () => playingReads(player).length > 0, true);
		await expect(detailRows(panel)).toHaveCount(0);
		await expect(panel).not.toContainText("Discos Uno");

		player.fooJean.playingTrackAnswersPath = null;
		player.next();
		await expect(panel).toContainText("Discos Dos");
		player.previous();
		await expect(panel).toContainText("Discos Uno");
	});

	test("an answer for another track in the same file is never drawn", async ({
		page,
		player,
		isMobile,
	}) => {
		player.fooJean.playingTrackAnswersSubsong = 1;

		await playRow(page, 0);
		const panel = await openDetails(page, isMobile);

		await expectSettlesAt(player, () => playingReads(player).length > 0, true);
		await expect(detailRows(panel)).toHaveCount(0);
		await expect(panel).not.toContainText("Discos Uno");
	});
});

test.describe("while the read is in flight", () => {
	test.use({ ...PUBLISHED, fooJean: { hangPlayingTrack: true } });

	test("both panels say they are reading, and draw nothing else", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openDetails(page, isMobile);

		await expect(panel).toContainText(READING);
		await expectSettlesAt(player, () => playingReads(player).length > 0, true);
		await expect(panel).toContainText(READING);
		await expect(detailRows(panel)).toHaveCount(0);

		await panelTab(panel, "Lyrics").click();
		await expect(panel).toContainText(READING_LYRIC);
	});
});

test.describe("the reading notice", () => {
	test.use(PUBLISHED);

	test("is drawn once for each track change and not again", async ({
		page,
		player,
		isMobile,
	}) => {
		await playRow(page, 0);
		const panel = await openDetails(page, isMobile);
		await expect(panel).toContainText("Discos Uno");

		const notices = await watchTheNotice(page);

		player.next();
		await expect(panel).toContainText("Discos Dos");
		player.next();
		await expect(panel).toContainText("Discos Tres");

		await page.waitForTimeout(2_500);
		expect((await notices()).times).toBe(2);
	});

	test("stays up across a failed first read and the one after it, and counts once", async ({
		page,
		player,
		isMobile,
	}) => {
		const panel = await detailsOpenOnFirstTrack(page, isMobile);
		const notices = await watchTheNotice(page, "Discos Dos");
		Object.assign(player.fooJean, {
			failPlayingTrack: 500,
			playingTrackKnobsFor: 1,
		});

		player.next();
		await expect(panel).toContainText("Discos Dos");

		await page.waitForTimeout(2_500);
		expect(await notices()).toEqual({ times: 1, gaps: 0 });
	});
});

const RETRY_WINDOW_MS = 3_000;

for (const status of [404, 500, 504]) {
	test.describe(`a read refused with ${status} every time`, () => {
		test.use(PUBLISHED);

		test("is read once more, then draws nothing and says nothing", async ({
			page,
			player,
			isMobile,
		}) => {
			const panel = await detailsOpenOnFirstTrack(page, isMobile);
			const said = await watchWhatIsSaid(page);
			const reads = readsFromNow(player);
			player.fooJean.failPlayingTrack = status;

			player.next();
			await expectSettlesAt(player, reads, 2);
			await page.waitForTimeout(RETRY_WINDOW_MS);
			expect(reads()).toBe(2);

			await expect(detailRows(panel)).toHaveCount(0);
			await expect(panel).not.toContainText(READING);
			await expect(panel).not.toContainText(NOTHING_PLAYING);
			expect(await said()).toEqual([]);
		});
	});
}

test.describe("a read that never answers, every time", () => {
	test.use(PUBLISHED);

	test("is given up after eight seconds and read once more, then draws nothing and says nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await stampReadsSent(page);
		const panel = await detailsOpenOnFirstTrack(page, isMobile);
		const said = await watchWhatIsSaid(page);
		const reads = readsFromNow(player);
		const first = (await readsSent(page)).length;
		player.fooJean.hangPlayingTrack = true;

		player.next();
		await outlastBudgetOfRead(page, first);
		await outlastBudgetOfRead(page, first + 1);
		await expect
			.poll(ticking(page, () => panel.textContent()))
			.not.toContain(READING);
		await letTimePass(page, RETRY_WINDOW_MS);
		await expectSettlesAt(player, reads, 2);

		await expect(detailRows(panel)).toHaveCount(0);
		await expect(panel).not.toContainText(NOTHING_PLAYING);
		expect(await said()).toEqual([]);
	});
});

// Fizz carries a lyric, so the lyric's own look at a bare track two seconds
// after its details land cannot add a read to the count.
const PUBLISHED_WITH_LYRIC = {
	retagged: {
		...PUBLISHED.retagged,
		Fizz: { ...PUBLISHED.retagged.Fizz, "$meta(unsynced lyrics)": "Dos" },
	},
};

const FIRST_READ_ONLY = [
	["refused with 404", { failPlayingTrack: 404 }],
	["refused with 500", { failPlayingTrack: 500 }],
	["refused with 504", { failPlayingTrack: 504 }],
	[
		"answered for another file",
		{ playingTrackAnswersPath: "Elsewhere/Overtaken.flac" },
	],
	[
		"answered for another track in the same file",
		{ playingTrackAnswersSubsong: 1 },
	],
] as const;

for (const [what, knob] of FIRST_READ_ONLY) {
	test.describe(`a first read ${what}`, () => {
		test.use(PUBLISHED_WITH_LYRIC);

		test("is read once more, and the second answer drawn", async ({
			page,
			player,
			isMobile,
		}) => {
			const panel = await detailsOpenOnFirstTrack(page, isMobile);
			const reads = readsFromNow(player);
			Object.assign(player.fooJean, knob, { playingTrackKnobsFor: 1 });

			player.next();
			await expect(async () => {
				await panelTab(panel, "Details").click();
				await expect(panel).toContainText("Discos Dos", { timeout: 1_000 });
			}).toPass();
			await expectSettlesAt(player, reads, 2);
		});
	});
}

test.describe("a first read that never answers", () => {
	test.use(PUBLISHED_WITH_LYRIC);

	test("is given up after eight seconds, read once more, and the second answer drawn", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.clock.install();
		await stampReadsSent(page);
		const panel = await detailsOpenOnFirstTrack(page, isMobile);
		const reads = readsFromNow(player);
		const first = (await readsSent(page)).length;
		Object.assign(player.fooJean, {
			hangPlayingTrack: true,
			playingTrackKnobsFor: 1,
		});

		player.next();
		await outlastBudgetOfRead(page, first);
		await expect
			.poll(
				ticking(page, async () => {
					await panelTab(panel, "Details").click();
					return panel.textContent();
				}),
			)
			.toContain("Discos Dos");
		await expectSettlesAt(player, reads, 2);
	});
});

test.describe("what the panels say while a track plays", () => {
	test.use(PUBLISHED);

	test("after both reads fail, the lyric says neither that it is reading nor that there is none", async ({
		page,
		player,
		isMobile,
	}) => {
		const panel = await detailsOpenOnFirstTrack(page, isMobile);
		const reads = readsFromNow(player);
		player.fooJean.failPlayingTrack = 500;

		player.next();
		await expectSettlesAt(player, reads, 2);

		await panelTab(panel, "Lyrics").click();
		await expectPanelOpen(panel, "Lyrics");
		await expect(panel).not.toContainText(READING_LYRIC);
		await expect(panel).not.toContainText(NO_LYRIC);
	});

	test("once the player stops, the details panel says nothing is playing", async ({
		page,
		player,
		isMobile,
	}) => {
		const panel = await detailsOpenOnFirstTrack(page, isMobile);

		player.stop();
		await expect(panel).toContainText(NOTHING_PLAYING);
		await expect(detailRows(panel)).toHaveCount(0);
	});

	test("on a page load, before foo_jean is found, the details panel does not say nothing is playing", async ({
		page,
		player,
		isMobile,
	}) => {
		await page.route(
			(url) => url.pathname === "/api/capabilities",
			() => {},
		);
		player.playItem(player.playlists[0].id, 0);

		await page.goto("/#/playing/details");
		const details = (await openDetails(page, isMobile)).locator(
			'[data-tab="details"]',
		);
		await expect(details).toBeAttached();
		await expect(details).not.toContainText(NOTHING_PLAYING);
		await expect(detailRows(details)).toHaveCount(0);
	});
});

// Most tracks in a real library carry no rating tag, and the player answers `?`
// for every one of them: a rating nobody has given yet, not one that cannot be.
test.describe("a playing track with no rating tag", () => {
	test.use({ withoutFields: ["%rating%"] });

	test("draws stars that take a first rating", async ({ page }) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await expect(screen.getByRole("group", { name: "Unrated" })).toBeVisible();
		await expect(
			screen.getByRole("button", { name: "Rate 4 of 5" }),
		).toBeVisible();
	});
});
