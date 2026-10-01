import type { Locator, Page } from "./fixtures.ts";
import {
	closeSidebar,
	expect,
	expectTheScreenIsStillOpen,
	isRowOnScreen,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSidebar,
	requestsTo,
	scrollTo,
	scrollTop,
	scrollUntilMounted,
	sidebar,
	sidebarToggle,
	statusBar,
	test,
	touchDrag,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import {
	expectPanelOpen,
	panelTab,
	playRow,
	TAGGED,
	trackInfo,
} from "./nowPlaying.ts";

test.describe("the way in and the way out", () => {
	test("the status bar block opens it and the chevron closes it", async ({
		page,
	}) => {
		await openLibrary(page);

		await statusBar(page)
			.getByRole("button", { name: "Show current track" })
			.click();
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();

		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});

	test("Escape closes it, and leaves a selection behind it alone", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await openLibrary(page);
		await trackRow(page, 1).click();
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");

		await openNowPlaying(page);
		await page.keyboard.press("Escape");
		await expect(nowPlayingScreen(page)).toBeHidden();

		// Escape also clears a selection in the list, which is why this one is
		// taken on the way down and stopped: two meanings, one keystroke.
		await expect(trackRow(page, 1)).toHaveAttribute("aria-selected", "true");
	});

	test("a field keeps Escape while the screen is open", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the top bar is behind the screen on a phone");

		await openLibrary(page);
		await openNowPlaying(page);

		// Empty rather than typed at: a query gives the field its own dropdown, and
		// Escape would close that instead of reaching the screen.
		const field = page.getByLabel("Search your library");
		await field.focus();
		await field.press("Escape");

		// Leaving a field is the same key, and the screen must not reach over a
		// caret to take it. The hash rather than the element, since dismissing
		// navigates at once but takes the exit animation to leave.
		await expect(field).not.toBeFocused();
		await expect(page).toHaveURL(/#\/playing$/);
	});

	test("the track menu takes Escape before the screen does", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "a phone has no Escape key");

		await playRow(page, 0);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Track actions" })
			.click();
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		await expect(nowPlayingScreen(page)).toBeVisible();
	});

	test("a reload lands on it and leaving still goes somewhere", async ({
		page,
	}) => {
		// `history.back()` would leave Jean altogether here: a direct load has no
		// entry behind it.
		await page.goto("/#/playing");
		await expect(nowPlayingScreen(page)).toBeVisible();

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(page.locator("main")).toBeVisible();
	});
});

test.describe("the cover", () => {
	// A phone draws the cover as the centre of a wheel whose next slot is filled
	// ahead of time, so the name has to follow the track onto a sleeve that was
	// drawn before it was the one playing.
	test("is named for its album, and the next album's once the player moves on", async ({
		page,
		player,
	}) => {
		await playRow(page, 11);
		await expect(
			nowPlayingScreen(page).getByRole("img", { name: "Jessico cover" }),
		).toBeVisible();

		player.next();

		await expect(
			nowPlayingScreen(page).getByRole("img", { name: "Deja Entendu cover" }),
		).toBeVisible();
		await expect(nowPlayingScreen(page).getByRole("img")).toHaveCount(1);
	});
});

test.describe("the set it is playing from", () => {
	test("the header takes you back to it, and closes on the way", async ({
		page,
	}) => {
		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		await trackRow(page, 0).dblclick();
		await openNowPlaying(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: /Playing from/ })
			.click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
	});

	test.describe("it lands on the track, not at the top of the set", () => {
		test.use({
			mediaLibrarySize: 400,
			librarySize: 400,
			settings: { "jean.followPlayback": false },
		});

		// Far enough down a 400-track library to be nowhere near the fold.
		const FAR = 120;

		const playFarAndLeaveTheTop = async (page: Page) => {
			await page.goto("/#/all");
			await expect(
				page.getByRole("heading", { level: 1, name: "All music" }),
			).toBeVisible();
			await scrollUntilMounted(page, trackRow(page, FAR));
			await trackRow(page, FAR).dblclick();
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");

			await scrollTo(page, 0);
			await expect.poll(() => scrollTop(page)).toBe(0);
		};

		const openThePlayingSet = async (page: Page) => {
			await openNowPlaying(page);
			await nowPlayingScreen(page)
				.getByRole("button", { name: /Playing from/ })
				.click();
			await expect(nowPlayingScreen(page)).toBeHidden();
		};

		test("from another view", async ({ page, player }) => {
			await playFarAndLeaveTheTop(page);
			const guid = player.playlists.find(
				(entry) => entry.title === "Rock en Español",
			)!.guid;
			await page.goto(`/#/${guid}`);
			await expect(page.getByRole("grid")).toBeVisible();

			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
			await expect(trackRow(page, FAR)).toHaveAttribute("data-active", "true");
		});

		test("and from the set it is already showing", async ({ page }) => {
			await playFarAndLeaveTheTop(page);

			await openThePlayingSet(page);

			await expect.poll(() => isRowOnScreen(page, FAR)).toBe(true);
		});
	});

	test.describe("a name longer than the screen is wide", () => {
		const LONG =
			"Heavy Metal Power Metal Speed Metal Symphonic Metal Progressive Metal";
		test.use({ retagged: { "Los Calientes": { "%genre%": LONG } } });

		test("is cut short, and the screen stays the width of the window", async ({
			page,
		}) => {
			await page.goto(`/#/genre/${encodeURIComponent(LONG)}`);
			await trackRow(page, 0).dblclick();
			await openNowPlaying(page);

			const screen = nowPlayingScreen(page);
			await expect(screen.locator("header")).toContainText(LONG);
			await expect(
				screen.getByRole("button", { name: "Track actions" }),
			).toBeInViewport({ ratio: 1 });
			const width = page.viewportSize()?.width ?? 0;
			const cover = await screen.locator("img").first().boundingBox();
			expect((cover?.x ?? 0) + (cover?.width ?? 0)).toBeLessThanOrEqual(width);
		});
	});

	test("a playlist of yours is named, and the header takes you back to it", async ({
		page,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await page.goto("/#/all");
		await openNowPlaying(page);

		const header = nowPlayingScreen(page).locator("header");
		await expect(header).not.toContainText("Now playing");
		await header.getByRole("button", { name: "Playing from Library" }).click();

		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect(
			page.getByRole("heading", { level: 1, name: "Library" }),
		).toBeVisible();
	});
});

test.describe("the screen a desktop gets", () => {
	// A long, untimed lyric on row 4: something to scroll, with nothing following
	// the playing position back up while a test is reading where it was left.
	test.use(TAGGED);
	const LYRIC_ROW = 4;

	// Far enough down that a screen which had remounted, and so opened at the top
	// again, could not have this line on screen.
	const MARK = "Line 40";

	test.skip(
		({ isMobile }) => isMobile,
		"on a phone the screen is the whole viewport and the sidebar is a drawer over it",
	);

	// `.body` transitions `grid-template-columns` over 0.22s, so a reading taken
	// on the click is a reading of the animation.
	const PAST_THE_COLUMN_TRANSITION_MS = 300;

	const FLUSH = "flush with the sidebar";

	const screenStartsAt = (page: Page) =>
		nowPlayingScreen(page).evaluate((node) =>
			Math.round(node.getBoundingClientRect().left),
		);

	// Boxes, and both of them read in one frame. Boxes because the fault this
	// replaces was invisible to every hook: the sidebar was laid out correctly
	// and the screen was simply drawn over it, so a class or a data attribute
	// said the right thing throughout. One frame because the column animates,
	// and two round trips would measure the sidebar at one moment and the screen
	// at another.
	const whereTheScreenStarts = (page: Page) =>
		page.evaluate((flush) => {
			const screen = document.querySelector("[data-now-playing]");
			// Not the role query: a hidden sidebar is `aria-hidden`, so it leaves
			// the accessibility tree at the moment this has to measure it.
			const nav = document.querySelector('nav[aria-label="Playlists"]');
			if (!screen || !nav)
				throw new Error("the screen and the sidebar are both meant to be here");

			const over = Math.round(
				screen.getBoundingClientRect().left - nav.getBoundingClientRect().right,
			);
			if (over === 0) return flush;
			return over < 0
				? `${-over}px of the sidebar is under the screen`
				: `${over}px of empty column is beside the screen`;
		}, FLUSH);

	const expectItClearsTheSidebar = async (page: Page, state: string) => {
		await expect
			.poll(() => whereTheScreenStarts(page), { message: `sidebar ${state}` })
			.toBe(FLUSH);

		// Read again once the column has stopped: a screen passing through the
		// right place on its way to the wrong one satisfies a single early sample.
		await page.waitForTimeout(PAST_THE_COLUMN_TRANSITION_MS);
		expect(await whereTheScreenStarts(page), `sidebar ${state}`).toBe(FLUSH);
	};

	// The width below which the gatefold gives up its second leaf,
	// `NowPlaying.module.css`.
	const TWO_LEAF_THRESHOLD = 1040;

	// The window where the screen's own width and the viewport's disagree: above
	// the threshold with the sidebar hidden, below it with the sidebar shown.
	// That window is exactly as wide as the sidebar, so its middle is the one
	// width that needs no other number, and the sidebar is measured rather than
	// written down so that widening it cannot quietly move this outside. At any
	// width outside the window both readings of the threshold draw the same
	// gatefold and the test proves nothing.
	const insideTheWindow = async (page: Page) => {
		const column = (await sidebar(page).boundingBox())!;
		return TWO_LEAF_THRESHOLD + Math.round(column.width / 2);
	};

	const BESIDE = "the panels are beside the title";
	const BELOW = "the panels are below the title";

	// Where the panels land, which is what two leaves and one look like to
	// somebody reading the screen. Both boxes in one frame for the reason
	// `whereTheScreenStarts` gives: the column animates, so two round trips can
	// measure the title at one width and the panels at another.
	const whereThePanelsSit = (page: Page) =>
		page.evaluate(
			(reads) => {
				const screen = document.querySelector("[data-now-playing]");
				const title = screen?.querySelector("h1");
				const panels = screen?.querySelector('nav[aria-label="Track views"]');
				if (!title || !panels)
					throw new Error("the gatefold has a title and a strip of panel tabs");

				const name = title.getBoundingClientRect();
				const strip = panels.getBoundingClientRect();
				if (strip.left >= name.right) return reads.beside;
				if (strip.top >= name.bottom) return reads.below;
				return `the panels start ${Math.round(strip.left)}px across and ${Math.round(strip.top)}px down, where the title ends ${Math.round(name.right)}px across and ${Math.round(name.bottom)}px down`;
			},
			{ beside: BESIDE, below: BELOW },
		);

	const expectTheGatefold = async (
		page: Page,
		reads: string,
		state: string,
	) => {
		await expect
			.poll(() => whereThePanelsSit(page), { message: `sidebar ${state}` })
			.toBe(reads);

		await page.waitForTimeout(PAST_THE_COLUMN_TRANSITION_MS);
		expect(await whereThePanelsSit(page), `sidebar ${state}`).toBe(reads);
	};

	test("leaves the sidebar beside it rather than covering it, shown or hidden", async ({
		page,
	}) => {
		await openLibrary(page);
		await openSidebar(page);
		await openNowPlaying(page);

		await expectItClearsTheSidebar(page, "shown");

		await sidebarToggle(page).click();
		await expectItClearsTheSidebar(page, "hidden");
	});

	// The two controls belong to `keyboard.spec.ts` and this reading does not:
	// whether the key moves the screen or only collapses the column behind it is
	// a question about two boxes, and `whereTheScreenStarts` is the only thing in
	// the suite that can answer it. A collapsed sidebar is `aria-hidden`, so the
	// row queries below go quiet whichever of the two happened, which is why the
	// pair came apart in the first place and why both readings are taken on every
	// leg: the rows for whether the control acted at all, the boxes for whether
	// the screen went with it.
	//
	// One test rather than one each, because agreeing is the criterion: two tests
	// holding each control to its own expectation would both stay green while the
	// pair came apart. Each control is driven in both directions, since a control
	// that only ever revealed would satisfy a test that only ever revealed.
	test("the icon and Mod+B move the screen the same way, and neither closes it", async ({
		page,
	}) => {
		await openLibrary(page);
		await openSidebar(page);
		await openNowPlaying(page);
		const home = sidebar(page).getByRole("button", { name: "Home" });

		// The screen first on every leg: a control that dismissed it takes its exit
		// animation to leave, so the boxes read as flush for a frame or two and
		// then the screen is not there to measure at all. Asked in this order the
		// failure says the screen closed, rather than that it went missing.
		await page.keyboard.press("ControlOrMeta+b");
		await expectTheScreenIsStillOpen(page);
		await expect(home).toBeHidden();
		await expectItClearsTheSidebar(page, "hidden by the key");

		await page.keyboard.press("ControlOrMeta+b");
		await expectTheScreenIsStillOpen(page);
		await expect(home).toBeVisible();
		await expectItClearsTheSidebar(page, "shown by the key");

		await sidebarToggle(page).click();
		await expectTheScreenIsStillOpen(page);
		await expect(home).toBeHidden();
		await expectItClearsTheSidebar(page, "hidden by the icon");

		await sidebarToggle(page).click();
		await expectTheScreenIsStillOpen(page);
		await expect(home).toBeVisible();
		await expectItClearsTheSidebar(page, "shown by the icon");
	});

	test("moves when the sidebar is hidden, and stays open, scrolled and on the same tab", async ({
		page,
	}) => {
		await playRow(page, LYRIC_ROW);
		await openSidebar(page);

		const screen = nowPlayingScreen(page);
		await panelTab(screen, "Lyrics").click();

		// A line rather than a scroll offset. Widening the screen rewraps the
		// lyric, and the browser then holds the reader in place by moving the
		// offset, so the number is allowed to change where what is on screen is
		// not.
		const mark = page.getByText(MARK, { exact: true });
		await mark.evaluate((line) => {
			line.scrollIntoView({ block: "center" });
		});
		await expect(mark).toBeInViewport();

		const before = await screenStartsAt(page);
		await sidebarToggle(page).click();

		await expect
			.poll(() => screenStartsAt(page), {
				message: "the screen takes the column the sidebar gave up",
			})
			.not.toBe(before);

		await expect(page).toHaveURL(/#\/playing\/lyrics$/);
		await expect(screen).toBeVisible();
		await expect(mark).toBeInViewport();
		await expectPanelOpen(screen, "Lyrics");
	});

	test("collapses to one leaf when the sidebar narrows it, at a viewport wide enough for two", async ({
		page,
	}) => {
		await playRow(page, 0);
		await openSidebar(page);

		await page.setViewportSize({
			width: await insideTheWindow(page),
			height: page.viewportSize()!.height,
		});

		await sidebarToggle(page).click();
		await expectTheGatefold(page, BESIDE, "hidden");

		await sidebarToggle(page).click();
		await expectTheGatefold(page, BELOW, "shown");
	});

	// The JS compact flag and `.body`'s single column both switch at 860px,
	// `useMediaQuery.ts` and `App.module.css`, so one pixel above it is the
	// narrowest viewport that still gets the desktop layout. Less the sidebar
	// column the screen is drawn at around 600px, which is as narrow as it ever
	// gets on a desktop and a width a real window reaches.
	const COMPACT_THRESHOLD = 860;
	const NARROWEST_DESKTOP = COMPACT_THRESHOLD + 1;

	const NOTHING_STICKS_OUT = "nothing reaches past the screen's edges";

	// The screen is `overflow-x: clip`, so sideways overflow never announces
	// itself with a scrollbar: it is cut off, silently, and whatever was out
	// there is gone. The boxes are the reading, against the screen's own.
	const whatSticksOutSideways = (page: Page) =>
		page.evaluate((clear) => {
			const screen = document.querySelector("[data-now-playing]");
			if (!screen) throw new Error("the screen is meant to be open");
			const box = screen.getBoundingClientRect();

			const drawn = Array.from(screen.querySelectorAll("*"))
				.map((node) => ({ node, rect: node.getBoundingClientRect() }))
				.filter(({ rect }) => rect.width > 0 && rect.height > 0);
			// A screen that laid nothing out would satisfy a walk over nothing.
			if (drawn.length === 0) return "the screen has nothing laid out in it";

			// A pixel of slack: a box laid out on a fractional boundary rounds out.
			const out = drawn.find(
				({ rect }) => rect.right > box.right + 1 || rect.left < box.left - 1,
			);
			if (!out) return clear;

			const name =
				out.node.getAttribute("aria-label") ??
				out.node.textContent?.trim().slice(0, 40) ??
				out.node.tagName.toLowerCase();
			return `${name} runs from ${Math.round(out.rect.left)}px to ${Math.round(out.rect.right)}px, where the screen runs ${Math.round(box.left)}px to ${Math.round(box.right)}px`;
		}, NOTHING_STICKS_OUT);

	const ALL_REACHABLE = "every control in the head takes a press";

	// Reachable is not visible and is not on screen: a control the screen has
	// clipped, one another element covers and one pushed past the edge all still
	// report a box. What a pointer and a finger both go through is the hit test,
	// so the question is what the browser hands a press in the middle of each
	// control.
	const whatTheHeadRefuses = (page: Page) =>
		page.evaluate((clear) => {
			const head = document.querySelector("[data-now-playing] header");
			if (!head) throw new Error("the screen is meant to have a head");

			const controls = head.querySelectorAll("button");
			// A head that emptied would satisfy a walk over nothing.
			if (controls.length === 0) return "the head has no controls at all";

			for (const control of controls) {
				const rect = control.getBoundingClientRect();
				const hit = document.elementFromPoint(
					rect.left + rect.width / 2,
					rect.top + rect.height / 2,
				);
				if (hit && control.contains(hit)) continue;

				const name =
					control.getAttribute("aria-label") ??
					control.textContent?.trim().slice(0, 40) ??
					"a head control";
				const over = hit
					? `${hit.tagName.toLowerCase()} is over it`
					: "nothing is there";
				return `a press at the middle of ${name} lands nowhere: ${over}`;
			}
			return clear;
		}, ALL_REACHABLE);

	test("draws one leaf at its narrowest desktop width, with nothing cut off sideways and every head control still pressable", async ({
		page,
	}) => {
		await playRow(page, 0);
		await openSidebar(page);

		await page.setViewportSize({
			width: NARROWEST_DESKTOP,
			height: page.viewportSize()!.height,
		});

		// Measured rather than written down, so widening the sidebar moves this
		// case with it rather than leaving it asserting a width nothing has.
		const column = (await sidebar(page).boundingBox())!;
		const narrowest = NARROWEST_DESKTOP - Math.round(column.width);
		await expect
			.poll(
				() =>
					nowPlayingScreen(page).evaluate((node) =>
						Math.round(node.getBoundingClientRect().width),
					),
				{ message: "the screen is the viewport less the sidebar column" },
			)
			.toBe(narrowest);

		await expectTheGatefold(page, BELOW, "shown");

		await expect
			.poll(() => whatSticksOutSideways(page), { message: "at its narrowest" })
			.toBe(NOTHING_STICKS_OUT);
		await expect
			.poll(() => whatTheHeadRefuses(page), { message: "at its narrowest" })
			.toBe(ALL_REACHABLE);
	});
});

test.describe("the screen a phone gets", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the gatefold is a pane inside the shell, which is the point of it",
	);

	test("is the whole viewport, the app chrome included", async ({ page }) => {
		await openLibrary(page);
		await openNowPlaying(page);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const view = page.viewportSize()!;
		expect(box.y, "the screen starts below the top bar").toBe(0);
		expect(box.height).toBeGreaterThanOrEqual(view.height);
	});

	const COVERED = "the screen reaches all four edges of the viewport";

	const whereTheScreenStops = (page: Page) =>
		page.evaluate((covered) => {
			const screen = document.querySelector("[data-now-playing]");
			if (!screen) throw new Error("the screen is meant to be open");

			const box = screen.getBoundingClientRect();
			const short = [
				box.left > 0 && `${Math.round(box.left)}px in from the left`,
				box.top > 0 && `${Math.round(box.top)}px down from the top`,
				box.right < window.innerWidth &&
					`${Math.round(window.innerWidth - box.right)}px short of the right`,
				box.bottom < window.innerHeight &&
					`${Math.round(window.innerHeight - box.bottom)}px short of the bottom`,
			].filter((edge): edge is string => edge !== false);

			return short.length === 0
				? covered
				: `the screen stops ${short.join(", ")}`;
		}, COVERED);

	const DRAWER_ON_TOP = "the drawer takes a press at its middle";

	// Which of two overlapping fixed boxes is on top is not in either box, so
	// this asks the browser the way a finger does. The drawer is two elements
	// and only one of them is the question: `Sidebar.module.css` gives the
	// sliding panel `z-index: 40` at 320px wide and its scrim `z-index: 39`
	// across the whole viewport, and the screen is meant to be under the panel
	// and over nothing. Measuring the scrim would be measuring the wrong
	// element, and the scrim winning this hit test means the panel has fallen
	// below it, which is why the panel's own stacking is in the message.
	const whatCoversTheDrawer = (page: Page) =>
		page.evaluate((clear) => {
			const drawer = document.querySelector('nav[aria-label="Playlists"]');
			if (!drawer) throw new Error("the drawer is meant to be open");

			const box = drawer.getBoundingClientRect();
			const hit = document.elementFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2,
			);
			if (hit && drawer.contains(hit)) return clear;
			if (!hit) return "nothing is at the middle of the drawer";

			const name = hit.closest("[data-now-playing]")
				? "the now-playing screen"
				: (hit.getAttribute("aria-label") ?? hit.tagName.toLowerCase());
			const stack = getComputedStyle(drawer).zIndex;
			return `${name} is over the drawer, which stacks at ${stack}`;
		}, DRAWER_ON_TOP);

	// Nothing here is being changed, and that is the point of it. The 860px
	// crossing is enforced twice, by the JS flag behind `data-compact` and by
	// `.body`'s own media query, and either file goes on looking correct while
	// the two disagree. This is what catches them parting company. Both readings
	// are taken with the drawer open, the state the case above does not reach.
	test("covers the viewport edge to edge, and stays open under the drawer", async ({
		page,
	}) => {
		await openLibrary(page);
		await openNowPlaying(page);

		// The keyboard, because there is nothing to press: on a phone the screen
		// covers the sidebar icon, deliberately.
		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebar(page)).toBeVisible();

		await expect(page).toHaveURL(/#\/playing$/);
		await expect(nowPlayingScreen(page)).toBeVisible();
		await expect
			.poll(() => whereTheScreenStops(page), {
				message: "with the drawer open",
			})
			.toBe(COVERED);
		await expect.poll(() => whatCoversTheDrawer(page)).toBe(DRAWER_ON_TOP);
	});

	const ICON_TAKES_IT = "the sidebar icon takes a press at its middle";
	const SCREEN_OVER_IT = "the now-playing screen is over the sidebar icon";

	// Reachable is a hit test rather than a box or a visibility check: the icon
	// keeps its place in the top bar with the screen over it, so it goes on
	// reporting a box and answering to visible while a finger lands on the screen.
	const whatTakesAPressOnTheIcon = (page: Page) =>
		page.evaluate(
			(reads) => {
				const icon = document.querySelector(
					'button[aria-label="Show playlists"], button[aria-label="Hide playlists"]',
				);
				if (!icon)
					throw new Error("the top bar is meant to carry the sidebar icon");

				const box = icon.getBoundingClientRect();
				const hit = document.elementFromPoint(
					box.left + box.width / 2,
					box.top + box.height / 2,
				);
				if (hit && icon.contains(hit)) return reads.icon;
				if (!hit) return "nothing is at the middle of the sidebar icon";
				return hit.closest("[data-now-playing]")
					? reads.screen
					: `${hit.getAttribute("aria-label") ?? hit.tagName.toLowerCase()} is over the sidebar icon`;
			},
			{ icon: ICON_TAKES_IT, screen: SCREEN_OVER_IT },
		);

	// The asymmetry is deliberate and reads like an oversight, which is why it is
	// asserted rather than left out: on a phone the screen covers the icon, so the
	// key is the only way to the sidebar and the icon comes back the moment the
	// screen goes.
	test("covers the sidebar icon, so Mod+B is the only way in", async ({
		page,
	}) => {
		await openLibrary(page);
		await openNowPlaying(page);
		await expect
			.poll(() => whatTakesAPressOnTheIcon(page))
			.toBe(SCREEN_OVER_IT);

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebar(page)).toBeVisible();
		await expect(page).toHaveURL(/#\/playing$/);
		await expect(nowPlayingScreen(page)).toBeVisible();

		await closeSidebar(page);
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		await expect(nowPlayingScreen(page)).toBeHidden();
		await expect.poll(() => whatTakesAPressOnTheIcon(page)).toBe(ICON_TAKES_IT);
	});

	test("Play is lifted off the bottom edge where there is height to spare", async ({
		page,
	}) => {
		await playRow(page, 0);

		const play = nowPlayingScreen(page).getByRole("button", {
			name: /^(Play|Pause)$/,
		});
		const clearance = async () => {
			const box = (await play.boundingBox())!;
			return page.viewportSize()!.height - (box.y + box.height);
		};

		const tall = await clearance();

		// Polled: the box reads back before the media query the resize crossed has
		// relaid the screen out.
		await page.setViewportSize({ width: 375, height: 667 });
		await expect
			.poll(clearance, {
				message: "a phone this short keeps its pixels for the artwork",
			})
			.toBeLessThan(tall);

		expect(
			await clearance(),
			"and the transport is never pushed off the edge",
		).toBeGreaterThan(0);
	});

	test("Play is in the middle of the row, whatever flanks it", async ({
		page,
	}) => {
		await playRow(page, 0);

		const screen = nowPlayingScreen(page);
		const play = (await screen
			.getByRole("button", { name: /^(Play|Pause)$/ })
			.boundingBox())!;
		// The screen's padding is symmetrical, so the middle of the row is the
		// middle of the viewport.
		const view = page.viewportSize()!;
		const centre = play.x + play.width / 2;
		expect(
			Math.abs(centre - view.width / 2),
			`Play is centred at ${Math.round(centre)}px of ${view.width}px`,
		).toBeLessThanOrEqual(1);
	});
});

test.describe("a control that follows the finger keeps the gesture", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the transport is compact-only, and this is touch",
	);

	test("the fader can be dragged down without dismissing the screen", async ({
		page,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await screen.getByRole("button", { name: "Show volume" }).click();
		const fader = page.getByRole("slider", { name: /Volume/ });
		const box = (await fader.boundingBox())!;
		const x = box.x + box.width / 2;

		// Well past the 60px a flick has to travel, downwards, which is the
		// gesture that dismisses the screen everywhere else on it.
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.15 },
			{ x, y: box.y + box.height * 0.85 },
		);

		await expect(page).toHaveURL(/#\/playing$/);
		await expect(screen).toBeVisible();

		const landed = Number(await fader.getAttribute("aria-valuenow"));
		expect(landed, `fader landed at ${landed}%, aimed at 15%`).toBeLessThan(40);
	});

	test("the seek bar can be scrubbed without skipping the track", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);
		const playing = player.player.activeItem.index;

		const bar = screen.getByRole("slider", { name: "Playback position" });
		// The bar is drawn before the track's length arrives, and until it does
		// there is nothing to seek within, so a scrub commits nothing at all.
		await expect(bar).toHaveAttribute("aria-valuemax", /^[1-9][0-9]*$/);
		const box = (await bar.boundingBox())!;
		const y = box.y + box.height / 2;
		await touchDrag(
			page,
			{ x: box.x + box.width * 0.75, y },
			{ x: box.x + box.width * 0.2, y },
		);

		expect(player.player.activeItem.index).toBe(playing);
		await expect
			.poll(() =>
				requestsTo(player, "/api/playback/seek").filter(
					(entry) =>
						entry.method === "POST" && entry.body?.seconds !== undefined,
				),
			)
			.toHaveLength(1);
	});
});

test.describe("skipping with a flick", () => {
	test.skip(({ isMobile }) => !isMobile, "this is the touch gesture");

	const flick = async (page: Page, from: number, to: number) => {
		const box = (await nowPlayingScreen(page).boundingBox())!;
		const y = box.y + box.height * 0.4;
		await touchDrag(
			page,
			{ x: box.x + box.width * from, y },
			{ x: box.x + box.width * to, y },
		);
	};

	// Not `@iphone`: the finger is driven through CDP, which Playwright has only
	// for Chromium, so the gesture cannot run under WebKit at all.
	test("leftwards is the next track and rightwards is the one before", async ({
		page,
		player,
		browserName,
	}) => {
		test.skip(browserName !== "chromium", "a finger is driven through CDP");

		await playRow(page, 0);
		await expect.poll(() => player.player.activeItem.index).toBe(0);

		await flick(page, 0.8, 0.2);
		await expect.poll(() => player.player.activeItem.index).toBe(1);

		await flick(page, 0.2, 0.8);
		await expect.poll(() => player.player.activeItem.index).toBe(0);
	});

	test("upwards opens the panels, and the screen stays where it was", async ({
		page,
		player,
	}) => {
		await playRow(page, 0);

		const box = (await nowPlayingScreen(page).boundingBox())!;
		const x = box.x + box.width / 2;
		await touchDrag(
			page,
			{ x, y: box.y + box.height * 0.5 },
			{ x, y: box.y + box.height * 0.5 - 120 },
		);

		await expect(trackInfo(page)).toBeVisible();
		expect(player.player.activeItem.index).toBe(0);
		await expect(page).toHaveURL(/#\/playing$/);
	});
});

test.describe("Previous", () => {
	const previous = (page: Page) =>
		page.getByRole("button", { name: "Previous track" });

	const at = (page: Page) =>
		page
			.getByRole("slider", { name: "Playback position" })
			.getAttribute("aria-valuenow")
			.then(Number);

	test("restarts a track that has been playing a while", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);
		player.patchPlayer({ position: 60 });
		await expect.poll(() => at(page)).toBeGreaterThanOrEqual(60);

		await previous(page).click();

		await expect.poll(() => at(page)).toBeLessThan(5);
		expect(player.player.activeItem.index).toBe(1);
		expect(requestsTo(player, "/api/playback/previous")).toHaveLength(0);
	});

	test("steps back from a track that has only just started", async ({
		page,
		player,
	}) => {
		await playRow(page, 1);

		await previous(page).click();

		await expect.poll(() => player.player.activeItem.index).toBe(0);
	});
});

test.describe("a stop", () => {
	test("says nothing is playing", async ({ page, player }) => {
		await playRow(page, 0);

		player.stop();

		await expect(nowPlayingScreen(page).locator("h1")).toHaveText(
			"Nothing playing",
		);
	});
});

test.describe("the panel is part of the address", () => {
	test.skip(({ isMobile }) => isMobile, "the panels are a sheet on a phone");

	test("opening one puts it there, so the screen can be linked to", async ({
		page,
	}) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await panelTab(screen, "Details").click();
		await expect(page).toHaveURL(/#\/playing\/details$/);

		await panelTab(screen, "Lyrics").click();
		await expect(page).toHaveURL(/#\/playing\/lyrics$/);
	});

	test("a link straight to one opens on it", async ({ page }) => {
		await playRow(page, 0);

		await page.goto("/#/playing/details");
		await expect(nowPlayingScreen(page)).toBeVisible();
		await expectPanelOpen(nowPlayingScreen(page), "Details");
	});

	test("choosing a panel does not fill the history", async ({ page }) => {
		await playRow(page, 0);
		const screen = nowPlayingScreen(page);

		await panelTab(screen, "Details").click();
		await expect(page).toHaveURL(/#\/playing\/details$/);
		await panelTab(screen, "Artist").click();
		await expect(page).toHaveURL(/#\/playing\/artist$/);

		await page.goBack();
		await expect(screen).toBeHidden();
	});
});

// Not looking like a streaming client. Every reference pulls a colour out of the artwork and centres
// the title under a centred square, which is what makes them interchangeable; the cover is the only
// colour on this screen and the identity is set flush left, like the back of a sleeve.
test.describe("not looking like a streaming client", () => {
	const JESSICO = { row: 0, title: "Los Calientes", album: "Jessico" };

	// Two records whose sleeves share nothing, both unrated, and neither track first or last in the
	// list, so each has a sleeve on either side of it in a phone's wheel and every other difference
	// on the screen is words.
	const ON_JESSICO = 1;
	const ON_DEJA_ENTENDU = 13;

	// The sleeves the screen has finished drawing, by address. On a phone the wheel holds a
	// neighbour's sleeve beside the playing one.
	const drawnCovers = (page: Page) =>
		nowPlayingScreen(page).evaluate((screen) =>
			Array.from(screen.querySelectorAll("img"))
				.filter(
					(image) =>
						image.complete &&
						image.naturalWidth > 0 &&
						image.getBoundingClientRect().width > 0,
				)
				.map((image) => image.src),
		);

	const untilACoverIsDrawn = (page: Page, besides: string[] = []) =>
		expect
			.poll(async () =>
				(await drawnCovers(page)).some((src) => !besides.includes(src)),
			)
			.toBe(true);

	// Every colour the screen paints with, cover images aside. An address inside a background is
	// written out as `url()`, so a picture changing is not read as a colour changing.
	const coloursOnTheScreen = (page: Page) =>
		nowPlayingScreen(page).evaluate((screen) => {
			const seen = new Set<string>();
			for (const node of [
				screen,
				...Array.from(screen.querySelectorAll("*")),
			]) {
				if (node instanceof HTMLImageElement) continue;
				const style = getComputedStyle(node);
				for (const value of [
					style.color,
					style.backgroundColor,
					style.backgroundImage.replace(/url\([^)]*\)/g, "url()"),
					style.borderTopColor,
					style.boxShadow,
					style.fill,
				])
					seen.add(value);
			}
			return Array.from(seen).sort();
		});

	test("takes no colour from the artwork", async ({ page, player }) => {
		await playRow(page, ON_JESSICO);
		await untilACoverIsDrawn(page);
		await untilQuiet(player);
		const jessico = await drawnCovers(page);
		const withJessico = await coloursOnTheScreen(page);

		const { playlistId } = player.player.activeItem;
		player.playItem(playlistId, ON_DEJA_ENTENDU);
		const next = player.playlistById(playlistId)?.items[ON_DEJA_ENTENDU];
		await expect(
			nowPlayingScreen(page).getByRole("heading", {
				level: 1,
				name: next?.["%title%"],
			}),
		).toBeVisible();
		await untilACoverIsDrawn(page, jessico);
		await untilQuiet(player);

		expect(await coloursOnTheScreen(page)).toEqual(withJessico);
	});

	// Where each line's words begin, and where the box they sit in begins.
	const setAt = (line: Locator) =>
		line.evaluate((element) => {
			const words = document.createRange();
			words.selectNodeContents(element);
			return {
				text: Math.round(words.getBoundingClientRect().left),
				box: Math.round(element.getBoundingClientRect().left),
			};
		});

	test("sets the title, the artist and the record flush left", async ({
		page,
	}) => {
		await playRow(page, JESSICO.row);
		const screen = nowPlayingScreen(page);
		const title = await setAt(
			screen.getByRole("heading", { level: 1, name: JESSICO.title }),
		);
		// The first: the identity comes before the panels, which may name the artist again.
		const artist = await setAt(
			screen.getByRole("link", { name: "Babasónicos" }).first(),
		);
		const record = await setAt(
			screen.getByRole("link", { name: JESSICO.album }).first(),
		);

		// A centred title starts somewhere inside its own line, and centred lines of different
		// lengths start in different places.
		expect(title.text).toBe(title.box);
		expect(artist.text).toBe(title.text);
		expect(record.text).toBe(title.text);
	});

	// Artwork plus two lines is the streaming client's mini-player exactly, and the cover is one
	// dismissal away at full size.
	test("keeps the slim strip over the panels to the title and the artist, with no thumbnail", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the slim strip is the phone's layer; a desktop's panels sit beside the cover",
		);

		await playRow(page, JESSICO.row);
		// Held before the layer opens, so a copy in the strip would be drawn with it rather than after.
		await untilACoverIsDrawn(page);

		await nowPlayingScreen(page)
			.getByRole("button", { name: "Lyrics" })
			.click();
		const strip = trackInfo(page);
		await expect(strip).toBeVisible();
		await expect(strip).toContainText(JESSICO.title);
		await expect(strip).toContainText("Babasónicos");

		// Read once any cover the strip asked for has had time to arrive and be drawn.
		await untilQuiet(player);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		expect(await strip.locator('img, [role="img"]').count()).toBe(0);
	});
});
