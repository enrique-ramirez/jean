import { KEYMAP } from "../../src/shared/keyboard/keymap.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
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

	test("the gatefold opens on Details when the track has no lyrics", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"a phone opens these by pressing Lyrics, which is the answer already",
		);

		await playRow(page, 3);
		const panel = nowPlayingScreen(page);
		await expectPanelOpen(panel, "Details");

		await playRow(page, 0);
		await expectPanelOpen(panel, "Lyrics");
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

		// The fake resolves nothing for these, as a real player answers `?` for a
		// tag the file does not carry.
		await expect(panel).not.toContainText("BPM");
		await expect(panel).not.toContainText("ReplayGain");
	});
});

// The phone's whole restructure in one describe: no tabs on the player, a
// button into the panels, and a horizontal flick that means the next track
// rather than the next tab.
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

		// The content is still inset; it is only the scroller that is not.
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
		await expect(
			screen.getByRole("img", { name: /stars|Unrated/ }),
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
