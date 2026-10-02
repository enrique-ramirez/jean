import type { FakePlayerState } from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	holdRequests,
	holdThePoll,
	inSequence,
	openLibrary,
	playRequests,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

// foobar2000's stock playback orders, in the sequence its own Order menu lists them and the fake
// declares them: Random is fourth, between the repeats and the shuffles. `declared` is foobar2000's
// name for the order, which is what `enumNames` takes. The rest of a row is what Jean calls that
// order in each language and the Lucide icon it draws for it.
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

const ACCENTED = ORDERS.filter((order) => order !== IN_ORDER);

// ---- the player --------------------------------------------------------------

// A player declaring `orders` in that sequence and sitting in `current`. The fake holds the order
// as a position in what it declares, so the position is taken from the same list.
const offering = (
	orders: readonly Order[],
	current: Order,
): Partial<FakePlayerState> => ({
	playbackMode: orders.indexOf(current),
	options: [
		{
			id: "playbackOrder",
			name: "Playback order",
			type: "enum",
			value: orders.indexOf(current),
			enumNames: orders.map((order) => order.declared),
		},
	],
});

const stockPlayerIn = (current: Order) => offering(ORDERS, current);

// The order changed at the player itself, as foobar2000's own window or another Jean changes it.
// Only for a player declaring the stock seven, whose positions `ORDERS` shares.
const moveThePlayerTo = (player: FakePlayer, order: Order) =>
	player.patchPlayer({
		options: [{ id: "playbackOrder", value: ORDERS.indexOf(order) }],
	});

const modesSent = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) => entry.method === "POST" && entry.path === "/api/playback/mode",
		)
		.map((entry) => entry.body?.mode);

// Play-pause, seek, skip, stop and the order itself: everything a key reaching the player would
// send. Starting a row is a playlist route and is not among them.
const playbackCommands = (player: FakePlayer) =>
	player.requests
		.filter(
			(entry) =>
				entry.method === "POST" && entry.path.startsWith("/api/playback/"),
		)
		.map((entry) => entry.path);

const startATrack = async (page: Page, player: FakePlayer) => {
	await trackRow(page, 1).dblclick();
	await expect.poll(() => player.player.playbackState).toBe("playing");
};

// ---- the button and its list on a desktop --------------------------------------

const orderButton = (page: Page, title = "Playback order") =>
	statusBar(page).getByRole("button", { name: new RegExp(`^${title}`) });

const faceOf = (page: Page) => orderButton(page).locator("svg");

// lucide-react puts `lucide-{name}` on the `svg` it draws, among other classes.
const drawing = (icon: string) => new RegExp(`(^|\\s)lucide-${icon}(\\s|$)`);

// The transport is drawn once the player has answered, and a key pressed before the button exists
// is not held for it.
const arrive = async (page: Page, title?: string) => {
	await openLibrary(page);
	await expect(orderButton(page, title)).toBeVisible();
};

const list = (page: Page) => page.getByRole("menu");

const rows = (page: Page) => list(page).getByRole("menuitemradio");

const rowOf = (page: Page, name: string) =>
	list(page).getByRole("menuitemradio", { name, exact: true });

const checkedRows = (page: Page) =>
	list(page).getByRole("menuitemradio", { checked: true });

const iconOf = (row: Locator) => row.locator("svg").first();

const openList = async (page: Page) => {
	await orderButton(page).click();
	await expect(list(page)).toBeVisible();
};

// ---- colour ------------------------------------------------------------------

// What a custom property resolves to on this page, in the form Chromium computes a colour to.
const tokenColour = (page: Page, token: string) =>
	page.evaluate((name) => {
		const probe = document.createElement("span");
		probe.style.color = `var(${name})`;
		document.body.append(probe);
		const colour = getComputedStyle(probe).color;
		probe.remove();
		return colour;
	}, token);

// A Lucide icon is strokes and no fill, and Chromium computes a stroke of `currentColor` to the
// colour it resolves to.
const drawnColour = (icon: Locator) =>
	icon.evaluate((svg) => getComputedStyle(svg).stroke);

// Polled, since a colour partway through a transition computes to `oklab()` in Chromium and to the
// token's own value only once it lands.
const expectDrawnIn = (icon: Locator, colour: string) =>
	expect.poll(() => drawnColour(icon)).toBe(colour);

const ACCENT = "--accent-text";

// What the shuffle toggle was drawn in at rest in the status bar.
const RESTING_GREY = "--faint";

const OKLCH = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/;

// A row's icon has greys of its own to choose from, so In order's is held to being a grey at all:
// both themes' accent sits well above this chroma and every grey in the palette well below it.
const GREY_MAX_CHROMA = 0.05;

const chromaOf = (colour: string) => Number(OKLCH.exec(colour)?.[2]);

// ---- boxes -------------------------------------------------------------------

// A popover is measured and placed after it mounts, so the box is read once it has stopped moving.
const restingBox = async (target: Locator) => {
	let last = "null";
	await expect
		.poll(async () => {
			const now = JSON.stringify(await target.boundingBox());
			const isStill = now !== "null" && now === last;
			last = now;
			return isStill;
		})
		.toBe(true);
	return JSON.parse(last) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
};

const rightOf = (box: { x: number; width: number }) => box.x + box.width;
const bottomOf = (box: { y: number; height: number }) => box.y + box.height;

test.describe("on a desktop", () => {
	test.skip(
		({ isMobile }) => isMobile,
		"a compact viewport has no order button in its status bar, and its list is an action sheet",
	);

	test.describe("the status bar", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => arrive(page));

		test("has one playback order button where the shuffle toggle was, and no shuffle toggle", async ({
			page,
		}) => {
			const buttons = statusBar(page).getByRole("button");

			await expect(buttons.nth(0)).toHaveAccessibleName("Show current track");
			await expect(buttons.nth(1)).toHaveAccessibleName(/^Playback order/);
			await expect(buttons.nth(2)).toHaveAccessibleName("Previous track");
			await expect(orderButton(page)).toHaveCount(1);
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
				await arrive(page);
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			});

			test.describe("in In order", () => {
				test.use({ playerState: stockPlayerIn(IN_ORDER) });

				test("is In order's icon, in the grey the shuffle toggle had at rest", async ({
					page,
				}) => {
					await expect(faceOf(page)).toHaveClass(drawing(IN_ORDER.icon));
					await expect(orderButton(page)).toHaveAccessibleName(
						`Playback order: ${IN_ORDER.english}`,
					);

					const grey = await tokenColour(page, RESTING_GREY);
					expect(grey).not.toBe(await tokenColour(page, ACCENT));
					await expectDrawnIn(faceOf(page), grey);
				});
			});

			for (const order of ACCENTED) {
				test.describe(`in ${order.english}`, () => {
					test.use({ playerState: stockPlayerIn(order) });

					test("is that order's icon, in the accent at rest, hovered and with the list open", async ({
						page,
					}) => {
						await expect(faceOf(page)).toHaveClass(drawing(order.icon));
						await expect(orderButton(page)).toHaveAccessibleName(
							`Playback order: ${order.english}`,
						);

						const accent = await tokenColour(page, ACCENT);
						expect(accent).not.toBe(await tokenColour(page, RESTING_GREY));
						await expectDrawnIn(faceOf(page), accent);

						// The toggle turned to the text colour under the pointer, which on this button
						// would read as the order having changed.
						await orderButton(page).hover();
						await expectDrawnIn(faceOf(page), accent);

						await openList(page);
						await expectDrawnIn(faceOf(page), accent);
						await page.mouse.move(1, 1);
						await expectDrawnIn(faceOf(page), accent);
					});
				});
			}
		});
	}

	test.describe("the button, as it is announced", () => {
		test.use({ playerState: stockPlayerIn(REPEAT_PLAYLIST) });
		test.beforeEach(({ page }) => arrive(page));

		test("its name and its tooltip are the order the player is in, and follow it", async ({
			page,
			player,
		}) => {
			const button = orderButton(page);
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
			const button = orderButton(page);
			await expect(button).toHaveAttribute("aria-haspopup", "menu");
			await expect(button).toHaveAttribute("aria-expanded", "false");
			await expect(button).not.toHaveAttribute("aria-pressed");

			await button.click();
			await expect(list(page)).toBeVisible();
			await expect(button).toHaveAttribute("aria-expanded", "true");
			await expect(button).not.toHaveAttribute("aria-pressed");

			await page.keyboard.press("Escape");
			await expect(list(page)).toHaveCount(0);
			await expect(button).toHaveAttribute("aria-expanded", "false");
		});
	});

	test.describe("an order changed somewhere else", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => arrive(page));

		test("moves the name, the face and an open list's tick within one poll", async ({
			page,
			player,
		}) => {
			await openList(page);
			await expect(checkedRows(page)).toHaveAccessibleName(IN_ORDER.english);

			const poll = await holdThePoll(page);
			moveThePlayerTo(player, SHUFFLE_FOLDERS);
			poll.letOneThrough();

			await expect(orderButton(page)).toHaveAccessibleName(
				"Playback order: Shuffle folders",
			);
			await expect(faceOf(page)).toHaveClass(drawing(SHUFFLE_FOLDERS.icon));
			await expect(checkedRows(page)).toHaveAccessibleName(
				SHUFFLE_FOLDERS.english,
			);
			await expect(rows(page)).toHaveCount(ORDERS.length);
			expect(modesSent(player)).toEqual([]);
		});
	});

	test.describe("pressing the button", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => arrive(page));

		test("a click opens the list wholly above the button, headed Playback order, and sends nothing", async ({
			page,
			player,
		}) => {
			await openList(page);
			await expect(list(page)).toHaveCount(1);
			await expect(rows(page)).toHaveCount(ORDERS.length);

			const heading = page.getByText("Playback order", { exact: true });
			await expect(heading).toBeVisible();

			const menu = await restingBox(list(page));
			const button = await restingBox(orderButton(page));
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
				await orderButton(page).focus();
				await page.keyboard.press(key);

				await expect(list(page)).toBeVisible();
				await expect(rows(page)).toHaveCount(ORDERS.length);
				await expectSettlesAt(player, () => playbackCommands(player), []);
				expect(playRequests(player)).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(IN_ORDER));
			});
		}
	});

	test.describe("the list's rows", () => {
		test.use({ playerState: stockPlayerIn(IN_ORDER) });
		test.beforeEach(({ page }) => arrive(page));

		test("are the seven orders by Jean's English names, in the player's sequence, with no separator", async ({
			page,
		}) => {
			await openList(page);

			await expect(rows(page)).toHaveText(ORDERS.map((order) => order.english));
			await expect(list(page).getByRole("menuitem")).toHaveCount(0);
			await expect(list(page).getByRole("separator")).toHaveCount(0);
		});
	});

	// Sorted, this declaration reads In order, Random, Repeat track, Shuffle folders, and in Jean's
	// own table In order, Repeat track, Shuffle folders, Random. Neither is the sequence declared.
	test.describe("a player declaring four orders in a sequence of its own", () => {
		const DECLARED = [SHUFFLE_FOLDERS, IN_ORDER, RANDOM, REPEAT_TRACK];

		test.use({ playerState: offering(DECLARED, RANDOM) });
		test.beforeEach(({ page }) => arrive(page));

		test("gets those four rows in that sequence, and no other", async ({
			page,
		}) => {
			await expect(orderButton(page)).toHaveAccessibleName(
				"Playback order: Random",
			);
			await openList(page);

			await expect(rows(page)).toHaveText(
				DECLARED.map((order) => order.english),
			);
			await expect(list(page).getByRole("menuitem")).toHaveCount(0);
			await expect(checkedRows(page)).toHaveAccessibleName(RANDOM.english);
		});
	});

	// Two players, so every row is read at least once while another row is the current one, and
	// In order's and an accented one's are each read both ways.
	for (const current of [IN_ORDER, REPEAT_PLAYLIST]) {
		test.describe(`a row's icon, with the player in ${current.english}`, () => {
			test.use({ playerState: stockPlayerIn(current) });
			test.beforeEach(({ page }) => arrive(page));

			test("is its order's, at the left of its name, in the accent for every order but In order", async ({
				page,
			}) => {
				await openList(page);
				await expect(checkedRows(page)).toHaveAccessibleName(current.english);
				const accent = await tokenColour(page, ACCENT);

				await inSequence(ORDERS, async (order) => {
					const row = rowOf(page, order.english);
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
			test.beforeEach(({ page }) => arrive(page));

			test("every row is a radio item, and only the current one is checked and ticked after its name", async ({
				page,
			}) => {
				await openList(page);

				await expect(rows(page)).toHaveCount(ORDERS.length);
				await expect(rowOf(page, RANDOM.english)).toHaveAttribute(
					"aria-checked",
					"true",
				);
				await expect(checkedRows(page)).toHaveCount(1);

				// A row's icon is its first drawing. The tick is the one more the current row has.
				await inSequence(ORDERS, (order) =>
					expect(rowOf(page, order.english).locator("svg")).toHaveCount(
						order === RANDOM ? 2 : 1,
					),
				);

				const current = rowOf(page, RANDOM.english);
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
				await openList(page);
				await expect(rowOf(page, RANDOM.english)).toBeFocused();

				await page.keyboard.press("ArrowDown");
				await expect(rowOf(page, SHUFFLE_TRACKS.english)).toBeFocused();

				await page.keyboard.press("ArrowUp");
				await page.keyboard.press("ArrowUp");
				await expect(rowOf(page, REPEAT_TRACK.english)).toBeFocused();

				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(checkedRows(page)).toHaveAccessibleName(RANDOM.english);
			});
		});

		test.describe("with the player in In order", () => {
			test.use({ playerState: stockPlayerIn(IN_ORDER) });
			test.beforeEach(({ page }) => arrive(page));

			test("the arrows wrap at both ends", async ({ page }) => {
				await openList(page);
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();

				await page.keyboard.press("ArrowUp");
				await expect(rowOf(page, SHUFFLE_FOLDERS.english)).toBeFocused();

				await page.keyboard.press("ArrowDown");
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();
			});

			test("Enter chooses the focused row, closes the list and puts focus back on the button", async ({
				page,
				player,
			}) => {
				await openList(page);
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await page.keyboard.press("ArrowDown");
				await expect(rowOf(page, REPEAT_TRACK.english)).toBeFocused();

				await page.keyboard.press("Enter");

				await expectSettlesAt(player, () => modesSent(player), [
					REPEAT_TRACK.mode,
				]);
				await expect(list(page)).toHaveCount(0);
				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
				await expect(orderButton(page)).toBeFocused();
				// Enter is also what plays the selected row of the list behind the menu.
				expect(playRequests(player)).toEqual([]);
			});

			test("Space chooses the focused row and does not pause the track playing", async ({
				page,
				player,
			}) => {
				await startATrack(page, player);
				await openList(page);
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await expect(rowOf(page, REPEAT_PLAYLIST.english)).toBeFocused();

				await page.keyboard.press("Space");

				await expectSettlesAt(player, () => playbackCommands(player), [
					"/api/playback/mode",
				]);
				expect(modesSent(player)).toEqual([REPEAT_PLAYLIST.mode]);
				expect(player.player.playbackState).toBe("playing");
				await expect(list(page)).toHaveCount(0);
				await expect(orderButton(page)).toBeFocused();
			});

			test("Escape closes the list, sends nothing and puts focus back on the button", async ({
				page,
				player,
			}) => {
				await openList(page);
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();
				await page.keyboard.press("ArrowDown");
				await expect(rowOf(page, REPEAT_PLAYLIST.english)).toBeFocused();

				await page.keyboard.press("Escape");

				await expect(list(page)).toHaveCount(0);
				await expect(orderButton(page)).toBeFocused();
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: In order",
				);
			});

			// With nothing playing a seek has nothing to act on, and the guard would pass unguarded.
			test("no arrow typed at the list seeks the track playing", async ({
				page,
				player,
			}) => {
				await startATrack(page, player);
				await openList(page);
				await expect(rowOf(page, IN_ORDER.english)).toBeFocused();

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
			test.beforeEach(({ page }) => arrive(page));

			test("sends that order once, closes the list and starts nothing", async ({
				page,
				player,
			}) => {
				await openList(page);
				await rowOf(page, SHUFFLE_ALBUMS.english).click();

				await expectSettlesAt(player, () => playbackCommands(player), [
					"/api/playback/mode",
				]);
				expect(modesSent(player)).toEqual([SHUFFLE_ALBUMS.mode]);
				expect(playRequests(player)).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(SHUFFLE_ALBUMS));
				expect(player.player.playbackState).toBe("stopped");
				await expect(list(page)).toHaveCount(0);
				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: Shuffle albums",
				);
			});

			test("changes the name and the face before the player has answered", async ({
				page,
				player,
			}) => {
				const held = await holdRequests(
					page,
					(request) =>
						request.method() === "POST" &&
						new URL(request.url()).pathname === "/api/playback/mode",
				);
				await openList(page);
				await rowOf(page, REPEAT_TRACK.english).click();
				await held.untilHeld();

				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
				await expect(faceOf(page)).toHaveClass(drawing(REPEAT_TRACK.icon));
				await expect(list(page)).toHaveCount(0);
				// Still on its way: the player has neither seen the write nor moved.
				expect(modesSent(player)).toEqual([]);
				expect(player.player.playbackMode).toBe(ORDERS.indexOf(IN_ORDER));

				held.releaseAll();

				await expectSettlesAt(player, () => modesSent(player), [
					REPEAT_TRACK.mode,
				]);
				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: Repeat track",
				);
			});
		});

		test.describe("that is already the current one", () => {
			test.use({ playerState: stockPlayerIn(REPEAT_PLAYLIST) });
			test.beforeEach(({ page }) => arrive(page));

			test("sends nothing and closes the list", async ({ page, player }) => {
				await openList(page);
				await rowOf(page, REPEAT_PLAYLIST.english).click();

				await expect(list(page)).toHaveCount(0);
				await expectSettlesAt(player, () => playbackCommands(player), []);
				await expect(orderButton(page)).toHaveAccessibleName(
					"Playback order: Repeat playlist",
				);
			});
		});
	});

	test.describe("in a browser that asks for Spanish", () => {
		const TITLE = "Orden de reproducción";

		test.use({ locale: "es-AR", playerState: stockPlayerIn(REPEAT_PLAYLIST) });
		test.beforeEach(({ page }) => arrive(page, TITLE));

		test("the button's name, the list's heading and the seven rows read in Spanish", async ({
			page,
		}) => {
			await expect(page.locator("html")).toHaveAttribute("lang", "es");

			const button = orderButton(page, TITLE);
			await expect(button).toHaveAccessibleName(`${TITLE}: Repetir lista`);
			await expect(button).toHaveAttribute("title", `${TITLE}: Repetir lista`);

			await button.click();

			await expect(page.getByText(TITLE, { exact: true })).toBeVisible();
			await expect(rows(page)).toHaveText(ORDERS.map((order) => order.spanish));
		});
	});
});
