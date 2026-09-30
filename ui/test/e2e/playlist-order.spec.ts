import { compareText } from "../fake-api/playerOrder.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	holdThePoll,
	openAllMusic,
	openLibrary,
	pressAndHold,
	scrollTop,
	test,
	times,
	titlesIn,
	touchDrag,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";

// Twelve rows of one album in track order, so a sort by title reorders every one of them.
const SPANISH = "p5";
const AUTOPLAYLIST = "p9";

const SORT_HEADING = "Reorders the playlist in foobar2000";
const ORDERINGS = ["Album", "Artist", "Title", "Release date"];

const PATTERNS: Record<string, string> = {
	Album: "%album%|%discnumber%|%tracknumber%",
	Artist: "%album artist%|%date%|%album%|%discnumber%|%tracknumber%",
	Title: "%title%|%artist%",
	"Release date": "%date%|%album artist%|%album%|%discnumber%|%tracknumber%",
};

// Where the pointer is held over a row. Below a row's centre is past it going down, and above is
// before it going up, whether a neighbour makes room when the dragged row's centre crosses its
// edge or its centre: the two readings agree only there.
const BELOW_CENTRE = 0.75;

// Every playlist the fake mints starts here: `GENERATION_SEED` in `test/fake-api/state.ts`.
const STRUCTURE_AT_LOAD = "9204739866101318656";

const titleOf = (player: FakePlayer, key: string) =>
	player.playlists.find((entry) => entry.id === key)!.title;

const openPlaylist = async (page: Page, player: FakePlayer, key: string) => {
	await page.goto(`/#/${guidOfPlaylist(player, key)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: titleOf(player, key) }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
	return titlesIn(player, key).map(String);
};

// The order the list draws, read by the fixture's own titles rather than by a cell's markup: each
// row is named by the longest title of the playlist its text holds, and null where it is not drawn.
const shownOrder = async (page: Page, titles: string[], count: number) => {
	const texts = await page.evaluate(
		(count) =>
			Array.from(
				{ length: count },
				(_, at) =>
					document.querySelector(`main [role="row"][data-row="${at}"]`)
						?.textContent ?? null,
			),
		count,
	);
	const longestFirst = [...titles].sort((a, b) => b.length - a.length);
	return texts.map((text) =>
		text === null
			? null
			: (longestFirst.find((title) => text.includes(title)) ?? text),
	);
};

const postsTo = (player: FakePlayer, key: string, edit: "move" | "sort") =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			entry.path ===
				`/api/playlists/${guidOfPlaylist(player, key)}/items/${edit}`,
	);

const anyRowEdit = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" &&
			/^\/api\/playlists\/[^/]+\/items\/(move|sort)$/.test(entry.path),
	);

const rowReads = (player: FakePlayer, key: string) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] ===
				`/api/playlists/${guidOfPlaylist(player, key)}/items`,
	);

// Resolves once Jean has been told the playlist's structure as it stands at the player. A read the
// new structure prompts comes after this, so a count taken before it has not settled.
const listCarriesTheEdit = (page: Page, player: FakePlayer, key: string) =>
	page.waitForResponse(
		async (response) => {
			if (response.request().method() !== "GET") return false;
			if (new URL(response.url()).pathname !== "/api/playlists") return false;
			const playlist = player.playlists.find((entry) => entry.id === key)!;
			const listed = (
				(await response.json().catch(() => null)) as {
					playlists?: { id: string; structure: string }[];
				} | null
			)?.playlists?.find((entry) => entry.id === playlist.guid);
			return (
				listed?.structure === String(playlist.structure) &&
				playlist.structure !== BigInt(STRUCTURE_AT_LOAD)
			);
		},
		{ timeout: 15_000 },
	);

const control = async (page: Page, action: string, data: object) => {
	const answered = await page.request.post(`/__control/${action}`, { data });
	expect(answered.ok(), `the fake needs /__control/${action}`).toBe(true);
};

// The fake applies a playlist edit this long after it arrives, so what the list draws before the
// player has answered can be told from what it draws after.
const ANSWER_DELAY_MS = 3000;

const slowThePlayer = (page: Page) =>
	control(page, "latency", { ms: ANSWER_DELAY_MS });

const toast = (page: Page) => page.getByRole("status");

const sortButton = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Sort", exact: true });

// Asserted first, so a missing control fails on the assertion rather than on the test's timeout.
const sortBy = async (page: Page, ordering: string) => {
	await expect(sortButton(page)).toBeVisible();
	await sortButton(page).click();
	await page.getByRole("menuitem", { name: ordering, exact: true }).click();
};

const grip = (row: Locator) =>
	row.getByRole("button", { name: "Drag to reorder" });

// Absent rather than hidden: a grip drawn at no opacity is still a control somebody can reach.
const anyGrip = (page: Page) =>
	page
		.locator("main")
		.getByRole("button", { name: "Drag to reorder", includeHidden: true });

// Whether a person can see it. Playwright counts an element at zero opacity as visible, and a grip
// shown on hover is usually faded rather than removed, so the opacity is read up the tree.
const isSeen = (locator: Locator) =>
	locator.evaluateAll((elements) => {
		if (elements.length !== 1) return false;
		const element = elements[0] as HTMLElement;
		const box = element.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return false;
		if (getComputedStyle(element).visibility === "hidden") return false;
		for (let at: HTMLElement | null = element; at; at = at.parentElement)
			if (Number(getComputedStyle(at).opacity) === 0) return false;
		return true;
	});

const expectAtTrailingEdge = async (row: Locator) => {
	const rowBox = (await row.boundingBox())!;
	const gripBox = (await grip(row).boundingBox())!;
	const gap = rowBox.x + rowBox.width - (gripBox.x + gripBox.width);
	expect(gap, "something sits between the grip and the row's end").toBeLessThan(
		gripBox.width,
	);
	expect(gap).toBeGreaterThanOrEqual(0);
};

// Away from the leading index and the trailing grip, so these drags are of the row itself.
const pointOver = async (row: Locator, fraction: number) => {
	const box = (await row.boundingBox())!;
	return { x: box.x + box.width * 0.4, y: box.y + box.height * fraction };
};

// Every point is read before the press: once a drag starts the rows making room have moved.
const dragRow = async (
	page: Page,
	from: number,
	onto: number,
	fraction = BELOW_CENTRE,
) => {
	const start = await pointOver(trackRow(page, from), 0.5);
	const end = await pointOver(trackRow(page, onto), fraction);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 12 });
	await page.mouse.up();
};

const movedFirstBelowThird = (before: string[]) => [
	before[1],
	before[2],
	before[0],
	...before.slice(3),
];

// Past the long press a row's sheet opens on, so a press that lets it through is seen doing so.
const PICK_UP_HOLD_MS = 600;

// A finger held still on a point, then dragged, through CDP as `touchDrag` in `fixtures.ts` is and
// for the same reason: the browser's own reading of the gesture is what is under test.
const holdThenDrag = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 10,
) => {
	const cdp = await page.context().newCDPSession(page);
	const send = (
		type: "touchStart" | "touchMove" | "touchEnd",
		point: { x: number; y: number },
	) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [point],
			timestamp: Date.now() / 1000,
		});

	await send("touchStart", from);
	await page.waitForTimeout(PICK_UP_HOLD_MS);
	await times(steps, (step) => {
		const at = (step + 1) / steps;
		return send("touchMove", {
			x: from.x + (to.x - from.x) * at,
			y: from.y + (to.y - from.y) * at,
		});
	});
	await send("touchEnd", to);
	await cdp.detach();
};

const pressUntilFocused = async (page: Page, target: Locator, left = 6) => {
	if (await target.evaluate((element) => element === document.activeElement))
		return;
	if (left === 0) return;
	await page.keyboard.press("ArrowDown");
	await pressUntilFocused(page, target, left - 1);
};

test.use({ settings: { "jean.layout": "compact" } });

test.describe("dragging a row with a mouse", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"a mouse drag is the fine-pointer path; a finger reorders through the grip",
	);

	test("a row dropped between two others lands there at the player, is drawn there before the player answers, and costs one move and no read of the rows", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];
		const moved = movedFirstBelowThird(before);
		await untilQuiet(player);
		const readsBefore = rowReads(player, SPANISH).length;
		await slowThePlayer(page);
		const caughtUp = listCarriesTheEdit(page, player, SPANISH);

		await dragRow(page, 0, 2);

		// Read together: a list that waits for the player's answer never draws the new order while
		// the player still holds the old one.
		await expect
			.poll(async () => ({
				shown: await shownOrder(page, titles, 6),
				atThePlayer: titlesIn(player, SPANISH).slice(0, 6),
			}))
			.toEqual({ shown: moved.slice(0, 6), atThePlayer: before.slice(0, 6) });
		await control(page, "latency", { ms: 0 });

		await expect.poll(() => titlesIn(player, SPANISH)).toEqual(moved);
		await caughtUp;
		await expectSettlesAt(
			player,
			() => postsTo(player, SPANISH, "move").length,
			1,
		);
		expect(await shownOrder(page, titles, 8)).toEqual(moved.slice(0, 8));
		// A new structure is a new key for the rows, and a list that reads them again at it has
		// thrown away the order it already drew.
		expect(rowReads(player, SPANISH)).toHaveLength(readsBefore);
	});

	test("a selection that is not contiguous lands as one block where it was dropped, in the order it had", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];

		await trackRow(page, 0).click();
		await trackRow(page, 2).click({ modifiers: ["ControlOrMeta"] });
		await trackRow(page, 4).click({ modifiers: ["ControlOrMeta"] });
		await expect(trackRow(page, 4)).toHaveAttribute("aria-selected", "true");

		await dragRow(page, 2, 6);

		const landed = [
			before[1],
			before[3],
			before[5],
			before[6],
			before[0],
			before[2],
			before[4],
			...before.slice(7),
		];
		await expect.poll(() => titlesIn(player, SPANISH)).toEqual(landed);
		await expect
			.poll(() => shownOrder(page, titles, 9))
			.toEqual(landed.slice(0, 9));
		await expectSettlesAt(
			player,
			() => postsTo(player, SPANISH, "move").length,
			1,
		);
	});

	test("the row the dragged one will land before is marked, and the mark moves as it crosses each neighbour", async ({
		page,
		player,
	}) => {
		await openPlaylist(page, player, SPANISH);
		const marked = page.locator('main [role="row"][data-drop-line]');

		const start = await pointOver(trackRow(page, 0), 0.5);
		const pastSecond = await pointOver(trackRow(page, 2), BELOW_CENTRE);
		const pastFourth = await pointOver(trackRow(page, 4), BELOW_CENTRE);

		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(pastSecond.x, pastSecond.y, { steps: 12 });
		await expect(trackRow(page, 3)).toHaveAttribute("data-drop-line");
		await expect(marked).toHaveCount(1);

		await page.mouse.move(pastFourth.x, pastFourth.y, { steps: 12 });
		await expect(trackRow(page, 5)).toHaveAttribute("data-drop-line");
		await expect(marked).toHaveCount(1);

		await page.mouse.up();
	});

	// Measured as the distance between the marked row and the one before it, so either way of opening
	// the gap passes: the rows the dragged one passed moving up, or the rows from the gap on moving down.
	test("the rows make room where the dragged row will land, and close again once it drops", async ({
		page,
		player,
	}) => {
		await openPlaylist(page, player, SPANISH);
		const aboveGap = trackRow(page, 4);
		const atGap = trackRow(page, 5);
		const rowHeight = (await aboveGap.boundingBox())!.height;
		// In row heights, to a twentieth of one, since row boxes land on fractional pixels.
		const spacing = async () =>
			((await atGap.boundingBox())!.y - (await aboveGap.boundingBox())!.y) /
			rowHeight;
		expect(await spacing()).toBeCloseTo(1, 1);

		const start = await pointOver(trackRow(page, 0), 0.5);
		const pastFourth = await pointOver(aboveGap, BELOW_CENTRE);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(pastFourth.x, pastFourth.y, { steps: 12 });
		await expect(atGap).toHaveAttribute("data-drop-line");

		await expect
			.poll(spacing, { message: "no gap opened where the row will land" })
			.toBeCloseTo(2, 1);

		// Row 1 has slid into row 0's slot by now, and rows are drawn without a background, so a
		// dragged row left there shows both titles on top of each other.
		const dragged = trackRow(page, 0);
		const slidIn = trackRow(page, 1);
		const overlap = async () => {
			if (!(await isSeen(dragged))) return 0;
			const a = (await dragged.boundingBox())!;
			const b = (await slidIn.boundingBox())!;
			return Math.max(
				0,
				Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
			);
		};
		await expect
			.poll(overlap, {
				message:
					"the dragged row still shows in the slot the next row slid into",
			})
			.toBeLessThan(1);

		await page.mouse.up();
		await expect
			.poll(spacing, { message: "the gap stayed open after the drop" })
			.toBeCloseTo(1, 1);
	});

	test("a row held at the list's bottom edge scrolls it down, and at its top edge scrolls it back up", async ({
		page,
	}) => {
		await openLibrary(page);
		const list = (await page.locator("main").boundingBox())!;
		const start = await pointOver(trackRow(page, 0), 0.5);
		const x = start.x;
		const atTop = await scrollTop(page);

		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(x, list.y + list.height - 8, { steps: 12 });
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(atTop + 200);

		const down = await scrollTop(page);
		await page.mouse.move(x, list.y + 8, { steps: 12 });
		await expect.poll(() => scrollTop(page)).toBeLessThan(down - 200);

		await page.mouse.up();
	});

	// The row itself is what a mouse drags, and the cases above start from the middle of it; the grip
	// only says that it can be.
	test("only the hovered row shows its grip, and it sits at the row's trailing edge", async ({
		page,
		player,
	}) => {
		await openPlaylist(page, player, SPANISH);
		await page.mouse.move(1, 1);
		await expect.poll(() => isSeen(grip(trackRow(page, 1)))).toBe(false);

		await trackRow(page, 1).hover();
		await expect.poll(() => isSeen(grip(trackRow(page, 1)))).toBe(true);
		await expect.poll(() => isSeen(grip(trackRow(page, 2)))).toBe(false);
		await expectAtTrailingEdge(trackRow(page, 1));

		await trackRow(page, 2).hover();
		await expect.poll(() => isSeen(grip(trackRow(page, 2)))).toBe(true);
		await expect.poll(() => isSeen(grip(trackRow(page, 1)))).toBe(false);
	});

	test("a drop that leaves every row where it was sends nothing", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];

		const home = await pointOver(trackRow(page, 2), 0.5);
		const away = await pointOver(trackRow(page, 4), BELOW_CENTRE);

		await page.mouse.move(home.x, home.y);
		await page.mouse.down();
		await page.mouse.move(away.x, away.y, { steps: 12 });
		await expect(trackRow(page, 5)).toHaveAttribute("data-drop-line");
		await page.mouse.move(home.x, home.y, { steps: 12 });
		await page.mouse.up();

		// Past the threshold that starts a drag, and short of any neighbour.
		await page.mouse.move(home.x, home.y);
		await page.mouse.down();
		await page.mouse.move(home.x, home.y + 10, { steps: 4 });
		await page.mouse.up();

		await expectSettlesAt(player, () => anyRowEdit(player).length, 0);
		expect(await shownOrder(page, titles, 8)).toEqual(before.slice(0, 8));
	});
});

test.describe("on a touch screen", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the grip is always drawn only for a coarse pointer; a mouse drags the row",
	);

	test("every row carries a grip at its trailing edge, and dragging one moves that row alone", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];

		await expect.poll(() => isSeen(grip(trackRow(page, 0)))).toBe(true);
		await expect.poll(() => isSeen(grip(trackRow(page, 1)))).toBe(true);
		await expect(grip(trackRow(page, 0))).toHaveAttribute("data-owns-touch");
		await expectAtTrailingEdge(trackRow(page, 0));

		const handle = (await grip(trackRow(page, 0)).boundingBox())!;
		const onto = (await trackRow(page, 2).boundingBox())!;
		const x = handle.x + handle.width / 2;
		await touchDrag(
			page,
			{ x, y: handle.y + handle.height / 2 },
			{ x, y: onto.y + onto.height * BELOW_CENTRE },
			10,
		);

		const moved = movedFirstBelowThird(before);
		await expect.poll(() => titlesIn(player, SPANISH)).toEqual(moved);
		await expect
			.poll(() => shownOrder(page, titles, 6))
			.toEqual(moved.slice(0, 6));
		await expectSettlesAt(
			player,
			() => postsTo(player, SPANISH, "move").length,
			1,
		);
	});

	// Touching and pausing before moving is how a finger picks a thing up. The grip owns that
	// press, so the long press that opens a row's sheet never sees it.
	test("a grip held before it moves drags the row and opens no action sheet", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];
		await expect.poll(() => isSeen(grip(trackRow(page, 0)))).toBe(true);

		// Recorded as it happens: a sheet that opened and closed again by the end is still the defect.
		await page.evaluate(() => {
			const seen = { sheet: false };
			Reflect.set(window, "__sheetSeen", seen);
			new MutationObserver(() => {
				if (document.querySelector('[role="dialog"]')) seen.sheet = true;
			}).observe(document.body, { childList: true, subtree: true });
		});

		const handle = (await grip(trackRow(page, 0)).boundingBox())!;
		const onto = (await trackRow(page, 2).boundingBox())!;
		const x = handle.x + handle.width / 2;
		await holdThenDrag(
			page,
			{ x, y: handle.y + handle.height / 2 },
			{ x, y: onto.y + onto.height * BELOW_CENTRE },
		);

		expect(
			await page.evaluate(
				() => (Reflect.get(window, "__sheetSeen") as { sheet: boolean }).sheet,
			),
			"the row's action sheet opened",
		).toBe(false);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect
			.poll(() => titlesIn(player, SPANISH))
			.toEqual(movedFirstBelowThird(before));
		expect(
			player.requests.filter((entry) => /\/play$/.test(entry.path)),
		).toEqual([]);
	});

	// There is no edit mode: the grip sits beside a body that keeps both of the gestures it had.
	test("a swipe on a row's body scrolls and moves nothing, and a long press on it opens its action sheet", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect.poll(() => isSeen(grip(trackRow(page, 3)))).toBe(true);

		const atTop = await scrollTop(page);
		const body = await pointOver(trackRow(page, 3), 0.5);
		await touchDrag(page, body, { x: body.x, y: body.y - 300 }, 8);
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(atTop + 100);
		await expectSettlesAt(player, () => anyRowEdit(player).length, 0);

		await pressAndHold(page, trackRow(page, 6));
		await expect(
			page.getByRole("menuitem", { name: /^Add to queue/ }),
		).toBeVisible();
	});
});

test.describe("moving the selection from the keyboard", () => {
	test.skip(({ isMobile }) => isMobile, "no keyboard on the phone");

	test("Alt with an arrow moves the selection one place at the player with the selection and cursor following it, and at the top sends nothing", async ({
		page,
		player,
	}) => {
		const titles = await openPlaylist(page, player, SPANISH);
		const before = [...titles];
		// The bindings are registered with the controls that edit the playlist, and a key pressed
		// before they are is dropped rather than queued.
		await expect(sortButton(page)).toBeVisible();

		await trackRow(page, 2).click();
		await trackRow(page, 3).click({ modifiers: ["Shift"] });
		const cursor = page.locator('main [role="row"][data-cursor="true"]');
		const cursorAt = Number(await cursor.getAttribute("data-row"));

		await page.keyboard.press("Alt+ArrowDown");
		const down = [
			before[0],
			before[1],
			before[4],
			before[2],
			before[3],
			...before.slice(5),
		];
		await expect.poll(() => titlesIn(player, SPANISH)).toEqual(down);
		await expect
			.poll(() => shownOrder(page, titles, 6))
			.toEqual(down.slice(0, 6));
		await expect(trackRow(page, 2)).toHaveAttribute("aria-selected", "false");
		await expect(trackRow(page, 3)).toHaveAttribute("aria-selected", "true");
		await expect(trackRow(page, 4)).toHaveAttribute("aria-selected", "true");
		await expect(cursor).toHaveAttribute("data-row", String(cursorAt + 1));
		await expect(cursor).toContainText(before[cursorAt]);

		await page.keyboard.press("Alt+ArrowUp");
		await expect.poll(() => titlesIn(player, SPANISH)).toEqual(before);

		await trackRow(page, 0).click();
		await trackRow(page, 1).click({ modifiers: ["Shift"] });
		await untilQuiet(player);
		const sent = postsTo(player, SPANISH, "move").length;
		expect(sent, "the two moves above were never sent").toBeGreaterThan(0);

		await page.keyboard.press("Alt+ArrowUp");
		await expectSettlesAt(
			player,
			() => postsTo(player, SPANISH, "move").length,
			sent,
		);
		expect(titlesIn(player, SPANISH)).toEqual(before);
	});
});

test.describe("the Sort menu", () => {
	test("opens headed by what it does, offering four orderings none of which is checked, as a menu on a desktop and a sheet on a phone, and the keyboard alone can choose one", async ({
		page,
		player,
		isMobile,
	}) => {
		await openPlaylist(page, player, SPANISH);

		await expect(sortButton(page)).toBeVisible();
		if (isMobile) await sortButton(page).click();
		else {
			await sortButton(page).focus();
			await page.keyboard.press("Enter");
		}

		const surface = isMobile
			? page.getByRole("dialog").filter({ hasText: SORT_HEADING })
			: page.getByRole("menu");
		await expect(surface).toBeVisible();
		await expect(page.getByText(SORT_HEADING)).toBeVisible();
		if (!isMobile) await expect(page.getByRole("dialog")).toHaveCount(0);

		const entries = surface.getByRole("menuitem");
		await expect(entries).toHaveText(ORDERINGS);
		// A sort is something done to the playlist once, not a state it stays in.
		await Promise.all(
			ORDERINGS.map((ordering) =>
				expect(
					surface.getByRole("menuitem", { name: ordering, exact: true }),
				).not.toHaveAttribute("aria-checked"),
			),
		);

		if (isMobile) return;
		const title = surface.getByRole("menuitem", { name: "Title", exact: true });
		await pressUntilFocused(page, title);
		await expect(title).toBeFocused();
		await page.keyboard.press("Enter");
		await expectSettlesAt(
			player,
			() =>
				postsTo(player, SPANISH, "sort").map(
					(entry) => (entry.body as { pattern?: unknown }).pattern,
				),
			[PATTERNS.Title],
		);
	});

	for (const ordering of ORDERINGS) {
		test(`${ordering} orders the whole playlist at the player with one request, draws the player's order without reading the rows, and says so`, async ({
			page,
			player,
			isMobile,
		}) => {
			const titles = await openPlaylist(page, player, SPANISH);
			const name = titleOf(player, SPANISH);

			// A selection names no rows to the sort: it orders the playlist whatever is selected.
			if (!isMobile) {
				await trackRow(page, 1).click();
				await trackRow(page, 3).click({ modifiers: ["Shift"] });
			}
			await untilQuiet(player);
			const readsBefore = rowReads(player, SPANISH).length;
			await expect(sortButton(page)).toBeVisible();
			const caughtUp = listCarriesTheEdit(page, player, SPANISH);

			await sortBy(page, ordering);

			await expect(toast(page)).toContainText(
				new RegExp(`${name} sorted by ${ordering}`, "i"),
			);
			await expectSettlesAt(
				player,
				() => postsTo(player, SPANISH, "sort").length,
				1,
			);
			const body = postsTo(player, SPANISH, "sort")[0].body;
			expect(body).toEqual({
				structure: expect.any(String),
				pattern: PATTERNS[ordering],
			});

			if (ordering === "Title")
				expect(titlesIn(player, SPANISH)).toEqual(
					[...titles].sort(compareText),
				);
			const atThePlayer = titlesIn(player, SPANISH).map(String);
			await expect
				.poll(() => shownOrder(page, titles, 6))
				.toEqual(atThePlayer.slice(0, 6));
			await caughtUp;
			await expectSettlesAt(
				player,
				() => rowReads(player, SPANISH).length,
				readsBefore,
			);
		});
	}

	test.describe("on a playlist of one row", () => {
		// Default Playlist keeps its last row and Favorites its last two.
		test.use({ playlistsFromRow: { p1: 3, p2: 5 } });

		test("there is no Sort, where a playlist of two rows has one", async ({
			page,
			player,
		}) => {
			await openPlaylist(page, player, "p2");
			await expect(trackRow(page, 1)).toBeAttached();
			await expect(sortButton(page)).toBeVisible();

			await openPlaylist(page, player, "p1");
			await expect(trackRow(page, 1)).toHaveCount(0);
			await expect(sortButton(page)).toHaveCount(0);
		});
	});
});

const READ_ONLY_VIEWS: {
	name: string;
	open: (page: Page, player: FakePlayer) => Promise<unknown>;
}[] = [
	{
		name: "an autoplaylist",
		open: (page, player) => openPlaylist(page, player, AUTOPLAYLIST),
	},
	{ name: "the library", open: (page) => openAllMusic(page) },
	{
		name: "a genre",
		open: async (page) => {
			await page.goto("/#/genres");
			await page.getByRole("link", { name: /Post Rock/ }).click();
			await expect(
				page.getByRole("heading", { level: 1, name: "Post Rock" }),
			).toBeVisible();
			await expect(trackRow(page, 2)).toBeAttached();
		},
	},
];

test.describe("a view whose order is not Jean's to change", () => {
	for (const view of READ_ONLY_VIEWS) {
		test(`${view.name} has no Sort, no grip, and neither a drag nor Alt with an arrow sends a reorder`, async ({
			page,
			player,
			isMobile,
		}) => {
			// A writable playlist first, so the absence below is of controls that exist.
			await openPlaylist(page, player, SPANISH);
			await expect(sortButton(page)).toBeVisible();

			await view.open(page, player);
			await expect(sortButton(page)).toHaveCount(0);

			if (!isMobile) {
				await trackRow(page, 0).hover();
				await dragRow(page, 0, 2);
				await trackRow(page, 1).click();
				await page.keyboard.press("Alt+ArrowDown");
			}
			await expect(anyGrip(page)).toHaveCount(0);
			await expectSettlesAt(player, () => anyRowEdit(player).length, 0);
		});
	}
});

// Each refusal is reached both ways a person reorders: a drag moves rows, the menu sorts them.
const EDITS: {
	name: string;
	needsMouse: boolean;
	run: (page: Page) => Promise<void>;
}[] = [
	{ name: "a drag", needsMouse: true, run: (page) => dragRow(page, 0, 2) },
	{ name: "a sort", needsMouse: false, run: (page) => sortBy(page, "Title") },
];

test.describe("a reorder the player refuses", () => {
	for (const edit of EDITS) {
		test.describe(`through ${edit.name}`, () => {
			test.skip(
				({ isMobile }) => isMobile && edit.needsMouse,
				"a mouse drag is the fine-pointer path",
			);

			test("where the playlist changed at the player since its rows were read, nothing moves, a toast says so, and the list draws the player's order", async ({
				page,
				player,
			}) => {
				const titles = await openPlaylist(page, player, SPANISH);
				const name = titleOf(player, SPANISH);
				const poll = await holdThePoll(page);
				// Descending, so a client that quietly sent the title sort again would be seen undoing it.
				player.sortItems(SPANISH, { by: "%title%", desc: true });
				const atThePlayer = titlesIn(player, SPANISH).map(String);

				await edit.run(page);

				await expect(toast(page)).toContainText(
					`${name} changed at the player, so nothing was moved`,
				);
				// Whether the rows are read again at once or on the next tick is not this case's to say.
				poll.letOneThrough();
				await expect
					.poll(() => shownOrder(page, titles, 8))
					.toEqual(atThePlayer.slice(0, 8));
				await expectSettlesAt(
					player,
					() => titlesIn(player, SPANISH),
					atThePlayer,
				);
			});

			test("where another component has locked the playlist, nothing moves, the list returns to its order, and a toast says foobar2000 refused", async ({
				page,
				player,
			}) => {
				const titles = await openPlaylist(page, player, SPANISH);
				const before = [...titles];
				const name = titleOf(player, SPANISH);
				await control(page, "lockPlaylist", { id: SPANISH, locked: true });
				await slowThePlayer(page);

				await edit.run(page);

				// A drag draws its order before the answer, so returning is something the list has to do.
				if (edit.needsMouse)
					await expect
						.poll(() => shownOrder(page, titles, 6))
						.toEqual(movedFirstBelowThird(before).slice(0, 6));

				await expect(toast(page)).toContainText(
					`foobar2000 refused the edit to ${name}`,
				);
				await expect
					.poll(() => shownOrder(page, titles, 8))
					.toEqual(before.slice(0, 8));
				await expectSettlesAt(player, () => titlesIn(player, SPANISH), before);
			});

			const FAILURES: {
				name: string;
				failRowEdit: number | null;
			}[] = [
				{ name: "a 500", failRowEdit: 500 },
				{ name: "a 429 past its retry", failRowEdit: 429 },
				{ name: "a dropped connection", failRowEdit: null },
			];

			for (const failure of FAILURES) {
				test.describe(`failing with ${failure.name}`, () => {
					test.use({ fooJean: { failRowEdit: failure.failRowEdit } });

					test("the list returns to its order and a toast says the order was not saved", async ({
						page,
						player,
					}) => {
						const titles = await openPlaylist(page, player, SPANISH);
						const before = [...titles];
						// Cut as late as the fake answers, so a drag's order is on screen before it fails.
						if (failure.failRowEdit === null)
							await page.route(
								(url) => /\/items\/(move|sort)$/.test(url.pathname),
								async (route) => {
									await new Promise((settle) =>
										setTimeout(settle, ANSWER_DELAY_MS),
									);
									await route.abort();
								},
							);
						await slowThePlayer(page);

						await edit.run(page);

						if (edit.needsMouse)
							await expect
								.poll(() => shownOrder(page, titles, 6))
								.toEqual(movedFirstBelowThird(before).slice(0, 6));

						await expect(toast(page)).toContainText("The order was not saved");
						await expect
							.poll(() => shownOrder(page, titles, 8))
							.toEqual(before.slice(0, 8));
						await expectSettlesAt(
							player,
							() => titlesIn(player, SPANISH),
							before,
						);
					});
				});
			}
		});
	}
});
