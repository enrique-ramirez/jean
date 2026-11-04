import { en } from "../../src/shared/i18n/en.ts";
import { KEYMAP } from "../../src/shared/keyboard/keymap.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	requestsTo,
	revealSearch,
	rowByTitle,
	searchField,
	searchFor,
	tagWrites,
	test,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import { pressAndHold, touchDrag } from "./gestures.ts";
import { holdRows } from "./libraryLists.ts";
import { openRowMenu } from "./menus.ts";
import {
	discardButton,
	expectDiscardPrompt,
	expectPanelOpen,
	keepEditingButton,
	openPanels,
	panelTab,
	untilThePageKnowsPlaying,
} from "./nowPlaying.ts";
import { openQueue, queueButton, queuePanel } from "./queue.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// The details panel is the surface a row's menu opens on any track. The Details tab under
// `/playing/details` draws the same view for whatever is playing; criterion 17 compares the two.

// Read through a function rather than indexed straight: the panel's phrases arrive with the panel,
// and a missing key read straight is `undefined`, which as a role's name matches every element of
// that role.
const phrase = (key: string) => {
	const said = (en as Record<string, unknown>)[key];
	if (typeof said !== "string")
		throw new Error(`en.ts carries no phrase "${key}", which the panel needs`);
	return said;
};

const DETAILS = () => phrase("track.details");
const PANEL_TITLE = () => phrase("details.panelTitle");
const CLOSE = () => phrase("details.close");
const RETRY = () => phrase("action.tryAgain");
const READING = en["details.reading"];
const FAILED = en["details.failed"];
const RELEASE = en["details.group.release"];
const FILE = en["details.group.file"];
const LISTENING = en["details.group.listening"];
const GROUPS = [RELEASE, FILE, LISTENING];

// Library rows of the playlist `openLibrary` opens, in their captured order.
const LOS_CALIENTES = { row: 0, title: "Los Calientes", artist: "Babasónicos" };
const FIZZ = { row: 1, title: "Fizz" };
const DELECTRICO = { row: 2, title: "Deléctrico" };

const DESKTOP_WIDTH_PX = 360;
// A box is fractional.
const SLACK_PX = 1;

const detailsPanel = (page: Page) =>
	page.getByRole("region", { name: PANEL_TITLE() });

const closeButton = (page: Page) =>
	detailsPanel(page).getByRole("button", { name: CLOSE() });

const panelHeading = (page: Page, title: string) =>
	detailsPanel(page).getByRole("heading", { level: 2, name: title });

const menuItem = (page: Page, name: string) =>
	page.getByRole("menuitem", { name, exact: true });

// Whether a person could see the thing and reach it: drawn, inside the viewport, and not parked
// inert. The queue panel stays in the document when it closes, inert and off the right edge, so
// neither a count nor `toBeHidden()` tells open from closed; this reads the same for a surface
// that unmounts and one that parks.
const isOnScreen = (target: Locator) =>
	target.evaluateAll((found) =>
		found.some((element) => {
			if (element.closest('[inert], [aria-hidden="true"]')) return false;
			if (getComputedStyle(element).visibility === "hidden") return false;
			const box = element.getBoundingClientRect();
			return (
				box.width > 0 &&
				box.height > 0 &&
				box.right > 0 &&
				box.bottom > 0 &&
				box.left < window.innerWidth &&
				box.top < window.innerHeight
			);
		}),
	);

const expectOpen = (target: Locator) =>
	expect.poll(() => isOnScreen(target)).toBe(true);

const expectClosed = (target: Locator) =>
	expect.poll(() => isOnScreen(target)).toBe(false);

const openMenuOn = async (page: Page, isMobile: boolean, row: Locator) => {
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(menuItem(page, DETAILS())).toBeVisible();
};

const chooseDetails = async (page: Page) => {
	await menuItem(page, DETAILS()).click();
	await expectOpen(detailsPanel(page));
};

const openDetailsAt = async (page: Page, isMobile: boolean, index: number) => {
	await openRowMenu(page, isMobile, index, DETAILS());
	await chooseDetails(page);
};

// Which captured track a drawn row is, read off its own text. The longest title it contains, since
// a row carries its album and artist beside the title and a short title can sit inside a longer one.
// Waited for, since a row is drawn before its window lands.
const titleShownIn = async (player: FakePlayer, row: Locator) => {
	const titles = (player.playlistById("p7")?.items ?? []).map((track) =>
		String(track["%title%"]),
	);
	const read = async () => {
		const text = await row.innerText();
		return (
			titles
				.filter((title) => text.includes(title))
				.sort((a, b) => b.length - a.length)[0] ?? null
		);
	};
	await expect
		.poll(read, { message: "the row never showed a captured title" })
		.not.toBeNull();
	return (await read()) as string;
};

const rowsOf = async (root: Locator) => {
	const labels = await root.getByRole("term").allInnerTexts();
	const values = await root.getByRole("definition").allInnerTexts();
	return labels.map((label, at) => [label.trim(), values[at]?.trim()]);
};

const groupsOf = async (root: Locator) => {
	const shown: string[] = [];
	for (const group of GROUPS)
		if (
			(await root.getByRole("heading", { name: group, exact: true }).count()) >
			0
		)
			shown.push(group);
	return shown;
};

const labelsOf = async (root: Locator) =>
	(await root.getByRole("term").allInnerTexts()).map((label) => label.trim());

const libraryReads = (player: FakePlayer) =>
	requestsTo(player, "/api/track/library").filter(
		(entry) => entry.method === "GET",
	);

test.describe("a row's menu", () => {
	const SURFACES = [
		{
			name: "a playlist",
			open: (page: Page) => openLibrary(page),
			row: (page: Page) => trackRow(page, 1),
		},
		{
			name: "the library",
			open: (page: Page) => openAllMusic(page),
			row: (page: Page) => trackRow(page, 1),
		},
		{
			name: "the search results",
			open: async (page: Page) => {
				await openLibrary(page);
				await searchFor(page, "babasonicos");
			},
			row: (page: Page) => trackRow(page, 1),
		},
		{
			name: "the search dropdown",
			open: async (page: Page) => {
				await openLibrary(page);
				await revealSearch(page);
				await searchField(page).fill("babasonicos");
			},
			row: (page: Page) =>
				page.locator('[role="option"][data-kind="track"]').nth(1),
		},
	];

	// The second row rather than the first, so a panel opened for the wrong row of the list has a
	// different title to show for it.
	for (const surface of SURFACES)
		test(`on ${surface.name} offers Details, which opens the panel for that row's track`, async ({
			page,
			player,
			isMobile,
		}) => {
			await surface.open(page);
			const row = surface.row(page);
			await expect(row).toBeVisible();
			const title = await titleShownIn(player, row);

			await openMenuOn(page, isMobile, row);
			await chooseDetails(page);

			await expect(panelHeading(page, title)).toBeVisible();
		});

	test("offers no Details for a selection of several rows", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no range to select");
		await openLibrary(page);
		await page.keyboard.press("Shift+ArrowDown");
		await page.keyboard.press("Shift+ArrowDown");
		await expect(
			page.locator('[role="row"][aria-selected="true"]'),
		).toHaveCount(3);

		await openRowMenu(page, isMobile, 0, en["track.queue"]);
		await expect(page.getByText("3 tracks")).toBeVisible();

		// Read once rather than retried: the menu has drawn, and a retrying read would pass on an item
		// that showed and went away.
		expect(await menuItem(page, DETAILS()).count()).toBe(0);
	});

	test.describe("on a row still pending", () => {
		test.use({ fooJean: { holdRows: true } });

		test("offers no Details, and offers it once the row lands", async ({
			page,
			player,
			isMobile,
		}) => {
			await page.goto("/#/all");
			await expect
				.poll(() => player.fooJean.rowsHeld.length, {
					message: "All music never asked for its rows",
				})
				.toBeGreaterThan(0);
			await expect(trackRow(page, 0)).toHaveAttribute("aria-busy", "true");

			await openRowMenu(page, isMobile, 0, en["track.queue"]);
			expect(await menuItem(page, DETAILS()).count()).toBe(0);

			await page.keyboard.press("Escape");
			await expect(menuItem(page, en["track.queue"])).toHaveCount(0);
			await holdRows(page, false);
			await expect(trackRow(page, 0)).not.toHaveAttribute("aria-busy", "true");

			await openRowMenu(page, isMobile, 0, DETAILS());
		});
	});
});

test.describe("the panel's content", () => {
	// An album artist of its own, so the track's artist reaches the panel through its heading and
	// through no row.
	test.use({
		retagged: {
			"Los Calientes": {
				"%publisher%": "Discos Manzana",
				"%album artist%": "Varios Artistas",
			},
		},
	});

	test("is headed by the track's title and artist, and lists what the file has and drops what it does not", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
		const panel = detailsPanel(page);

		await expect(panelHeading(page, LOS_CALIENTES.title)).toBeVisible();
		await expect(panel).toContainText(LOS_CALIENTES.artist);
		await expect(panel).toContainText("Discos Manzana");
		await untilQuiet(player);

		expect(await groupsOf(panel)).toEqual(GROUPS);
		const labels = await labelsOf(panel);
		expect(labels).toContain(en["details.publisher"]);
		expect(labels).toContain(en["details.format"]);
		expect(labels).not.toContain(en["details.bpm"]);
		expect(labels).not.toContain(en["details.replayGain"]);
	});

	test("shows the same groups, rows and values as the Details tab for the same track", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
		await expect(detailsPanel(page)).toContainText("Discos Manzana");
		await untilQuiet(player);
		const drawn = await rowsOf(detailsPanel(page));
		const groups = await groupsOf(detailsPanel(page));
		expect(drawn).toContainEqual([en["details.publisher"], "Discos Manzana"]);

		await closeButton(page).click();
		await expectClosed(detailsPanel(page));
		await trackRow(page, LOS_CALIENTES.row).dblclick();
		await untilThePageKnowsPlaying(page, LOS_CALIENTES.title);
		await openNowPlaying(page);
		const tab = await openPanels(page, isMobile);
		await panelTab(tab, "Details").click();
		await expectPanelOpen(tab, "Details");

		await expect.poll(() => rowsOf(tab)).toEqual(drawn);
		expect(await groupsOf(tab)).toEqual(groups);
	});
});

test.describe("a track nobody has played", () => {
	test("shows its release and file facts and no Listening group", async ({
		page,
		player,
		isMobile,
	}) => {
		// Every track of Lafcadio is unplayed in the capture.
		await openLibrary(page);
		await searchFor(page, "lafcadio");
		await expect(trackRow(page, 0)).toBeVisible();
		await openDetailsAt(page, isMobile, 0);
		const panel = detailsPanel(page);

		await expect(panel).toContainText("Lafcadio");
		await expect(panel).toContainText("MP3");
		await untilQuiet(player);

		expect(await groupsOf(panel)).toEqual([RELEASE, FILE]);
		const labels = await labelsOf(panel);
		expect(labels).not.toContain(en["details.plays"]);
		expect(labels).not.toContain(en["details.lastPlayed"]);
	});
});

test.describe("while the read has not answered", () => {
	test.use({ fooJean: { hangLibraryTrack: true } });

	test("the panel says it is reading the tags, and draws no row", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		await openDetailsAt(page, isMobile, 1);

		await expect(detailsPanel(page)).toContainText(READING);
		await expect.poll(() => libraryReads(player).length).toBeGreaterThan(0);
		await untilQuiet(player);
		await expect(detailsPanel(page)).toContainText(READING);
		expect(await detailsPanel(page).getByRole("term").count()).toBe(0);
	});
});

test.describe("a read that fails", () => {
	test("says the details could not be read, draws nothing of the track before, and reads again on Try again", async ({
		page,
		player,
		isMobile,
	}) => {
		await openAllMusic(page);
		const before = await titleShownIn(player, trackRow(page, 0));
		const after = await titleShownIn(player, trackRow(page, 1));

		await openDetailsAt(page, isMobile, 0);
		await expect(panelHeading(page, before)).toBeVisible();
		await expect(detailsPanel(page).getByRole("term").first()).toBeVisible();

		player.fooJean.failLibraryTrack = 500;
		// The drawer covers the list on a phone, so the next row is reached with the panel closed.
		if (isMobile) {
			await closeButton(page).click();
			await expectClosed(detailsPanel(page));
		}
		await openDetailsAt(page, isMobile, 1);

		const panel = detailsPanel(page);
		await expect(panel).toContainText(FAILED);
		const retry = panel.getByRole("button", { name: RETRY() });
		await expect(retry).toBeVisible();
		await untilQuiet(player);
		await expect(panel).not.toContainText(before);
		expect(await panel.getByRole("term").count()).toBe(0);

		player.fooJean.failLibraryTrack = null;
		await retry.click();
		await expect(panel.getByRole("term").first()).toBeVisible();
		await expect(panelHeading(page, after)).toBeVisible();
		await expect(panel).not.toContainText(FAILED);
	});
});

test.describe("with the panel open", () => {
	test("Details on another row shows that row's track without the panel closing", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"the drawer covers the list on a phone, so no other row's menu is in reach",
		);
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
		await expect(panelHeading(page, LOS_CALIENTES.title)).toBeVisible();

		// Watched every frame from here on, since a panel closed and opened again between two reads
		// looks the same as one that stayed.
		await page.evaluate((name) => {
			const watch = { gaps: 0 };
			Object.assign(window, { __detailsWatch: watch });
			const look = () => {
				const shown = [
					...document.querySelectorAll(`[aria-label="${name}"]`),
				].some((element) => {
					if (element.closest("[inert]")) return false;
					const box = element.getBoundingClientRect();
					return box.width > 0 && box.left < window.innerWidth;
				});
				if (!shown) watch.gaps += 1;
				requestAnimationFrame(look);
			};
			requestAnimationFrame(look);
		}, PANEL_TITLE());

		await openDetailsAt(page, isMobile, DELECTRICO.row);
		await expect(panelHeading(page, DELECTRICO.title)).toBeVisible();
		await expect(detailsPanel(page)).not.toContainText(LOS_CALIENTES.title);

		const gaps = await page.evaluate(
			() =>
				(window as unknown as { __detailsWatch: { gaps: number } })
					.__detailsWatch.gaps,
		);
		expect(gaps, "frames the panel was off the screen").toBe(0);
	});

	test("goes on showing its track when the player moves to the next one", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, LOS_CALIENTES.row).dblclick();
		await untilThePageKnowsPlaying(page, LOS_CALIENTES.title);

		// Opened on the playing track, which is the one a panel bound to what is playing would follow.
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
		await expect(panelHeading(page, LOS_CALIENTES.title)).toBeVisible();

		player.next();
		await untilThePageKnowsPlaying(page, FIZZ.title);
		await untilQuiet(player);

		await expect(panelHeading(page, LOS_CALIENTES.title)).toBeVisible();
		await expect(detailsPanel(page)).not.toContainText(FIZZ.title);
	});

	test("takes the queue panel's place, and closing it brings the queue back", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the queue is a drawer over the list on a phone");
		await openLibrary(page);
		await openQueue(page);
		await expectOpen(queuePanel(page));

		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
		await expectClosed(queuePanel(page));

		await closeButton(page).click();
		await expectClosed(detailsPanel(page));
		await expectOpen(queuePanel(page));
	});
});

test.describe("closing the panel", () => {
	test("Escape closes it", async ({ page, isMobile }) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		await page.keyboard.press("Escape");

		await expectClosed(detailsPanel(page));
	});

	test("its close button closes it", async ({ page, isMobile }) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		await closeButton(page).click();

		await expectClosed(detailsPanel(page));
	});

	test("a flick to the right closes it", async ({ page, isMobile }) => {
		test.skip(!isMobile, "a flick is a touch gesture");
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		// Begun inside the left edge of the panel, so the whole 160px lands on it.
		const box = (await detailsPanel(page).boundingBox())!;
		const from = { x: box.x + 40, y: box.y + box.height / 2 };
		await touchDrag(page, from, { x: from.x + 160, y: from.y });

		await expectClosed(detailsPanel(page));
	});
});

test.describe("focus", () => {
	// The grid holds focus and names its cursor row through `aria-activedescendant`, since the
	// virtualiser unmounts a row that scrolls away; that pair is what "the row has focus" is here.
	test("moves to the panel's heading as it opens, and back to the row it was opened from as it closes", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		const row = trackRow(page, DELECTRICO.row);
		const rowId = await row.getAttribute("id");
		expect(rowId).toBeTruthy();

		await openDetailsAt(page, isMobile, DELECTRICO.row);
		await expect(panelHeading(page, DELECTRICO.title)).toBeFocused();

		await closeButton(page).click();
		await expectClosed(detailsPanel(page));

		const grid = page.getByRole("grid");
		await expect(grid).toBeFocused();
		await expect(grid).toHaveAttribute("aria-activedescendant", rowId!);
	});
});

test.describe("names a screen reader hears", () => {
	test("the panel is a landmark named Track details, closed by a button named Close track details", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		await expect(detailsPanel(page)).toBeVisible();
		await expect(closeButton(page)).toBeVisible();
	});
});

test.describe("from the keyboard", () => {
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("I opens the panel for the row the cursor is on", async ({ page }) => {
		await openLibrary(page);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await expect(trackRow(page, DELECTRICO.row)).toHaveAttribute(
			"data-cursor",
			"true",
		);

		await page.keyboard.press("i");

		await expectOpen(detailsPanel(page));
		await expect(panelHeading(page, DELECTRICO.title)).toBeVisible();
	});
});

test.describe("a reload", () => {
	test("leaves the panel closed", async ({ page, player, isMobile }) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		await page.reload();
		await expect(trackRow(page, 0)).toBeVisible();
		await untilQuiet(player);

		expect(await isOnScreen(detailsPanel(page))).toBe(false);
	});
});

test.describe("the panel's size", () => {
	test("is the full width of a phone, and 360 px against the right edge on a desktop", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

		const viewport = page.viewportSize()!;
		const box = (await detailsPanel(page).boundingBox())!;
		const width = isMobile ? viewport.width : DESKTOP_WIDTH_PX;
		expect(Math.abs(box.width - width)).toBeLessThanOrEqual(SLACK_PX);
		expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(
			SLACK_PX,
		);
	});
});

test.describe("on a phone with a notch", () => {
	test.skip(({ isMobile }) => !isMobile, "a desktop has no safe area");
	test.use({ settings: { "jean.heatIntroSeen": true } });

	// Chromium's DevTools protocol: `Emulation.setSafeAreaInsetsOverride` sets what `env()` answers.
	const emulateSafeArea = async (
		page: Page,
		insets: { top: number; left: number; right: number; bottom: number },
	) => {
		const session = await page.context().newCDPSession(page);
		await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
	};

	test("held upright, the heading and the close button start under it", async ({
		page,
	}) => {
		const NOTCH = { top: 40, left: 0, right: 0, bottom: 21 };
		await emulateSafeArea(page, NOTCH);
		await openLibrary(page);
		await openDetailsAt(page, true, LOS_CALIENTES.row);

		for (const control of [
			panelHeading(page, LOS_CALIENTES.title),
			closeButton(page),
		])
			expect((await control.boundingBox())!.y).toBeGreaterThanOrEqual(
				NOTCH.top,
			);
	});

	test.describe("held sideways", () => {
		test.use({ viewport: { width: 780, height: 360 } });

		test("the heading and the close button sit between the insets", async ({
			page,
		}) => {
			const NOTCH = { top: 0, left: 48, right: 48, bottom: 21 };
			await emulateSafeArea(page, NOTCH);
			await openLibrary(page);
			await openDetailsAt(page, true, LOS_CALIENTES.row);

			const width = page.viewportSize()!.width;
			for (const control of [
				panelHeading(page, LOS_CALIENTES.title),
				closeButton(page),
			]) {
				const box = (await control.boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(NOTCH.left);
				expect(box.x + box.width).toBeLessThanOrEqual(width - NOTCH.right);
			}
		});
	});
});

test.describe("after the owner's answers", () => {
	test.describe("a way to the queue with the panel open", () => {
		test.skip(
			({ isMobile }) => isMobile,
			"the panel covers the list on a phone, and the queue is a drawer over it",
		);

		// Bound as "Q" and typed unshifted, as a person presses it.
		const QUEUE_KEY = String(
			KEYMAP.find((binding) => binding.id === "toggleQueue")?.keys[0],
		).toLowerCase();

		const WAYS = [
			{
				name: "the queue key",
				// Waited on first: a keystroke sent before the shell has drawn is not queued for it.
				take: async (page: Page) => {
					await expect(queueButton(page)).toBeVisible();
					await page.keyboard.press(QUEUE_KEY);
				},
			},
			{
				name: "the status bar's queue button",
				take: (page: Page) => queueButton(page).click(),
			},
		];

		// Whether the panel is reachable at any frame from here on: drawn and not inert. Read so rather
		// than on screen, since a panel coming back is reachable the frame it opens and on screen only
		// once it has begun to slide in, which can be after the last look.
		const watchForPanel = (page: Page) =>
			page.evaluate((name) => {
				const watch = { seen: false };
				Object.assign(window, { __panelWatch: watch });
				const look = () => {
					for (const element of document.querySelectorAll(
						`[aria-label="${name}"]`,
					))
						if (
							!element.closest("[inert]") &&
							getComputedStyle(element).display !== "none"
						)
							watch.seen = true;
					requestAnimationFrame(look);
				};
				requestAnimationFrame(look);
			}, PANEL_TITLE());

		// Read a whole frame after the queue shut, so the watch has looked at least once since.
		const panelEverSeen = (page: Page) =>
			page.evaluate(
				() =>
					new Promise<boolean>((resolve) =>
						requestAnimationFrame(() =>
							requestAnimationFrame(() =>
								resolve(
									(window as unknown as { __panelWatch: { seen: boolean } })
										.__panelWatch.seen,
								),
							),
						),
					),
			);

		for (const way of WAYS) {
			test(`${way.name} closes the details panel and shows the queue, and a second press shuts the queue without the panel coming back`, async ({
				page,
				isMobile,
			}) => {
				await openLibrary(page);
				await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
				await expectClosed(queuePanel(page));

				await way.take(page);

				await expectClosed(detailsPanel(page));
				await expectOpen(queuePanel(page));

				// Closed rather than hidden behind the queue: one panel at a time, so shutting the queue
				// leaves neither.
				await watchForPanel(page);
				await way.take(page);
				await expectClosed(queuePanel(page));
				expect(
					await panelEverSeen(page),
					"the details panel came back as the queue shut",
				).toBe(false);
			});

			// The queue was open when Details took its place, so it is still open underneath; a way that
			// only flips it would shut a queue the person cannot see.
			test(`${way.name} shows the queue the panel took the place of`, async ({
				page,
				isMobile,
			}) => {
				await openLibrary(page);
				await openQueue(page);
				await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
				await expectClosed(queuePanel(page));

				await way.take(page);

				await expectClosed(detailsPanel(page));
				await expectOpen(queuePanel(page));
			});
		}

		test("Add to queue on a row's menu closes the details panel and shows the queue", async ({
			page,
			player,
			isMobile,
		}) => {
			await openLibrary(page);
			await openDetailsAt(page, isMobile, LOS_CALIENTES.row);

			await openRowMenu(page, isMobile, FIZZ.row, en["track.queue"]);
			await menuItem(page, en["track.queue"]).click();
			await expect.poll(() => player.playQueue.length).toBe(1);

			await expectClosed(detailsPanel(page));
			await expectOpen(queuePanel(page));
		});

		// Asked, kept, asked again, discarded: a guard that asks once loses the change on the second
		// press.
		test("with a change in the form, the queue button asks first: Keep editing keeps the panel and its change, and Discard shows the queue with nothing written", async ({
			page,
			player,
			isMobile,
		}) => {
			await openLibrary(page);
			await openDetailsAt(page, isMobile, LOS_CALIENTES.row);
			const panel = detailsPanel(page);
			await panel
				.getByRole("button", { name: en["details.edit"], exact: true })
				.click();
			const album = panel.getByRole("textbox", {
				name: en["details.album"],
				exact: true,
			});
			await album.fill("Jessico (reedición)");

			await queueButton(page).click();
			const prompt = await expectDiscardPrompt(page);
			await keepEditingButton(prompt).click();

			await expect(prompt).toHaveCount(0);
			await expect(album).toHaveValue("Jessico (reedición)");
			expect(await isOnScreen(panel)).toBe(true);
			expect(await isOnScreen(queuePanel(page))).toBe(false);

			await queueButton(page).click();
			await expectDiscardPrompt(page);
			await discardButton(prompt).click();

			await expectClosed(panel);
			await expectOpen(queuePanel(page));
			await expectSettlesAt(player, () => tagWrites(player).length, 0);
		});
	});

	test.describe("the panel's album artist", () => {
		// A credit naming two artists the library knows on their own: Alice in Chains as the rest of Jar
		// Of Flies' album artist, Mad Season as "Don't Follow"'s artist. Drawn without the credit's
		// members it is one link to an artist called by the whole line; with them, a link each.
		const LEAD = "Alice in Chains";
		const OTHER = "Mad Season";
		const SHARED = "No Excuses";
		// The file's own values, which the form's chips are filled from, one value to an artist.
		const SEPARATOR = String.fromCharCode(31);
		test.use({
			retagged: {
				[SHARED]: {
					"%album artist%": `${LEAD}, ${OTHER}`,
					"$meta_sep(album artist,$char(31))": `${LEAD}${SEPARATOR}${OTHER}`,
				},
				"Don't Follow": { "%artist%": OTHER },
			},
		});

		const ALBUM_ARTIST = en["details.albumArtist"];

		const rowValue = async (root: Locator, label: string) => {
			await expect(
				root.getByRole("term").filter({ hasText: label }).first(),
			).toBeVisible();
			const at = (await labelsOf(root)).indexOf(label);
			expect(at, `no ${label} row`).toBeGreaterThanOrEqual(0);
			return root.getByRole("definition").nth(at);
		};

		const linksIn = (value: Locator) =>
			value
				.getByRole("link")
				.evaluateAll((links) =>
					links.map((link) => [
						link.textContent?.trim() ?? "",
						link.getAttribute("href") ?? "",
					]),
				);

		const SURFACES = [
			{ name: "a playlist", open: (page: Page) => openLibrary(page) },
			{ name: "the library", open: (page: Page) => openAllMusic(page) },
		];

		// Read with nothing playing, so members read for whatever plays cannot stand in for the
		// panel's own track; then compared against the Details tab once the same track plays.
		for (const surface of SURFACES)
			test(`opened from ${surface.name}, links each artist the credit names, where the Details tab does`, async ({
				page,
				isMobile,
			}) => {
				await surface.open(page);
				const row = rowByTitle(page, SHARED);
				await scrollUntilMounted(page, row);
				await openMenuOn(page, isMobile, row);
				await chooseDetails(page);
				await expect(panelHeading(page, SHARED)).toBeVisible();

				const inPanel = await rowValue(detailsPanel(page), ALBUM_ARTIST);
				await expect(inPanel).toHaveText(`${LEAD}, ${OTHER}`);
				await expect(inPanel.getByRole("link")).toHaveText([LEAD, OTHER]);
				const panelLinks = await linksIn(inPanel);
				for (const [, href] of panelLinks) expect(href).toMatch(/#\/artist\//);

				await closeButton(page).click();
				await expectClosed(detailsPanel(page));
				if (isMobile) await row.tap();
				else await row.dblclick();
				await untilThePageKnowsPlaying(page, SHARED);
				await openNowPlaying(page);
				const tab = await openPanels(page, isMobile);
				await panelTab(tab, "Details").click();
				await expectPanelOpen(tab, "Details");

				const inTab = await rowValue(tab, ALBUM_ARTIST);
				await expect(inTab.getByRole("link")).toHaveText([LEAD, OTHER]);
				expect(await linksIn(inTab)).toEqual(panelLinks);
			});

		test("in edit mode is the chip input, and no link", async ({
			page,
			isMobile,
		}) => {
			await openLibrary(page);
			const row = rowByTitle(page, SHARED);
			await scrollUntilMounted(page, row);
			await openMenuOn(page, isMobile, row);
			await chooseDetails(page);
			const panel = detailsPanel(page);
			const inPanel = await rowValue(panel, ALBUM_ARTIST);
			await expect(inPanel.getByRole("link")).toHaveText([LEAD, OTHER]);

			await panel
				.getByRole("button", { name: en["details.edit"], exact: true })
				.click();

			await expect(
				panel.getByRole("textbox", { name: ALBUM_ARTIST, exact: true }),
			).toBeVisible();
			await expect(
				panel
					.getByRole("list", { name: ALBUM_ARTIST, exact: true })
					.getByRole("listitem"),
			).toHaveText([LEAD, OTHER]);
			for (const name of [LEAD, OTHER])
				expect(
					await panel.getByRole("link", { name, exact: true }).count(),
				).toBe(0);
		});
	});
});
