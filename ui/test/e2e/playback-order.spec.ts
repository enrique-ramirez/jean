import {
	DETACHED_PLAYBACK_MODES,
	type DetachedSession,
} from "../fake-api/sessions.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	checkedOrderRows,
	closeNowPlaying,
	drawing,
	drawnColour,
	expect,
	expectDrawnIn,
	expectNothingOpened,
	expectSettlesAt,
	expectTheScreenIsStillOpen,
	globalControls,
	holdRequests,
	holdThePoll,
	inSequence,
	modesSent,
	nowPlayingScreen,
	openLibrary,
	openLibraryWithTheOrderButton,
	openNowPlaying,
	orderButton,
	orderList,
	orderRow,
	playbackCommands,
	playerDeclaring,
	playRequests,
	putThePickerAway,
	statusBar,
	test,
	tokenColourIn,
	trackRow,
	untilQuiet,
	untilTheInstallIsKnown,
	viewHeader,
} from "./fixtures.ts";
import {
	dragAcrossTheSheet,
	dragFromTheScrim,
	dragTheSheetAwayByItsTopEdge,
	restingBox,
} from "./gestures.ts";
import { queuePanel } from "./queue.ts";

// foobar2000's stock playback orders, in the sequence its own Order menu lists them and the fake
// declares them: Random is fourth, between the repeats and the shuffles. `declared` is foobar2000's
// name for the order, which is what `enumNames` takes.
const ORDERS = [
	{
		declared: "Default",
		mode: "inOrder",
		english: "In order",
		spanish: "En orden",
		icon: "layout-arrow-down",
	},
	{
		declared: "Repeat (playlist)",
		mode: "repeatAll",
		english: "Repeat playlist",
		spanish: "Repetir lista",
		icon: "list-restart",
	},
	{
		declared: "Repeat (track)",
		mode: "repeatOne",
		english: "Repeat track",
		spanish: "Repetir pista",
		icon: "repeat-1",
	},
	{
		declared: "Random",
		mode: "random",
		english: "Random",
		spanish: "Al azar",
		icon: "dices",
	},
	{
		declared: "Shuffle (tracks)",
		mode: "shuffleTracks",
		english: "Shuffle tracks",
		spanish: "Aleatorio por pistas",
		icon: "shuffle",
	},
	{
		declared: "Shuffle (albums)",
		mode: "shuffleAlbums",
		english: "Shuffle albums",
		spanish: "Aleatorio por álbumes",
		icon: "disc-album",
	},
	{
		declared: "Shuffle (folders)",
		mode: "shuffleFolders",
		english: "Shuffle folders",
		spanish: "Aleatorio por carpetas",
		icon: "folders",
	},
] as const;

type Order = (typeof ORDERS)[number];

const [
	IN_ORDER,
	REPEAT_PLAYLIST,
	REPEAT_TRACK,
	RANDOM,
	SHUFFLE_TRACKS,
	SHUFFLE_ALBUMS,
	SHUFFLE_FOLDERS,
] = ORDERS;

const ORDERS_DRAWN_IN_THE_ACCENT = ORDERS.filter((order) => order !== IN_ORDER);

// `foo_jean` knows an order by foobar2000's English name for it, so a name outside the stock seven
// is an order the player can be in and the component has no mode for.
const UNNAMED = { declared: "Shuffle (genres)" };

type Declared = Order | typeof UNNAMED;

const offering = (orders: readonly Declared[], current?: Declared) =>
	playerDeclaring(
		orders.map((order) => order.declared),
		current?.declared,
	);

const stockPlayerIn = (current: Order) => offering(ORDERS, current);

// `declared` is what that player declares: the fake holds the order as a position in it.
const moveThePlayerTo = (
	player: FakePlayer,
	order: Order,
	declared: readonly Declared[] = ORDERS,
) =>
	player.patchPlayer({
		options: [{ id: "playbackOrder", value: declared.indexOf(order) }],
	});

const holdModeWrites = (page: Page) =>
	holdRequests(
		page,
		(request) =>
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/playback/mode",
	);

const startATrack = async (page: Page, player: FakePlayer) => {
	await trackRow(page, 1).dblclick();
	await expect.poll(() => player.player.playbackState).toBe("playing");
};

const faceOf = (page: Page, isCompact: boolean) =>
	orderButton(page, isCompact).locator("svg");

// Previous is what is waited on, since both transports carry it whatever the install offers.
const arriveAtTheTransport = async (page: Page, isCompact: boolean) => {
	await openLibrary(page);
	const transport = await globalControls(page, isCompact);
	await expect(
		transport.getByRole("button", { name: "Previous track" }),
	).toBeVisible();
};

const transportOf = (page: Page, isCompact: boolean) =>
	isCompact ? nowPlayingScreen(page) : statusBar(page);

const rows = (page: Page) => orderList(page).getByRole("menuitemradio");

const iconOf = (row: Locator) => row.locator("svg").first();

const openList = async (page: Page, isCompact: boolean) => {
	await orderButton(page, isCompact).click();
	await expect(orderList(page)).toBeVisible();
};

const closeButton = (page: Page) =>
	nowPlayingScreen(page).getByRole("button", { name: "Close now playing" });

// Close pressed, and nothing more than that: the screen is still on its way out. A browser
// changes the address at once and tells the page in a task of its own, so a key sent straight
// after the click can reach the app before the close has. No hand is that quick, and two frames
// are enough for the page to have heard.
const closeAndLetTheAppHearIt = async (page: Page) => {
	await closeButton(page).click();
	await expect(page).not.toHaveURL(/#\/playing/);
	await page.evaluate(
		() =>
			new Promise((heard) =>
				requestAnimationFrame(() => requestAnimationFrame(heard)),
			),
	);
};

const sheet = (page: Page) =>
	page.getByRole("dialog", { name: "Playback order" });

// The shortcut sheet closes on a key of its own, which only a sheet still holding the keyboard
// answers.
const OVERLAYS = [
	{ name: "Settings", closingKey: "Escape" },
	{ name: "Keyboard shortcuts", closingKey: "Shift+?" },
] as const;

const overlay = (page: Page, name: string) =>
	page.getByRole("dialog", { name });

// Focus is put on the overlay's button rather than walked there with Tab: how many stops lie
// between the list and the button is not what these cases are about.
const openOverTheOpenList = async (page: Page, name: string) => {
	await page.keyboard.press("o");
	await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
	await page.getByRole("button", { name, exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(overlay(page, name)).toBeVisible();
};

// Next track rather than Space: closing Settings hands focus back to the button that opened it,
// and a browser answers Space on a focused button by pressing it.
const NEXT_TRACK_KEY = "ControlOrMeta+ArrowRight";
const NEXT_TRACK_COMMAND = "/api/playback/next";

const trackInformation = (page: Page) =>
	page.getByRole("region", { name: "Track information" });

const centreOf = (box: {
	x: number;
	y: number;
	width: number;
	height: number;
}) => ({
	x: box.x + box.width / 2,
	y: box.y + box.height / 2,
});

const tokenColour = (page: Page, token: string) =>
	tokenColourIn(page.locator("body"), token);

const ACCENT = "--accent-text";

const RESTING_GREY = "--faint";
const RESTING_GREY_ON_THE_SCREEN = "--muted";

const OKLCH = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/;

// A row's icon has greys of its own to choose from, so In order's is held to being a grey at all:
// both themes' accent sits well above this chroma and every grey in the palette well below it.
const GREY_MAX_CHROMA = 0.05;

const chromaOf = (colour: string) => Number(OKLCH.exec(colour)?.[2]);

// Apple's Human Interface Guidelines and WCAG 2.5.5 both set a touch target's least side at 44, in
// points and in CSS pixels.
const TOUCH_TARGET = 44;

// A row of the captured Library with rows either side of it, so a skip either way would land.
const PLAYING_ROW = 2;

const UNNAMED_ICON = "circle-question-mark";

const rightOf = (box: { x: number; width: number }) => box.x + box.width;
const bottomOf = (box: { y: number; height: number }) => box.y + box.height;

test.describe("on a desktop", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"a compact viewport has no order button in its status bar, and its list is an action sheet",
	);

	test.describe("the status bar", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("has one playback order button, between Show current track and Previous track, with Next track too, and no Shuffle button", async ({
			page,
		}) => {
			const buttons = statusBar(page).getByRole("button");

			await expect(buttons.nth(0)).toHaveAccessibleName("Show current track");
			await expect(buttons.nth(1)).toHaveAccessibleName(/^Playback order/);
			await expect(buttons.nth(2)).toHaveAccessibleName("Previous track");
			await expect(
				statusBar(page).getByRole("button", { name: "Next track" }),
			).toBeVisible();
			await expect(orderButton(page, false)).toHaveCount(1);
			// Exact, or the order button's own name would answer while the player shuffles.
			await expect(
				statusBar(page).getByRole("button", { name: "Shuffle", exact: true }),
			).toHaveCount(0);
		});
	});

	for (const theme of ["dark", "light"] as const) {
		test.describe(`the button's face on the ${theme} theme`, () => {
			test.use({ settings: { "jean.theme": theme } });
			test.beforeEach(async ({ page }) => {
				await openLibraryWithTheOrderButton(page);
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			});

			test.describe("in In order", () => {
				test.use({ playerState: stockPlayerIn(IN_ORDER) });

				test("is In order's icon, in the resting grey", async ({ page }) => {
					await expect(faceOf(page, false)).toHaveClass(drawing(IN_ORDER.icon));
					await expect(orderButton(page, false)).toHaveAccessibleName(
						`Playback order: ${IN_ORDER.english}`,
					);

					const grey = await tokenColour(page, RESTING_GREY);
					expect(grey).not.toBe(await tokenColour(page, ACCENT));
					await expectDrawnIn(faceOf(page, false), grey);
				});
			});

			for (const order of ORDERS_DRAWN_IN_THE_ACCENT) {
				test.describe(`in ${order.english}`, () => {
					test.use({ playerState: stockPlayerIn(order) });

					test("is that order's icon, in the accent at rest, hovered and with the list open", async ({
						page,
					}) => {
						await expect(faceOf(page, false)).toHaveClass(drawing(order.icon));
						await expect(orderButton(page, false)).toHaveAccessibleName(
							`Playback order: ${order.english}`,
						);

						const accent = await tokenColour(page, ACCENT);
						expect(accent).not.toBe(await tokenColour(page, RESTING_GREY));
						await expectDrawnIn(faceOf(page, false), accent);

						// An icon that turned to the text colour under the pointer would read as the order
						// having changed.
						await orderButton(page, false).hover();
						await expectDrawnIn(faceOf(page, false), accent);

						await openList(page, false);
						await expectDrawnIn(faceOf(page, false), accent);
						await page.mouse.move(1, 1);
						await expectDrawnIn(faceOf(page, false), accent);
					});
				});
			}
		});
	}

	test.describe("the button, as it is announced", () => {
		test.use({ playerState: stockPlayerIn(REPEAT_PLAYLIST) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("its name and its tooltip are the order the player is in, and follow it", async ({
			page,
			player,
		}) => {
			const button = orderButton(page, false);
			await expect(button).toHaveAccessibleName(
				"Playback order: Repeat playlist",
			);
			await expect(button).toHaveAttribute(
				"title",
				"Playback order: Repeat playlist",
			);

			moveThePlayerTo(player, SHUFFLE_ALBUMS);

			await expect(button).toHaveAccessibleName(
				"Playback order: Shuffle albums",
			);
			await expect(button).toHaveAttribute(
				"title",
				"Playback order: Shuffle albums",
			);
		});

		test("it says it opens a menu and whether that menu is open, and is never a toggle", async ({
			page,
		}) => {
			const button = orderButton(page, false);
			await expect(button).toHaveAttribute("aria-haspopup", "menu");
			await expect(button).toHaveAttribute("aria-expanded", "false");
			await expect(button).not.toHaveAttribute("aria-pressed");

			await button.click();
			await expect(orderList(page)).toBeVisible();
			await expect(button).toHaveAttribute("aria-expanded", "true");
			await expect(button).not.toHaveAttribute("aria-pressed");

			await page.keyboard.press("Escape");
			await expect(orderList(page)).toHaveCount(0);
			await expect(button).toHaveAttribute("aria-expanded", "false");
		});
	});

	test.describe("an order changed somewhere else", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("moves the name, the face and an open list's tick within one poll", async ({
			page,
			player,
		}) => {
			await openList(page, false);
			await expect(checkedOrderRows(page)).toHaveAccessibleName(
				IN_ORDER.english,
			);

			const poll = await holdThePoll(page);
			moveThePlayerTo(player, SHUFFLE_FOLDERS);
			poll.letOneThrough();

			await expect(orderButton(page, false)).toHaveAccessibleName(
				"Playback order: Shuffle folders",
			);
			await expect(faceOf(page, false)).toHaveClass(
				drawing(SHUFFLE_FOLDERS.icon),
			);
			await expect(checkedOrderRows(page)).toHaveAccessibleName(
				SHUFFLE_FOLDERS.english,
			);
			await expect(rows(page)).toHaveCount(ORDERS.length);
			expect(modesSent(player)).toEqual([]);
		});
	});

	test.describe("pressing the button", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("a click opens the list wholly above the button, headed Playback order, and sends nothing", async ({
			page,
			player,
		}) => {
			await openList(page, false);
			await expect(orderList(page)).toHaveCount(1);
			await expect(rows(page)).toHaveCount(ORDERS.length);

			const heading = page.getByText("Playback order", { exact: true });
			await expect(heading).toBeVisible();

			const menu = await restingBox(orderList(page));
			const button = await restingBox(orderButton(page, false));
			const headed = await restingBox(heading);
			const firstRow = await restingBox(rows(page).first());

			// Opened downwards from a bar at the foot of the window, the list has no room and
			// lands over the button that opened it.
			expect(
				bottomOf(menu),
				"the list's bottom edge, against the button's top",
			).toBeLessThanOrEqual(button.y);
			expect(menu.y, "the list's top edge").toBeGreaterThanOrEqual(0);
			expect(
				bottomOf(headed),
				"the heading's bottom edge, against the first row's top",
			).toBeLessThanOrEqual(firstRow.y);
			expect(headed.x, "the heading's left edge").toBeGreaterThanOrEqual(
				menu.x,
			);
			expect(rightOf(headed), "the heading's right edge").toBeLessThanOrEqual(
				rightOf(menu),
			);

			await expectSettlesAt(player, () => playbackCommands(player), []);
			expect(player.player.playbackMode).toBe(ORDERS.indexOf(IN_ORDER));
		});

		for (const key of ["Enter", "Space"]) {
			// The app's own bindings hear both keys first: Enter plays the selected row of the list
			// behind the bar, and Space is play-pause, which takes the keystroke before the button can
			// be pressed by it.
			test(`${key} on the focused button opens the list, and sends nothing`, async ({
				page,
				player,
			}) => {
				await orderButton(page, false).focus();
				await page.keyboard.press(key);

				await expect(orderList(page)).toBeVisible();
				await expect(rows(page)).toHaveCount(ORDERS.length);
				await expectSettlesAt(player, () => playbackCommands(player), []);
				expect(playRequests(player)).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(IN_ORDER));
			});
		}
	});

	test.describe("the list's rows", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("are the seven orders by Jean's English names, in the player's sequence, with no separator", async ({
			page,
		}) => {
			await openList(page, false);

			await expect(rows(page)).toHaveText(ORDERS.map((order) => order.english));
			await expect(orderList(page).getByRole("menuitem")).toHaveCount(0);
			await expect(orderList(page).getByRole("separator")).toHaveCount(0);
		});
	});

	// The sequence declared is neither foobar2000's stock one nor alphabetical, so rows that come
	// back in it were not reordered by anything.
	test.describe("a player declaring four orders in a sequence of its own", () => {
		const DECLARED = [SHUFFLE_FOLDERS, IN_ORDER, RANDOM, REPEAT_TRACK];

		test.use({ playerState: offering(DECLARED, RANDOM) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

		test("gets those four rows in that sequence, and no other", async ({
			page,
		}) => {
			await expect(orderButton(page, false)).toHaveAccessibleName(
				"Playback order: Random",
			);
			await openList(page, false);

			await expect(rows(page)).toHaveText(
				DECLARED.map((order) => order.english),
			);
			await expect(orderList(page).getByRole("menuitem")).toHaveCount(0);
			await expect(checkedOrderRows(page)).toHaveAccessibleName(RANDOM.english);
		});
	});

	// Two players, so every row is read at least once while another row is the current one, and
	// In order's and an accented one's are each read both ways.
	for (const current of [IN_ORDER, REPEAT_PLAYLIST]) {
		test.describe(`a row's icon, with the player in ${current.english}`, () => {
			test.use({ playerState: stockPlayerIn(current) });
			test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

			test("is its order's, at the left of its name, in the accent for every order but In order", async ({
				page,
			}) => {
				await openList(page, false);
				await expect(checkedOrderRows(page)).toHaveAccessibleName(
					current.english,
				);
				const accent = await tokenColour(page, ACCENT);

				await inSequence(ORDERS, async (order) => {
					const row = orderRow(page, order.english);
					await expect(iconOf(row)).toHaveClass(drawing(order.icon));

					const icon = await restingBox(iconOf(row));
					const name = await restingBox(
						row.getByText(order.english, { exact: true }),
					);
					expect(
						rightOf(icon),
						`${order.english}'s icon, against its name`,
					).toBeLessThanOrEqual(name.x);

					if (order === IN_ORDER)
						await expect
							.poll(async () => chromaOf(await drawnColour(iconOf(row))), {
								message: "the chroma of In order's icon",
							})
							.toBeLessThan(GREY_MAX_CHROMA);
					else await expectDrawnIn(iconOf(row), accent);
				});
			});
		});
	}

	test.describe("the list, from the keyboard", () => {
		// Random, so the current row is neither the first nor the last: a list that always marks or
		// focuses its first row would pass from In order.
		test.describe("with the player in Random", () => {
			test.use({ playerState: stockPlayerIn(RANDOM) });
			test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

			test("every row is a radio item, and only the current one is checked and ticked after its name", async ({
				page,
			}) => {
				await openList(page, false);

				await expect(rows(page)).toHaveCount(ORDERS.length);
				await expect(orderRow(page, RANDOM.english)).toHaveAttribute(
					"aria-checked",
					"true",
				);
				await expect(checkedOrderRows(page)).toHaveCount(1);

				await inSequence(ORDERS, (order) =>
					expect(orderRow(page, order.english).locator("svg")).toHaveCount(
						order === RANDOM ? 2 : 1,
					),
				);

				const current = orderRow(page, RANDOM.english);
				const tick = await restingBox(current.locator("svg").last());
				const name = await restingBox(
					current.getByText(RANDOM.english, { exact: true }),
				);
				expect(
					tick.x,
					"the tick, against its row's name",
				).toBeGreaterThanOrEqual(rightOf(name));
				expect(tick.width).toBeGreaterThan(0);
			});

			test("focus starts on the current row, and the arrows move it a row at a time and send nothing", async ({
				page,
				player,
			}) => {
				await openList(page, false);
				await expect(orderRow(page, RANDOM.english)).toBeFocused();

				await page.keyboard.press("ArrowDown");
				await expect(orderRow(page, SHUFFLE_TRACKS.english)).toBeFocused();

				await page.keyboard.press("ArrowUp");
				await page.keyboard.press("ArrowUp");
				await expect(orderRow(page, REPEAT_TRACK.english)).toBeFocused();

				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(checkedOrderRows(page)).toHaveAccessibleName(
					RANDOM.english,
				);
			});
		});

		test.describe("with the player in In order", () => {
			test.use({ playerState: stockPlayerIn(IN_ORDER) });
			test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

			test("the arrows wrap at both ends", async ({ page }) => {
				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();

				await page.keyboard.press("ArrowUp");
				await expect(orderRow(page, SHUFFLE_FOLDERS.english)).toBeFocused();

				await page.keyboard.press("ArrowDown");
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
			});

			test("Enter chooses the focused row, closes the list and puts focus back on the button", async ({
				page,
				player,
			}) => {
				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await page.keyboard.press("ArrowDown");
				await expect(orderRow(page, REPEAT_TRACK.english)).toBeFocused();

				await page.keyboard.press("Enter");

				await expectSettlesAt(player, () => modesSent(player), [
					REPEAT_TRACK.mode,
				]);
				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
				await expect(orderButton(page, false)).toBeFocused();
				// Enter is also what plays the selected row of the list behind the menu.
				expect(playRequests(player)).toEqual([]);
			});

			test("Space chooses the focused row and does not pause the track playing", async ({
				page,
				player,
			}) => {
				await startATrack(page, player);
				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await expect(orderRow(page, REPEAT_PLAYLIST.english)).toBeFocused();

				await page.keyboard.press("Space");

				await expectSettlesAt(player, () => playbackCommands(player), [
					"/api/playback/mode",
				]);
				expect(modesSent(player)).toEqual([REPEAT_PLAYLIST.mode]);
				expect(player.player.playbackState).toBe("playing");
				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toBeFocused();
			});

			test("Escape closes the list, sends nothing and puts focus back on the button", async ({
				page,
				player,
			}) => {
				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await expect(orderRow(page, REPEAT_PLAYLIST.english)).toBeFocused();

				await page.keyboard.press("Escape");

				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toBeFocused();
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: In order",
				);
			});

			// The screen closes on Escape too, and the list is in front of it. Both ways of opening
			// the list are pressed, since only a click leaves focus on the button to go back to.
			test("with the now-playing screen open, Escape closes the list and not the screen, whether o or a click opened it", async ({
				page,
				player,
			}) => {
				await page.keyboard.press("w");
				await expectTheScreenIsStillOpen(page);

				await page.keyboard.press("o");
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("Escape");

				await expectTheScreenIsStillOpen(page);
				await expect(orderList(page)).toHaveCount(0);

				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("Escape");

				await expectTheScreenIsStillOpen(page);
				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toBeFocused();
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expectTheScreenIsStillOpen(page);
			});

			// The queue panel closes on Escape as well, and the list is in front of it too.
			test("with the queue panel open, Escape closes the list and not the panel, whether o or a click opened it, and Escape again closes the panel", async ({
				page,
				player,
			}) => {
				await statusBar(page)
					.getByRole("button", { name: /^Queue/ })
					.click();
				await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

				await page.keyboard.press("o");
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("Escape");

				await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
				await expect(orderList(page)).toHaveCount(0);

				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("Escape");

				await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toBeFocused();
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

				await page.keyboard.press("Escape");
				await expect(queuePanel(page)).toHaveAttribute("data-open", "false");
			});

			// The list stays open when focus leaves it, so it is the one overlay another can be
			// opened over, and the two can then close in either sequence. In this one the list goes
			// first, and a keyboard handed back to a list that has gone answers no key at all.
			for (const { name, closingKey } of OVERLAYS) {
				test(`with ${name} opened over the list, a press inside it closes the list, and once ${closingKey} has closed it a key reaches the player and o opens the list again`, async ({
					page,
					player,
				}) => {
					await openOverTheOpenList(page, name);

					await overlay(page, name)
						.getByRole("heading", { name, exact: true })
						.click();
					await expect(orderList(page)).toHaveCount(0);

					await page.keyboard.press("Space");
					await expectSettlesAt(player, () => playbackCommands(player), []);
					await expect(overlay(page, name)).toBeVisible();

					await page.keyboard.press(closingKey);
					await expect(overlay(page, name)).toHaveCount(0);

					await page.keyboard.press(NEXT_TRACK_KEY);
					await expectSettlesAt(player, () => playbackCommands(player), [
						NEXT_TRACK_COMMAND,
					]);

					await page.keyboard.press("o");
					await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				});
			}

			// The other sequence, with the queue panel behind both: each key closes the front layer
			// and no other, and the list is in front of the panel for as long as it is open.
			for (const { name, closingKey } of OVERLAYS) {
				test(`with ${name} opened over the list, ${closingKey} closes it and not the list, Escape then closes the list and not the queue panel, and with all three closed a key reaches the player and o opens the list again`, async ({
					page,
					player,
				}) => {
					await statusBar(page)
						.getByRole("button", { name: /^Queue/ })
						.click();
					await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
					await openOverTheOpenList(page, name);

					await page.keyboard.press(closingKey);
					await expect(overlay(page, name)).toHaveCount(0);
					await expect(orderList(page)).toHaveCount(1);
					await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

					await page.keyboard.press("Escape");
					await expect(orderList(page)).toHaveCount(0);
					await expectSettlesAt(player, () => playbackCommands(player), []);
					await expect(queuePanel(page)).toHaveAttribute("data-open", "true");

					await page.keyboard.press("Escape");
					await expect(queuePanel(page)).toHaveAttribute("data-open", "false");

					await page.keyboard.press(NEXT_TRACK_KEY);
					await expectSettlesAt(player, () => playbackCommands(player), [
						NEXT_TRACK_COMMAND,
					]);

					await page.keyboard.press("o");
					await expect(orderRow(page, IN_ORDER.english)).toBeFocused();
				});
			}

			// With nothing playing a seek has nothing to act on, and the guard would pass unguarded.
			test("no arrow typed at the list seeks the track playing", async ({
				page,
				player,
			}) => {
				await startATrack(page, player);
				await openList(page, false);
				await expect(orderRow(page, IN_ORDER.english)).toBeFocused();

				await page.keyboard.press("ArrowRight");
				await page.keyboard.press("ArrowDown");
				await page.keyboard.press("ArrowUp");
				await page.keyboard.press("ArrowLeft");

				await expectSettlesAt(player, () => playbackCommands(player), []);
				expect(player.player.playbackState).toBe("playing");
			});
		});
	});

	test.describe("choosing a row", () => {
		test.describe("with the player in In order", () => {
			test.use({ playerState: stockPlayerIn(IN_ORDER) });
			test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

			test("sends that order once, closes the list and starts nothing", async ({
				page,
				player,
			}) => {
				await openList(page, false);
				await orderRow(page, SHUFFLE_ALBUMS.english).click();

				await expectSettlesAt(player, () => playbackCommands(player), [
					"/api/playback/mode",
				]);
				expect(modesSent(player)).toEqual([SHUFFLE_ALBUMS.mode]);
				expect(playRequests(player)).toEqual([]);
				expect(player.playQueue).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(SHUFFLE_ALBUMS));
				expect(player.player.playbackState).toBe("stopped");
				await expect(orderList(page)).toHaveCount(0);
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: Shuffle albums",
				);
			});

			test("changes the name and the face before the player has answered", async ({
				page,
				player,
			}) => {
				// A poll answered after the choice would draw the order the player is still in, and
				// with the write held nothing would correct it.
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: In order",
				);
				await holdThePoll(page);
				const held = await holdModeWrites(page);
				await openList(page, false);
				await orderRow(page, REPEAT_TRACK.english).click();
				await held.untilHeld();

				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
				await expect(faceOf(page, false)).toHaveClass(
					drawing(REPEAT_TRACK.icon),
				);
				await expect(orderList(page)).toHaveCount(0);
				expect(modesSent(player)).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(IN_ORDER));

				held.releaseAll();

				await expectSettlesAt(player, () => modesSent(player), [
					REPEAT_TRACK.mode,
				]);
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
			});
		});

		test.describe("that is already the current one", () => {
			test.use({ playerState: stockPlayerIn(REPEAT_PLAYLIST) });
			test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page));

			test("sends nothing and closes the list", async ({ page, player }) => {
				await openList(page, false);
				await orderRow(page, REPEAT_PLAYLIST.english).click();

				await expect(orderList(page)).toHaveCount(0);
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(orderButton(page, false)).toHaveAccessibleName(
					"Playback order: Repeat playlist",
				);
			});
		});
	});

	test.describe("in a browser that asks for Spanish", () => {
		const TITLE = "Orden de reproducción";

		test.use({ locale: "es-AR", playerState: stockPlayerIn(REPEAT_PLAYLIST) });
		test.beforeEach(({ page }) => openLibraryWithTheOrderButton(page, TITLE));

		test("the button's name, the list's heading and the seven rows read in Spanish", async ({
			page,
		}) => {
			await expect(page.locator("html")).toHaveAttribute("lang", "es");

			const button = orderButton(page, false, TITLE);
			await expect(button).toHaveAccessibleName(`${TITLE}: Repetir lista`);
			await expect(button).toHaveAttribute("title", `${TITLE}: Repetir lista`);

			await button.click();

			await expect(page.getByText(TITLE, { exact: true })).toBeVisible();
			await expect(rows(page)).toHaveText(ORDERS.map((order) => order.spanish));
		});
	});
});

test.describe("on a compact viewport", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"a desktop draws the button in its status bar and the list as a menu, covered above",
	);

	// Shuffle albums, so the button's name holds the word Shuffle, and a lookup of a Shuffle button
	// by it would find this one.
	test.use({ playerState: stockPlayerIn(SHUFFLE_ALBUMS) });

	test("the now-playing screen has the order button beside the queue button, and the status bar has none", async ({
		page,
	}) => {
		await openLibrary(page);
		await expect(
			statusBar(page).getByRole("button", { name: /^(Play|Pause)$/ }),
		).toBeVisible();
		await expect(orderButton(page, false)).toHaveCount(0);

		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);

		await expect(orderButton(page, true)).toHaveCount(1);
		await expect(orderButton(page, true)).toHaveAccessibleName(
			"Playback order: Shuffle albums",
		);
		await expect(faceOf(page, true)).toHaveClass(drawing(SHUFFLE_ALBUMS.icon));
		await expect(
			screen.getByRole("button", { name: "Shuffle", exact: true }),
		).toHaveCount(0);

		const order = await restingBox(orderButton(page, true));
		const queue = await restingBox(
			screen.getByRole("button", { name: /^Queue/ }),
		);
		expect(Math.abs(queue.y - order.y)).toBeLessThan(queue.height);
		expect(queue.x).toBeGreaterThanOrEqual(rightOf(order));
		expect(queue.x - rightOf(order)).toBeLessThan(order.width);
	});

	test("the status bar runs from Show current track to Play or Pause with no Previous, Next or Queue, and the screen has Previous and Next", async ({
		page,
	}) => {
		await openLibrary(page);
		await expect(
			statusBar(page).getByRole("button", { name: /^(Play|Pause)$/ }),
		).toBeVisible();

		const barLabels = await statusBar(page)
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			);
		expect(barLabels).not.toContain("Previous track");
		expect(barLabels).not.toContain("Next track");
		expect(barLabels.some((label) => label?.startsWith("Queue"))).toBe(false);
		expect(barLabels[0]).toBe("Show current track");
		expect(barLabels[barLabels.length - 1]).toMatch(/^(Play|Pause)$/);

		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);
		await expect(
			screen.getByRole("button", { name: "Previous track" }),
		).toBeVisible();
		await expect(
			screen.getByRole("button", { name: "Next track" }),
		).toBeVisible();
	});

	// A phone can have a keyboard attached, and Playwright's has one.
	test.describe("o, from a keyboard", () => {
		test("with the screen open, opens the sheet with the current order checked, and sends nothing", async ({
			page,
			player,
		}) => {
			await arriveAtTheTransport(page, true);
			await expect(orderButton(page, true)).toBeVisible();

			await page.keyboard.press("o");

			await expect(sheet(page)).toBeVisible();
			await expect(
				sheet(page).getByRole("menuitemradio", { checked: true }),
			).toHaveAccessibleName(SHUFFLE_ALBUMS.english);
			await expectSettlesAt(player, () => playbackCommands(player), []);
		});

		test("before the screen has been opened, opens nothing and sends nothing", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await expect(
				statusBar(page).getByRole("button", { name: /^(Play|Pause)$/ }),
			).toBeVisible();
			await untilTheInstallIsKnown(player);

			await page.keyboard.press("o");

			await expectSettlesAt(player, () => playbackCommands(player), []);
			await expectNothingOpened(page);
		});

		test("with the screen closed again, opens nothing and sends nothing", async ({
			page,
			player,
		}) => {
			await arriveAtTheTransport(page, true);
			await expect(orderButton(page, true)).toBeVisible();
			await closeNowPlaying(page);

			await page.keyboard.press("o");

			await expectSettlesAt(player, () => playbackCommands(player), []);
			await expectNothingOpened(page);
		});

		// The screen takes a moment to leave once Close is pressed, and it is closed from the
		// press. A sheet opened in that moment leaves with the screen, so every one ever drawn
		// is recorded as it is added.
		test("pressed as the screen is closing, never draws the sheet and sends nothing", async ({
			page,
			player,
		}) => {
			await arriveAtTheTransport(page, true);
			await expect(orderButton(page, true)).toBeVisible();
			await page.evaluate(() => {
				new MutationObserver(() => {
					if (document.querySelector('[role="dialog"]'))
						document.documentElement.dataset.drewADialog = "true";
				}).observe(document.body, { childList: true, subtree: true });
			});

			await closeAndLetTheAppHearIt(page);
			await page.keyboard.press("o");

			await expect(nowPlayingScreen(page)).toBeHidden();
			await expectSettlesAt(player, () => playbackCommands(player), []);
			await expect(page.locator("html")).not.toHaveAttribute(
				"data-drew-a-dialog",
			);
		});

		// The screen's Lyrics button brings the track information up over the whole screen, the
		// order button with it. Playwright calls a covered element visible, so what is drawn at
		// the button's centre is asked of the browser.
		test("with track information up over the button, opens nothing and sends nothing", async ({
			page,
			player,
		}) => {
			await arriveAtTheTransport(page, true);
			const button = centreOf(await restingBox(orderButton(page, true)));

			await nowPlayingScreen(page)
				.getByRole("button", { name: "Lyrics", exact: true })
				.click();
			await expect
				.poll(
					() =>
						trackInformation(page).evaluate(
							(layer, at) =>
								layer.contains(document.elementFromPoint(at.x, at.y)),
							button,
						),
					{ message: "track information, drawn where the order button is" },
				)
				.toBe(true);

			await page.keyboard.press("o");

			await expectSettlesAt(player, () => playbackCommands(player), []);
			await expectNothingOpened(page);
		});

		test.describe("on an install offering two orders", () => {
			test.use({
				playerState: offering([IN_ORDER, REPEAT_PLAYLIST], IN_ORDER),
			});

			test("pressed as the screen is closing, sends nothing", async ({
				page,
				player,
			}) => {
				await arriveAtTheTransport(page, true);
				await expect(orderButton(page, true)).toHaveAccessibleName(
					"Playback order: In order",
				);

				await closeAndLetTheAppHearIt(page);
				await page.keyboard.press("o");

				await expect(nowPlayingScreen(page)).toBeHidden();
				await expectSettlesAt(player, () => playbackCommands(player), []);
			});

			test("with the screen closed again, sends nothing", async ({
				page,
				player,
			}) => {
				await arriveAtTheTransport(page, true);
				await expect(orderButton(page, true)).toHaveAccessibleName(
					"Playback order: In order",
				);
				await closeNowPlaying(page);

				await page.keyboard.press("o");

				await expectSettlesAt(player, () => playbackCommands(player), []);
			});
		});
	});

	// The screen closes on Escape too, and the sheet is in front of it.
	test("Escape closes the sheet and not the screen, puts focus back on the button and sends nothing", async ({
		page,
		player,
	}) => {
		await arriveAtTheTransport(page, true);
		await expect(orderButton(page, true)).toBeVisible();
		await orderButton(page, true).click();
		await expect(sheet(page)).toBeVisible();

		await page.keyboard.press("Escape");

		await expectTheScreenIsStillOpen(page);
		await expect(sheet(page)).toHaveCount(0);
		await expect(orderButton(page, true)).toBeFocused();
		await expectSettlesAt(player, () => playbackCommands(player), []);
		await expectTheScreenIsStillOpen(page);
	});

	test("the button is a target a thumb can hit", async ({ page }) => {
		await arriveAtTheTransport(page, true);
		await expect(orderButton(page, true)).toBeVisible();

		const box = await restingBox(orderButton(page, true));
		expect(box.width).toBeGreaterThanOrEqual(TOUCH_TARGET);
		expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
	});

	test("a tap opens an action sheet named Playback order holding the rows, and sends nothing", async ({
		page,
		player,
	}) => {
		await arriveAtTheTransport(page, true);
		await expect(orderButton(page, true)).toBeVisible();
		await orderButton(page, true).tap();

		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page).getByRole("menuitemradio")).toHaveText(
			ORDERS.map((order) => order.english),
		);
		await expect(
			sheet(page).getByRole("menuitemradio", { checked: true }),
		).toHaveAccessibleName(SHUFFLE_ALBUMS.english);
		await expectSettlesAt(player, () => playbackCommands(player), []);
		expect(player.player.playbackMode).toBe(ORDERS.indexOf(SHUFFLE_ALBUMS));
	});

	// Started at the player, so the log of what the app asked for stays empty.
	const openTheSheetOverAPlayingTrack = async (
		page: Page,
		player: FakePlayer,
	) => {
		await openLibrary(page);
		await page.request.post("/__control/play", {
			data: { playlistId: "p7", index: PLAYING_ROW },
		});
		await expect.poll(() => player.player.playbackState).toBe("playing");
		await openNowPlaying(page);
		await expect(orderButton(page, true)).toBeVisible();

		await orderButton(page, true).tap();
		await expect(sheet(page)).toBeVisible();
	};

	// The screen's cover wheel and the swipe that dismisses it listen for touches.
	test("choosing a row sends that order, changes the face, and neither skips nor closes the screen", async ({
		page,
		player,
	}) => {
		await openTheSheetOverAPlayingTrack(page, player);
		await sheet(page)
			.getByRole("menuitemradio", { name: REPEAT_TRACK.english, exact: true })
			.tap();

		await expectSettlesAt(player, () => playbackCommands(player), [
			"/api/playback/mode",
		]);
		expect(modesSent(player)).toEqual([REPEAT_TRACK.mode]);
		expect(playRequests(player)).toEqual([]);
		expect(player.playQueue).toEqual([]);
		expect(player.player.activeItem.index).toBe(PLAYING_ROW);
		expect(player.player.playbackState).toBe("playing");

		await expect(sheet(page)).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);
		await expect(orderButton(page, true)).toHaveAccessibleName(
			"Playback order: Repeat track",
		);
		await expect(faceOf(page, true)).toHaveClass(drawing(REPEAT_TRACK.icon));
	});

	test("a drag across the open sheet turns no cover", async ({
		page,
		player,
	}) => {
		await openTheSheetOverAPlayingTrack(page, player);

		await dragAcrossTheSheet(page, sheet(page));

		await expectSettlesAt(player, () => playbackCommands(player), []);
		expect(player.player.activeItem.index).toBe(PLAYING_ROW);
		await expectTheScreenIsStillOpen(page);
	});

	test("dragging the sheet away by its top edge closes the sheet and leaves the screen up", async ({
		page,
		player,
	}) => {
		await openTheSheetOverAPlayingTrack(page, player);

		await dragTheSheetAwayByItsTopEdge(page, sheet(page));

		await expect(sheet(page)).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);
		await expect(orderButton(page, true)).toBeVisible();
		await expectSettlesAt(player, () => playbackCommands(player), []);
	});

	test("a sideways drag that begins on the scrim closes the sheet and turns no cover", async ({
		page,
		player,
	}) => {
		await openTheSheetOverAPlayingTrack(page, player);

		await dragFromTheScrim(page, sheet(page), "left");

		await expect(sheet(page)).toHaveCount(0);
		await expectSettlesAt(player, () => playbackCommands(player), []);
		expect(player.player.activeItem.index).toBe(PLAYING_ROW);
		await expectTheScreenIsStillOpen(page);
	});

	test("a downward drag that begins on the scrim closes the sheet and leaves the screen up", async ({
		page,
		player,
	}) => {
		await openTheSheetOverAPlayingTrack(page, player);

		await dragFromTheScrim(page, sheet(page), "down");

		await expect(sheet(page)).toHaveCount(0);
		await expectTheScreenIsStillOpen(page);
		await expect(orderButton(page, true)).toBeVisible();
		await expectSettlesAt(player, () => playbackCommands(player), []);
	});
});

test.describe("an install offering two orders", () => {
	const DECLARED = [IN_ORDER, REPEAT_PLAYLIST];

	test.use({ playerState: offering(DECLARED, IN_ORDER) });
	test.beforeEach(({ page, isMobile }) => arriveAtTheTransport(page, isMobile));

	test("has the button in its transport, announcing no menu, and its face follows the player", async ({
		page,
		player,
		isMobile,
	}) => {
		const button = orderButton(page, isMobile);
		await expect(button).toHaveAccessibleName("Playback order: In order");
		await expect(button).toHaveAttribute("title", "Playback order: In order");
		await expect(faceOf(page, isMobile)).toHaveClass(drawing(IN_ORDER.icon));
		await expect(button).not.toHaveAttribute("aria-haspopup");
		await expect(button).not.toHaveAttribute("aria-expanded");
		await expect(button).not.toHaveAttribute("aria-pressed");

		moveThePlayerTo(player, REPEAT_PLAYLIST, DECLARED);

		await expect(button).toHaveAccessibleName(
			"Playback order: Repeat playlist",
		);
		await expect(button).toHaveAttribute(
			"title",
			"Playback order: Repeat playlist",
		);
		await expect(faceOf(page, isMobile)).toHaveClass(
			drawing(REPEAT_PLAYLIST.icon),
		);
		expect(modesSent(player)).toEqual([]);
	});

	test("a press sends the other order with no list, the face changing before the player answers, and the next press sends the first back", async ({
		page,
		player,
		isMobile,
	}) => {
		const button = orderButton(page, isMobile);
		// A poll answered after the press would draw the order the player is still in, and with
		// the write held nothing would correct it.
		await expect(button).toHaveAccessibleName("Playback order: In order");
		await holdThePoll(page);
		const held = await holdModeWrites(page);

		await button.click();
		await held.untilHeld();

		await expect(button).toHaveAccessibleName(
			"Playback order: Repeat playlist",
		);
		await expect(faceOf(page, isMobile)).toHaveClass(
			drawing(REPEAT_PLAYLIST.icon),
		);
		await expectNothingOpened(page);
		expect(modesSent(player)).toEqual([]);
		expect(player.player.playbackMode).toBe(DECLARED.indexOf(IN_ORDER));

		held.releaseAll();
		await expectSettlesAt(player, () => modesSent(player), [
			REPEAT_PLAYLIST.mode,
		]);

		await button.click();

		await expectSettlesAt(player, () => playbackCommands(player), [
			"/api/playback/mode",
			"/api/playback/mode",
		]);
		expect(modesSent(player)).toEqual([REPEAT_PLAYLIST.mode, IN_ORDER.mode]);
		expect(playRequests(player)).toEqual([]);
		await expect(button).toHaveAccessibleName("Playback order: In order");
		await expectNothingOpened(page);
	});
});

test.describe("an order chosen from the list", () => {
	test.use({ playerState: stockPlayerIn(IN_ORDER) });

	// Going to another view closes the now-playing screen on a compact viewport, so the button
	// read afterwards there is one drawn afresh.
	test("is still the button's name from another view", async ({
		page,
		isMobile,
	}) => {
		await arriveAtTheTransport(page, isMobile);
		await openList(page, isMobile);
		await orderRow(page, REPEAT_TRACK.english).click();
		await expect(orderButton(page, isMobile)).toHaveAccessibleName(
			"Playback order: Repeat track",
		);

		await page.goto("/#/all");
		await expect(
			page.getByRole("heading", { level: 1, name: "All music" }),
		).toBeVisible();
		if (isMobile) await expect(nowPlayingScreen(page)).toBeHidden();

		await globalControls(page, isMobile);
		await expect(orderButton(page, isMobile)).toHaveAccessibleName(
			"Playback order: Repeat track",
		);
	});
});

// Repeat playlist is declared first, so the first order as received is neither In order nor the
// first by name, and the unnamed one is last, where it shifts no position before it.
test.describe("an install offering two orders, with the player in one foo_jean cannot name", () => {
	const DECLARED = [REPEAT_PLAYLIST, IN_ORDER, UNNAMED];

	test.use({ playerState: offering(DECLARED, UNNAMED) });
	test.beforeEach(({ page, isMobile }) => arriveAtTheTransport(page, isMobile));

	test("shows a question mark and names no order, and a press sends the first of the two as received", async ({
		page,
		player,
		isMobile,
	}) => {
		const button = orderButton(page, isMobile);
		await expect(button).toHaveAccessibleName("Playback order");
		await expect(button).toHaveAttribute("title", "Playback order");
		await expect(faceOf(page, isMobile)).toHaveClass(drawing(UNNAMED_ICON));

		await button.click();

		await expectSettlesAt(player, () => modesSent(player), [
			REPEAT_PLAYLIST.mode,
		]);
		await expectNothingOpened(page);
		await expect(button).toHaveAccessibleName(
			"Playback order: Repeat playlist",
		);
		await expect(faceOf(page, isMobile)).toHaveClass(
			drawing(REPEAT_PLAYLIST.icon),
		);
	});
});

// The unnamed order sits second of four, so the three rows left are not the first three declared.
test.describe("an install offering three orders, with the player in one foo_jean cannot name", () => {
	const DECLARED = [RANDOM, UNNAMED, IN_ORDER, REPEAT_TRACK];
	const OFFERED = [RANDOM, IN_ORDER, REPEAT_TRACK];

	test.use({ playerState: offering(DECLARED, UNNAMED) });
	test.beforeEach(({ page, isMobile }) => arriveAtTheTransport(page, isMobile));

	test("keeps the button, with a grey question mark and no order named, and its list holds the three with none checked", async ({
		page,
		player,
		isMobile,
	}) => {
		const button = orderButton(page, isMobile);
		await expect(button).toHaveAccessibleName("Playback order");
		await expect(button).toHaveAttribute("title", "Playback order");
		await expect(faceOf(page, isMobile)).toHaveClass(drawing(UNNAMED_ICON));

		const transport = transportOf(page, isMobile);
		const grey = await tokenColourIn(
			transport,
			isMobile ? RESTING_GREY_ON_THE_SCREEN : RESTING_GREY,
		);
		expect(grey).not.toBe(await tokenColourIn(transport, ACCENT));
		await expectDrawnIn(faceOf(page, isMobile), grey);

		await openList(page, isMobile);
		if (isMobile) await expect(sheet(page)).toBeVisible();

		await expect(rows(page)).toHaveText(OFFERED.map((order) => order.english));
		await expect(checkedOrderRows(page)).toHaveCount(0);
		expect(modesSent(player)).toEqual([]);
	});
});

// Three is the fewest that still gets a list, and none of these three shuffles.
test.describe("an install offering three orders, none of them a shuffle", () => {
	const DECLARED = [IN_ORDER, REPEAT_PLAYLIST, REPEAT_TRACK];

	test.use({ playerState: offering(DECLARED, REPEAT_PLAYLIST) });
	test.beforeEach(({ page, isMobile }) => arriveAtTheTransport(page, isMobile));

	test("has the button, and its list holds those three", async ({
		page,
		isMobile,
	}) => {
		await expect(orderButton(page, isMobile)).toHaveAccessibleName(
			"Playback order: Repeat playlist",
		);
		await expect(orderButton(page, isMobile)).toHaveAttribute(
			"aria-haspopup",
			"menu",
		);

		await openList(page, isMobile);

		await expect(rows(page)).toHaveText(DECLARED.map((order) => order.english));
		await expect(checkedOrderRows(page)).toHaveAccessibleName(
			REPEAT_PLAYLIST.english,
		);
	});
});

for (const [offer, declared] of [
	["one order", [IN_ORDER]],
	["no order at all", []],
] as const) {
	test.describe(`an install offering ${offer}`, () => {
		test.use({ playerState: offering(declared) });

		test("has no order button in either transport, and no Shuffle button", async ({
			page,
			player,
			isMobile,
		}) => {
			await openLibrary(page);
			await expect(
				statusBar(page).getByRole("button", { name: /^(Play|Pause)$/ }),
			).toBeVisible();
			await untilTheInstallIsKnown(player);
			await expect(orderButton(page, false)).toHaveCount(0);

			await arriveAtTheTransport(page, isMobile);

			await expect(orderButton(page, isMobile)).toHaveCount(0);
			await expect(
				transportOf(page, isMobile).getByRole("button", {
					name: "Shuffle",
					exact: true,
				}),
			).toHaveCount(0);
		});
	});
}

// ---- in a session -----------------------------------------------------------

const DEVICE = "5f1c0a9e3b7d4e2a8c6b0d1f2e3a4b5c";

const SESSION_KEY = "jean.session";

// The install declares its seven in reverse, so its sequence is neither the session's nor
// alphabetical, and a list built from the install and filtered to the session's five shows it.
const DECLARED_IN_REVERSE = [...ORDERS].reverse();

const ORDERS_OF_THE_SESSION = DETACHED_PLAYBACK_MODES.map((mode) => {
	const order = ORDERS.find((one) => one.mode === mode);
	if (!order) throw new Error(`no order is named ${mode}`);
	return order;
});

const installSequenceOf = (orders: readonly Order[]) =>
	DECLARED_IN_REVERSE.filter((order) => orders.includes(order));

// Strict mode answers `500` to a session-scoped request naming no session, so one the page sends
// while it is in the session is caught here whatever it was for.
const watchRefusals = (page: Page) => {
	const refused: string[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		if (response.status() === 500 && url.pathname.startsWith("/api/"))
			refused.push(`${response.request().method()} ${url.pathname}`);
	});
	return refused;
};

const enterASessionOfItsOwn = async (
	page: Page,
	player: FakePlayer,
	{ listening = false } = {},
) => {
	const session = player.sessions.create({ deviceId: DEVICE, name: null });
	await page.addInitScript(
		({ key, stored }) => sessionStorage.setItem(key, stored),
		{
			key: SESSION_KEY,
			stored: JSON.stringify({ id: session.id, listening }),
		},
	);
	const refused = watchRefusals(page);
	player.fooJean.strictSessions = true;
	return { session, refused };
};

const holdTheDocumentListing = async (
	page: Page,
	session: DetachedSession,
	playbackModes: readonly string[],
) => {
	let holding = true;
	const waiting: (() => void)[] = [];
	let answered = 0;
	await page.route(
		(url) => url.pathname === `/api/sessions/${session.id}`,
		async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			if (holding) await new Promise<void>((go) => waiting.push(go));
			const response = await route.fetch().catch(() => null);
			if (!response) return;
			if (response.status() !== 200) {
				await route.fulfill({ response }).catch(() => {});
				return;
			}
			const document = await response.json();
			const { "content-length": _, ...headers } = response.headers();
			await route
				.fulfill({ response, headers, json: { ...document, playbackModes } })
				.catch(() => {});
			answered += 1;
		},
	);
	return {
		untilHeld: () => expect.poll(() => waiting.length).toBeGreaterThan(0),
		released: () => answered > 0,
		release: () => {
			holding = false;
			for (const go of waiting.splice(0)) go();
		},
	};
};

const answerTheStartListing = (page: Page, playbackModes: readonly string[]) =>
	page.route(
		(url) => url.pathname === "/api/sessions",
		async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			const response = await route.fetch();
			if (!response.ok()) return route.fulfill({ response });
			const document = await response.json();
			const { "content-length": _, ...headers } = response.headers();
			await route.fulfill({
				response,
				headers,
				json: { ...document, playbackModes },
			});
		},
	);

const OTHER_THAN_THE_FIVE = [
	SHUFFLE_TRACKS,
	REPEAT_TRACK,
	REPEAT_PLAYLIST,
	IN_ORDER,
];

const headerShuffle = (page: Page) =>
	viewHeader(page).getByRole("button", { name: "Shuffle", exact: true });

const START = "Play something else here";

const startASessionFromThePicker = async (
	page: Page,
	player: FakePlayer,
	isCompact: boolean,
) => {
	await statusBar(page)
		.getByRole("button", { name: /^Choose where to play/ })
		.click();
	await page.getByRole("button", { name: START, exact: true }).click();
	await expect
		.poll(() =>
			player.sessions
				.list()
				.flatMap((session) => session.roster())
				.some((device) => device.deviceId === DEVICE),
		)
		.toBe(true);
	if (isCompact) await putThePickerAway(page, true);
	else await page.keyboard.press("Escape");
	const [session] = player.sessions.list();
	if (!session) throw new Error("the start made no session");
	return session;
};

const modeWrites = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" &&
				entry.path.split("?")[0] === "/api/playback/mode",
		)
		.map((entry) => {
			const query = new URL(entry.path, "http://fake").searchParams;
			return {
				session: query.get("session"),
				deviceId: query.get("deviceId"),
				mode: entry.body?.mode,
			};
		});

test.describe("a page in a session of its own", () => {
	test.use({
		fooJean: { maxSessions: 4, canCreateSessions: true },
		settings: { "jean.deviceId": DEVICE },
		playerState: offering(DECLARED_IN_REVERSE, IN_ORDER),
	});

	test("lists exactly the session's own orders, in the sequence its document lists them", async ({
		page,
		player,
		isMobile,
	}) => {
		expect(installSequenceOf(ORDERS_OF_THE_SESSION)).not.toEqual(
			ORDERS_OF_THE_SESSION,
		);
		const { refused } = await enterASessionOfItsOwn(page, player);
		await arriveAtTheTransport(page, isMobile);

		await openList(page, isMobile);

		await expect(rows(page)).toHaveText(
			ORDERS_OF_THE_SESSION.map((order) => order.english),
		);
		expect(refused).toEqual([]);
	});

	test("choosing an order sends it naming the session, moves the session's order and leaves the player's where it was", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused } = await enterASessionOfItsOwn(page, player);
		await arriveAtTheTransport(page, isMobile);
		await openList(page, isMobile);

		await orderRow(page, REPEAT_TRACK.english).click();

		await expectSettlesAt(player, () => modeWrites(player), [
			{ session: session.id, deviceId: DEVICE, mode: REPEAT_TRACK.mode },
		]);
		expect(session.mode).toBe(REPEAT_TRACK.mode);
		expect(player.player.playbackMode).toBe(
			DECLARED_IN_REVERSE.indexOf(IN_ORDER),
		);
		await expect(orderButton(page, isMobile)).toHaveAccessibleName(
			`Playback order: ${REPEAT_TRACK.english}`,
		);
		expect(refused).toEqual([]);
	});

	test("loaded again while listening, offers the contract's five before the document is read, and the document's list once it is", async ({
		page,
		player,
		isMobile,
	}) => {
		const { session, refused } = await enterASessionOfItsOwn(page, player, {
			listening: true,
		});
		const read = await holdTheDocumentListing(
			page,
			session,
			OTHER_THAN_THE_FIVE.map((order) => order.mode),
		);
		await openLibrary(page);
		await read.untilHeld();

		await expect(headerShuffle(page)).toBeEnabled();
		await globalControls(page, isMobile);
		await openList(page, isMobile);
		await expect(rows(page)).toHaveText(
			ORDERS_OF_THE_SESSION.map((order) => order.english),
		);
		expect(read.released()).toBe(false);
		await page.keyboard.press("Escape");
		await expectNothingOpened(page);

		read.release();
		await expect.poll(() => read.released()).toBe(true);
		await openList(page, isMobile);
		await expect(rows(page)).toHaveText(
			OTHER_THAN_THE_FIVE.map((order) => order.english),
		);
		expect(refused).toEqual([]);
	});

	test("after a start, offers the list the start's answer carried, with no read of its document answered", async ({
		page,
		player,
		isMobile,
	}) => {
		const refused = watchRefusals(page);
		await answerTheStartListing(
			page,
			OTHER_THAN_THE_FIVE.map((order) => order.mode),
		);
		const reads = await holdRequests(
			page,
			(request) =>
				request.method() === "GET" &&
				/^\/api\/sessions\/[^/]+$/.test(new URL(request.url()).pathname),
		);
		await openLibrary(page);
		await startASessionFromThePicker(page, player, isMobile);
		await untilQuiet(player);
		player.fooJean.strictSessions = true;

		await expect(headerShuffle(page)).toBeEnabled();
		await globalControls(page, isMobile);
		await openList(page, isMobile);

		await expect(rows(page)).toHaveText(
			OTHER_THAN_THE_FIVE.map((order) => order.english),
		);
		reads.releaseAll();
		expect(refused).toEqual([]);
	});
});
