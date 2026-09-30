import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	openAllMusic,
	openSidebar,
	refusePlaylistWrites,
	test,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";

const WITH_AUTOPLAYLISTS = { maxAutoPlaylists: 100 };

// Phrases the catalogue gains with the dialog, written out so a missing key reads as a missing
// line rather than as `getByText(undefined)`.
const UNTITLED = "New autoplaylist";
const TYPE_QUERY = "Type a query to see what it collects";
const NO_MATCHES = "Nothing matches this query";
const QUERY_FAILED = "foobar2000 could not read the query";
const createFailed = (error: string) =>
	`The autoplaylist was not created: ${error}`;

// What `foo_jean` answers a playlist write with while `writePlaylists` is off.
const WRITES_OFF =
	"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them";

const GRUNGE = 'genre IS "Grunge"';
const POST_ROCK = 'genre IS "Post Rock"';
const INVALID = "genre IS ((";

const dialogOf = (page: Page) =>
	page.getByRole("dialog", { name: "New autoplaylist" });
const nameField = (dialog: Locator) =>
	dialog.getByRole("textbox", { name: "Name" });
const queryField = (dialog: Locator) =>
	dialog.getByRole("combobox", { name: "Query" });
const createButton = (dialog: Locator) =>
	dialog.getByRole("button", { name: "Create", exact: true });
const closeButton = (dialog: Locator) =>
	dialog.getByRole("button", { name: "Close", exact: true });
const results = (dialog: Locator) => dialog.locator("[data-results]");
const resultRows = (dialog: Locator) =>
	results(dialog).locator("[data-result-row]");
const statsLine = (dialog: Locator) =>
	dialog
		.locator('[data-stats], [role="status"]')
		.filter({ hasText: /tracks?/ });

const previews = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "POST" && entry.path === "/api/autoplaylists/preview",
	);
const creates = (player: FakePlayer) =>
	player.requests.filter(
		(entry) => entry.method === "POST" && entry.path === "/api/autoplaylists",
	);

const openDialog = async (page: Page) => {
	await openSidebar(page);
	await page.getByRole("button", { name: "New playlist" }).click();
	await page
		.getByRole("menuitem", { name: "Autoplaylist", exact: true })
		.click();
	const dialog = dialogOf(page);
	await expect(dialog).toBeVisible();
	return dialog;
};

// All music first, since it waits for the library's rows: the dialog projects its results from the
// library snapshot, so a case opening it before the snapshot lands tests the loading state instead.
const openApp = async (page: Page) => {
	await openAllMusic(page);
	return openDialog(page);
};

test.describe("the autoplaylist dialog", () => {
	test.use({ fooJean: WITH_AUTOPLAYLISTS });

	test.describe("opening it (criterion 19)", () => {
		test("is titled New autoplaylist, puts the caret in the query field and names itself", async ({
			page,
		}) => {
			const dialog = await openApp(page);

			await expect(queryField(dialog)).toBeFocused();
			await expect(queryField(dialog)).toHaveValue("");
			await expect(nameField(dialog)).toHaveValue(UNTITLED);
		});

		test("numbers the name past the ones the player already holds, as a new playlist's is numbered", async ({
			page,
			player,
		}) => {
			// Base and 3 taken, 2 free: a name that always appends 2, or counts the ones taken and
			// adds one, lands on a name the sidebar already shows.
			player.renamePlaylist("p2", "New autoplaylist");
			player.renamePlaylist("p5", "New autoplaylist 3");
			const dialog = await openApp(page);

			await expect(nameField(dialog)).toHaveValue("New autoplaylist 2");
		});

		test("fills the screen on a phone with the primary action in its header, and sits centred with Cancel and Create below the results on a desktop", async ({
			page,
			isMobile,
		}) => {
			const dialog = await openApp(page);
			await queryField(dialog).fill(GRUNGE);
			await expect(resultRows(dialog).first()).toBeVisible();

			const box = (await dialog.boundingBox())!;
			const viewport = page.viewportSize()!;
			const create = (await createButton(dialog).boundingBox())!;
			const name = (await nameField(dialog).boundingBox())!;

			if (isMobile) {
				// The mobile project sets no safe-area inset, so full screen within the insets is the
				// whole viewport.
				expect(box).toEqual({
					x: 0,
					y: 0,
					width: viewport.width,
					height: viewport.height,
				});

				// Above the fields, so a software keyboard never covers it.
				const title = (await dialog
					.getByRole("heading", { name: "New autoplaylist" })
					.boundingBox())!;
				const close = (await closeButton(dialog).boundingBox())!;
				expect(create.y + create.height).toBeLessThanOrEqual(name.y);
				expect(create.x).toBeGreaterThanOrEqual(title.x + title.width);
				expect(close.x + close.width).toBeLessThanOrEqual(title.x);
				return;
			}

			expect(
				Math.abs(box.x + box.width / 2 - viewport.width / 2),
			).toBeLessThanOrEqual(1);
			expect(
				Math.abs(box.y + box.height / 2 - viewport.height / 2),
			).toBeLessThanOrEqual(1);
			expect(box.width).toBeLessThan(viewport.width);

			const cancel = (await dialog
				.getByRole("button", { name: en["action.cancel"], exact: true })
				.boundingBox())!;
			const list = (await results(dialog).boundingBox())!;
			expect(cancel.y).toBeGreaterThanOrEqual(list.y + list.height);
			expect(create.y).toBeGreaterThanOrEqual(list.y + list.height);
			expect(Math.abs(cancel.y - create.y)).toBeLessThanOrEqual(1);
			expect(cancel.x + cancel.width).toBeLessThanOrEqual(create.x);
		});
	});

	test.describe("previewing as the person types (criterion 20)", () => {
		test("asks the player once per pause, not per keystroke, and asks for the rows each time", async ({
			page,
			player,
		}) => {
			const dialog = await openApp(page);
			const query = queryField(dialog);

			// 25 ms apart, well inside any debounce worth having: a preview per keystroke would be
			// seventeen here and runs the whole Media Library on foobar2000's main thread each time.
			await query.pressSequentially(GRUNGE, { delay: 25 });
			await expectSettlesAt(player, () => previews(player).length, 1);

			const both = `${GRUNGE} OR genre IS "Post Rock"`;
			await query.pressSequentially(' OR genre IS "Post Rock"', { delay: 25 });
			await expectSettlesAt(player, () => previews(player).length, 2);

			expect(
				previews(player).map((entry) => [entry.body?.query, entry.body?.rows]),
			).toEqual([
				[GRUNGE, true],
				[both, true],
			]);
		});

		test.describe("what the matches add up to", () => {
			// Every captured album has one album artist and one genre, so without this the albums
			// and the album artists always agree and a stats line swapping them would pass.
			test.use({
				retagged: { "Whale & Wasp": { "%album%": "Sap" } },
			});

			test("counts the album artists, albums and tracks among the matches and their total length", async ({
				page,
			}) => {
				const dialog = await openApp(page);
				await queryField(dialog).fill(`${GRUNGE} OR genre IS "Post Rock"`);

				await expect(statsLine(dialog)).toHaveText(
					/2 album artists\s*·\s*3 albums\s*·\s*20 tracks\s*·\s*1 hr 55 min/,
				);
			});
		});

		test("shows the matching tracks with their artist, album and length", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			await queryField(dialog).fill(GRUNGE);

			const first = resultRows(dialog).first();
			await expect(first).toContainText("Rotten Apple");
			await expect(first).toContainText("Alice in Chains · Jar Of Flies");
			await expect(first).toContainText("6:59");
			await expect(statsLine(dialog)).toHaveText(
				/1 album artist\s*·\s*1 album\s*·\s*7 tracks\s*·\s*30 min/,
			);
		});

		test("an empty query asks nothing, and emptying one takes its results away", async ({
			page,
			player,
		}) => {
			const dialog = await openApp(page);
			await expect(dialog.getByText(TYPE_QUERY)).toBeVisible();
			await expectSettlesAt(player, () => previews(player).length, 0);

			await queryField(dialog).fill(GRUNGE);
			await expect(statsLine(dialog)).toContainText("7 tracks");
			await expectSettlesAt(player, () => previews(player).length, 1);

			await queryField(dialog).fill("");
			await expect(dialog.getByText(TYPE_QUERY)).toBeVisible();
			await expect(resultRows(dialog)).toHaveCount(0);
			await expect(dialog.getByText("7 tracks")).toHaveCount(0);
			await expectSettlesAt(player, () => previews(player).length, 1);
		});

		test("a query nothing matches says so", async ({ page }) => {
			const dialog = await openApp(page);
			await queryField(dialog).fill('genre IS "Polka"');

			await expect(dialog.getByText(NO_MATCHES)).toBeVisible();
			await expect(resultRows(dialog)).toHaveCount(0);
		});
	});

	test("a query foobar2000 cannot read shows its own message in place of the results, and Create is disabled (criterion 21)", async ({
		page,
	}) => {
		const dialog = await openApp(page);
		await queryField(dialog).fill(GRUNGE);
		await expect(statsLine(dialog)).toContainText("7 tracks");
		await expect(createButton(dialog)).toBeEnabled();

		await queryField(dialog).fill(INVALID);

		await expect(dialog.getByText(QUERY_FAILED)).toBeVisible();
		await expect(dialog.getByText("Query syntax error")).toBeVisible();
		// Read once the refusal is on screen, so the rows had their chance to go.
		await expect(resultRows(dialog)).toHaveCount(0);
		await expect(dialog.getByText("7 tracks")).toHaveCount(0);
		await expect(createButton(dialog)).toBeDisabled();
	});

	test.describe("a player with no Media Library (criterion 22)", () => {
		test.use({ fooJean: { ...WITH_AUTOPLAYLISTS, libraryEnabled: false } });

		test("says an autoplaylist would stay empty, and Create is disabled", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			await nameField(dialog).fill("Everything");
			await queryField(dialog).fill("ALL");

			await expect(dialog.getByText(en["genre.noMediaLibrary"])).toBeVisible();
			await expect(createButton(dialog)).toBeDisabled();
		});
	});

	test.describe("suggestions at the caret (criterion 23)", () => {
		const listbox = (page: Page) => page.getByRole("listbox");
		const options = (page: Page) => listbox(page).getByRole("option");

		test("the query field is a combobox whose listbox opens with suggestions and the arrow keys walk", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			const query = queryField(dialog);
			await expect(query).toHaveAttribute("aria-autocomplete", "list");

			// Three fields begin with "a": artist, album artist and album.
			await query.pressSequentially("a");
			await expect(listbox(page)).toBeVisible();
			await expect(query).toHaveAttribute("aria-expanded", "true");
			expect(await options(page).count()).toBeGreaterThanOrEqual(3);

			const active = async () => {
				const id = await query.getAttribute("aria-activedescendant");
				expect(id, "an arrow key leaves an option active").toBeTruthy();
				await expect(
					listbox(page).locator(`[role="option"][id="${id}"]`),
				).toHaveCount(1);
				return id;
			};

			await query.press("ArrowDown");
			const first = await active();
			await query.press("ArrowDown");
			const second = await active();
			expect(second).not.toBe(first);
			await query.press("ArrowUp");
			expect(await active()).toBe(first);
		});

		test("Tab inserts a field, an operator and a joining keyword, and the caret stays in the field", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			const query = queryField(dialog);

			await query.pressSequentially("gen");
			await expect(options(page).first()).toBeVisible();
			await query.press("Tab");
			await expect(query).toHaveValue(/^genre ?$/);
			await expect(query).toBeFocused();

			await query.fill("");
			await query.pressSequentially("genre I");
			await expect(options(page).first()).toBeVisible();
			await query.press("Tab");
			await expect(query).toHaveValue(/^genre IS ?$/);

			await query.fill("");
			await query.pressSequentially('genre IS "Grunge" O');
			await expect(options(page).first()).toBeVisible();
			await query.press("Tab");
			await expect(query).toHaveValue(/^genre IS "Grunge" OR ?$/);
			await expect(query).toBeFocused();
		});

		test("Enter inserts a value matched through fold, quoted where it holds a space", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			const query = queryField(dialog);

			await query.pressSequentially("artist IS babason");
			await expect(options(page)).toHaveCount(1);
			await query.press("ArrowDown");
			await query.press("Enter");
			await expect(query).toHaveValue(/^artist IS Babasónicos ?$/);

			await query.fill("");
			await query.pressSequentially("album IS deja");
			await expect(options(page)).toHaveCount(1);
			await query.press("ArrowDown");
			await query.press("Enter");
			await expect(query).toHaveValue(/^album IS "Deja Entendu" ?$/);

			await expect(statsLine(dialog)).toContainText("11 tracks");
		});

		test("Escape closes the suggestions and leaves the dialog open, and a second Escape closes the dialog", async ({
			page,
		}) => {
			const dialog = await openApp(page);
			const query = queryField(dialog);

			await query.pressSequentially("gen");
			await expect(listbox(page)).toBeVisible();

			await query.press("Escape");
			await expect(listbox(page)).toHaveCount(0);
			await expect(query).not.toHaveAttribute("aria-expanded", "true");
			await expect(dialog).toBeVisible();
			await expect(query).toHaveValue("gen");

			await query.press("Escape");
			await expect(dialog).toHaveCount(0);
		});
	});

	test.describe("a query matching the whole of a large library (criterion 24)", () => {
		// The largest library the suite builds. As ordinals the answer is a body of tens of
		// thousands of numbers, and every one of them has to reach the list.
		test.use({ mediaLibrarySize: 30441 });

		// Counted from the answer landing: tighter than the suite's ceiling, which a dialog blocking
		// the main thread would sit inside of.
		const FIRST_ROWS_MS = 10_000;

		test("draws its first rows and its stats, and scrolls to the last match without reading a playlist", async ({
			page,
			player,
		}) => {
			const dialog = await openApp(page);
			// The fake sorts every path of this library the first time it previews, which under a
			// full run of workers outlasts the timeout Jean gives a preview. That sort is the fake's
			// cost rather than the player's, so it is paid here, before anything is typed.
			player.previewTracks("ALL");
			const since = player.requests.length;
			const answered = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === "/api/autoplaylists/preview" &&
					response.request().postDataJSON()?.query === "ALL",
			);
			await queryField(dialog).fill("ALL");
			await answered;

			await expect(resultRows(dialog).first()).toBeVisible({
				timeout: FIRST_ROWS_MS,
			});
			await expect(statsLine(dialog)).toHaveText(
				/5 album artists\s*·\s*5 albums\s*·\s*30,441 tracks\s*·\s*97 days 18 hr/,
				{ timeout: FIRST_ROWS_MS },
			);

			const scroller = results(dialog);
			const overflows = await scroller.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			);
			expect(overflows, "the results list scrolls").toBe(true);

			const last = player.previewTracks("ALL").at(-1)!["%title%"];
			const lastRow = resultRows(dialog).filter({ hasText: last });
			// A virtualised list measures as it goes, so its bottom may move after the first jump.
			await expect
				.poll(async () => {
					await scroller.evaluate((element) =>
						element.scrollTo(0, element.scrollHeight),
					);
					return lastRow.count();
				})
				.toBe(1);

			expect(
				player.requests
					.slice(since)
					.filter(
						(entry) =>
							entry.method === "GET" &&
							/^\/api\/playlists\/[^/]+\/items/.test(entry.path),
					)
					.map((entry) => entry.path),
			).toEqual([]);
		});
	});

	test("the results are drawn in library order and neither play nor queue (criterion 25)", async ({
		page,
		player,
	}) => {
		const dialog = await openApp(page);
		// Declared Post Rock first, so a list drawn in the query's order, by title or by album
		// starts with Have a Nice Life rather than the library's first path.
		const query = `genre IS "Post Rock" OR ${GRUNGE}`;
		await queryField(dialog).fill(query);

		const expected = player
			.previewTracks(query)
			.slice(0, 9)
			.map((track) => track["%title%"]);
		expect(expected[0]).toBe("Rotten Apple");
		await expect(resultRows(dialog).first()).toBeVisible();
		for (const [at, title] of expected.entries())
			await expect(resultRows(dialog).nth(at)).toContainText(title);

		await expect(dialog.locator("[data-row]")).toHaveCount(0);

		const playingBefore = structuredClone(player.player);
		const since = player.requests.length;
		await resultRows(dialog).first().dblclick();

		await untilQuiet(player);
		expect(
			player.requests
				.slice(since)
				.filter(
					(entry) =>
						entry.method === "POST" &&
						(/\/play$/.test(entry.path) || entry.path.startsWith("/api/queue")),
				)
				.map((entry) => entry.path),
		).toEqual([]);
		expect(player.player.activeItem).toEqual(playingBefore.activeItem);
		expect(player.player.playbackState).toEqual(playingBefore.playbackState);
		await expect(dialog).toBeVisible();
	});

	test.describe("creating it (criterion 26)", () => {
		// The preview answered late, so the window between typing and the player's answer is
		// wide enough to see Create waiting in.
		test.use({
			fooJean: {
				...WITH_AUTOPLAYLISTS,
				routeLatency: { "POST /api/autoplaylists/preview": { ms: 800 } },
			},
		});

		test("Create waits for the latest preview and a name", async ({ page }) => {
			const dialog = await openApp(page);
			const create = createButton(dialog);
			await expect(create).toBeDisabled();

			await queryField(dialog).fill(GRUNGE);
			await expect(create).toBeDisabled();
			await expect(statsLine(dialog)).toContainText("7 tracks");
			await expect(create).toBeEnabled();

			// The previous answer confirmed a different query, and says nothing about this one.
			await queryField(dialog).press("End");
			await queryField(dialog).pressSequentially(' OR genre IS "Post Rock"');
			await expect(create).toBeDisabled();
			await expect(statsLine(dialog)).toContainText("20 tracks");
			await expect(create).toBeEnabled();

			await nameField(dialog).fill("");
			await expect(create).toBeDisabled();
			await nameField(dialog).fill("Heavy days");
			await expect(create).toBeEnabled();
		});

		test("makes an autoplaylist with the name and query and nothing else, closes, and opens it", async ({
			page,
			player,
		}) => {
			const dialog = await openApp(page);
			await nameField(dialog).fill("Heavy days");
			await queryField(dialog).fill(GRUNGE);
			await expect(createButton(dialog)).toBeEnabled();
			await createButton(dialog).click();

			await expect(dialog).toHaveCount(0);
			await expectSettlesAt(player, () => creates(player).length, 1);
			expect(creates(player)[0].body).toEqual({
				title: "Heavy days",
				query: GRUNGE,
			});

			const made = player.playlists.at(-1)!;
			expect(made.title).toBe("Heavy days");
			await expect(page).toHaveURL(new RegExp(`#/${made.guid}$`));
			await expect(
				page.getByRole("heading", { level: 1, name: "Heavy days" }),
			).toBeVisible();
		});
	});

	test.describe("a create the player refuses (criterion 27)", () => {
		const readyToCreate = async (page: Page) => {
			const dialog = await openApp(page);
			await nameField(dialog).fill("Heavy days");
			await queryField(dialog).fill(GRUNGE);
			await expect(createButton(dialog)).toBeEnabled();
			return dialog;
		};

		const keptOpen = async (
			page: Page,
			player: FakePlayer,
			dialog: Locator,
			error: string,
		) => {
			const titlesBefore = player.playlists.map((entry) => entry.title);
			const urlBefore = page.url();
			await createButton(dialog).click();

			await expect(dialog.getByText(createFailed(error))).toBeVisible();
			await expectSettlesAt(player, () => creates(player).length, 1);
			await expect(dialog).toBeVisible();
			await expect(nameField(dialog)).toHaveValue("Heavy days");
			await expect(queryField(dialog)).toHaveValue(GRUNGE);
			expect(page.url()).toBe(urlBefore);
			expect(player.playlists.map((entry) => entry.title)).toEqual(
				titlesBefore,
			);
		};

		test.describe("by the player", () => {
			test.use({ fooJean: { ...WITH_AUTOPLAYLISTS, failCreate: 409 } });

			test("keeps the dialog open with what was typed, and says why", async ({
				page,
				player,
			}) => {
				const dialog = await readyToCreate(page);
				await keptOpen(page, player, dialog, "the player could not do that");
			});
		});

		test("keeps the dialog open when playlist writes were switched off meanwhile", async ({
			page,
			player,
		}) => {
			const dialog = await readyToCreate(page);
			await refusePlaylistWrites(page);
			await keptOpen(page, player, dialog, WRITES_OFF);
		});
	});

	test.describe("closing it without creating (criterion 28)", () => {
		const WAYS_OUT = [
			{
				how: "Escape",
				leave: async (dialog: Locator) => {
					// From the name field, so the Escape is not the one that closes the suggestions.
					await nameField(dialog).click();
					await nameField(dialog).press("Escape");
				},
			},
			{
				how: "the close button",
				leave: (dialog: Locator) => closeButton(dialog).click(),
			},
		];

		for (const { how, leave } of WAYS_OUT) {
			test(`through ${how} sends nothing and keeps nothing`, async ({
				page,
				player,
			}) => {
				const dialog = await openApp(page);
				await nameField(dialog).fill("Heavy days");
				await queryField(dialog).fill(GRUNGE);
				await expect(statsLine(dialog)).toContainText("7 tracks");
				await untilQuiet(player);
				const asked = previews(player).length;

				await leave(dialog);
				await expect(dialog).toHaveCount(0);

				const again = await openDialog(page);
				await expect(nameField(again)).toHaveValue(UNTITLED);
				await expect(queryField(again)).toHaveValue("");
				await expect(again.getByText(TYPE_QUERY)).toBeVisible();
				await expect(resultRows(again)).toHaveCount(0);

				await expectSettlesAt(player, () => creates(player).length, 0);
				expect(previews(player)).toHaveLength(asked);
			});
		}
	});
});

test.describe("editing an autoplaylist", () => {
	const EDIT_TITLE = "Edit autoplaylist";
	const FOREIGN_QUERY =
		"foobar2000 does not let Jean read the query this autoplaylist has now, so Save replaces it";

	// Favorites is one Jean made, Rock en Español one Jean keeps for a purpose of its own, Recently
	// Added one foobar2000 made, and Default Playlist a plain playlist. The stored sort and forceSort
	// are away from their defaults, so a save sending the defaults rather than what is stored fails.
	const JEAN_MADE = "p2";
	const KEPT = "p5";
	const FOREIGN = "p9";
	const PLAIN = "p1";
	const STORED = { key: "", query: GRUNGE, sort: "%title%", forceSort: true };
	const EDITABLE = {
		...WITH_AUTOPLAYLISTS,
		autoPlaylistSpecs: {
			[JEAN_MADE]: STORED,
			[KEPT]: {
				key: "folder:x",
				query: 'artist IS "Babasónicos"',
				sort: "",
				forceSort: false,
			},
		},
	};
	test.use({ fooJean: EDITABLE });

	const editDialogOf = (page: Page) =>
		page.getByRole("dialog", { name: EDIT_TITLE });
	const saveButton = (dialog: Locator) =>
		dialog.getByRole("button", { name: "Save", exact: true });
	const editButton = (page: Page) =>
		viewHeader(page).getByRole("button", { name: EDIT_TITLE, exact: true });

	const titleOf = (player: FakePlayer, key: string) =>
		player.playlists.find((entry) => entry.id === key)!.title;
	const updatesOf = (player: FakePlayer, key: string) => {
		const path = `/api/autoplaylists/${guidOfPlaylist(player, key)}`;
		return player.requests.filter(
			(entry) => entry.method === "POST" && entry.path === path,
		);
	};

	const showPlaylist = async (page: Page, player: FakePlayer, key: string) => {
		await page.goto(`/#/${guidOfPlaylist(player, key)}`);
		await expect(
			page.getByRole("heading", { level: 1, name: titleOf(player, key) }),
		).toBeVisible();
		await expect(trackRow(page, 0)).toBeAttached();
	};

	// All music first, for the reason `openApp` gives, then the playlist within the same page.
	const editFromHeader = async (
		page: Page,
		player: FakePlayer,
		key: string,
	) => {
		await openAllMusic(page);
		await showPlaylist(page, player, key);
		await editButton(page).click();
		const dialog = editDialogOf(page);
		await expect(dialog).toBeVisible();
		return dialog;
	};

	// Eight rows, one past what Favorites and Recently Added hold before the save, so a view still
	// drawing the old rows cannot pass.
	const expectRefilledWith = async (
		page: Page,
		player: FakePlayer,
		query: string,
	) => {
		const titles = player
			.previewTracks(query)
			.slice(0, 8)
			.map((track) => String(track["%title%"]));
		for (const [at, title] of titles.entries())
			await expect(trackRow(page, at)).toContainText(title);
	};

	test("the view of an autoplaylist Jean made or foobar2000 made offers Edit autoplaylist, and a kept one, a plain playlist and the library do not (criteria 29 and 37)", async ({
		page,
		player,
	}) => {
		await openAllMusic(page);
		for (const key of [JEAN_MADE, FOREIGN]) {
			await showPlaylist(page, player, key);
			await expect(editButton(page)).toBeVisible();
		}

		const withoutEdit = [
			() => showPlaylist(page, player, KEPT),
			() => showPlaylist(page, player, PLAIN),
			() => openAllMusic(page),
		];
		for (const open of withoutEdit) {
			await open();
			// Read once everything has landed, so an entry drawn late is still caught.
			await untilQuiet(player);
			expect(await editButton(page).count()).toBe(0);
		}
	});

	test("opens titled Edit autoplaylist with the name and the stored query filled in, previews that query at once, and offers Save rather than Create (criterion 30)", async ({
		page,
		player,
	}) => {
		const dialog = await editFromHeader(page, player, JEAN_MADE);

		await expect(
			dialog.getByRole("heading", { name: EDIT_TITLE }),
		).toBeVisible();
		await expect(nameField(dialog)).toHaveValue("Favorites");
		await expect(queryField(dialog)).toHaveValue(GRUNGE);
		await expect(resultRows(dialog).first()).toContainText("Rotten Apple");
		await expect(statsLine(dialog)).toContainText("7 tracks");
		await expectSettlesAt(
			player,
			() =>
				previews(player).map((entry) => [entry.body?.query, entry.body?.rows]),
			[[GRUNGE, true]],
		);

		await expect(saveButton(dialog)).toBeVisible();
		await expect(createButton(dialog)).toHaveCount(0);
		await expect(dialogOf(page)).toHaveCount(0);
	});

	test.describe("saving it (criterion 31)", () => {
		test("sends one update with the new query and the stored key, sort and forceSort and no title, closes, and the view shows the refilled playlist", async ({
			page,
			player,
		}) => {
			const dialog = await editFromHeader(page, player, JEAN_MADE);
			await queryField(dialog).fill(POST_ROCK);
			await expect(statsLine(dialog)).toContainText("13 tracks");
			await saveButton(dialog).click();

			await expect(dialog).toHaveCount(0);
			await expectSettlesAt(
				player,
				() => updatesOf(player, JEAN_MADE).length,
				1,
			);
			// An empty key and no key are the same record to `foo_jean`.
			expect({ key: "", ...updatesOf(player, JEAN_MADE)[0].body }).toEqual({
				...STORED,
				query: POST_ROCK,
			});

			await expectRefilledWith(page, player, POST_ROCK);
			await expect(
				page.getByRole("heading", { level: 1, name: "Favorites" }),
			).toBeVisible();
		});

		test("a renamed one carries the new title, and the stored query where only the name changed", async ({
			page,
			player,
		}) => {
			const dialog = await editFromHeader(page, player, JEAN_MADE);
			await expect(statsLine(dialog)).toContainText("7 tracks");
			await nameField(dialog).fill("Heavy days");
			await saveButton(dialog).click();

			await expect(dialog).toHaveCount(0);
			await expectSettlesAt(
				player,
				() => updatesOf(player, JEAN_MADE).length,
				1,
			);
			expect({ key: "", ...updatesOf(player, JEAN_MADE)[0].body }).toEqual({
				...STORED,
				title: "Heavy days",
			});
			await expect(
				page.getByRole("heading", { level: 1, name: "Heavy days" }),
			).toBeVisible();
		});
	});

	test.describe("when Save can be pressed (criterion 32)", () => {
		// Answered late, as for Create, so the window between typing and the answer is wide enough
		// to see Save waiting in.
		test.use({
			fooJean: {
				...EDITABLE,
				routeLatency: { "POST /api/autoplaylists/preview": { ms: 800 } },
			},
		});

		test("Save waits for the name or the query to differ from what the dialog opened with, and for the latest preview", async ({
			page,
			player,
		}) => {
			const dialog = await editFromHeader(page, player, JEAN_MADE);
			const save = saveButton(dialog);

			await expect(statsLine(dialog)).toContainText("7 tracks");
			await untilQuiet(player);
			expect(await save.isDisabled(), "unchanged on open").toBe(true);

			await queryField(dialog).fill(POST_ROCK);
			await expect(save).toBeDisabled();
			await expect(statsLine(dialog)).toContainText("13 tracks");
			await expect(save).toBeEnabled();

			await queryField(dialog).fill(GRUNGE);
			await expect(statsLine(dialog)).toContainText("7 tracks");
			await untilQuiet(player);
			expect(await save.isDisabled(), "typed back to the stored query").toBe(
				true,
			);

			await nameField(dialog).fill("Heavy days");
			await expect(save).toBeEnabled();
			await nameField(dialog).fill("Favorites");
			await expect(save).toBeDisabled();

			// A changed name does not stand in for a query the player has not confirmed yet.
			await nameField(dialog).fill("Heavy days");
			await queryField(dialog).fill(POST_ROCK);
			await expect(save).toBeDisabled();
			await expect(statsLine(dialog)).toContainText("13 tracks");
			await expect(save).toBeEnabled();
		});
	});

	test("a save refused because playlist writes were switched off meanwhile keeps the dialog open with what was typed, and says why (criterion 27)", async ({
		page,
		player,
	}) => {
		const dialog = await editFromHeader(page, player, JEAN_MADE);
		await nameField(dialog).fill("Heavy days");
		await queryField(dialog).fill(POST_ROCK);
		await expect(saveButton(dialog)).toBeEnabled();
		const rowsBefore = player.playlists
			.find((entry) => entry.id === JEAN_MADE)!
			.items.map((track) => track["%title%"]);

		await refusePlaylistWrites(page);
		await saveButton(dialog).click();

		await expect(dialog.getByText(WRITES_OFF)).toBeVisible();
		// A save is not a create, and saying one was not created misreports what failed.
		await expect(dialog.getByText(/not created/)).toHaveCount(0);
		await expectSettlesAt(player, () => updatesOf(player, JEAN_MADE).length, 1);
		await expect(dialog).toBeVisible();
		await expect(nameField(dialog)).toHaveValue("Heavy days");
		await expect(queryField(dialog)).toHaveValue(POST_ROCK);
		expect(titleOf(player, JEAN_MADE)).toBe("Favorites");
		expect(
			player.playlists
				.find((entry) => entry.id === JEAN_MADE)!
				.items.map((track) => track["%title%"]),
		).toEqual(rowsBefore);
	});

	test.describe("an autoplaylist foobar2000 made (criterion 37)", () => {
		test("opens with its name, an empty query, a line saying Save replaces the query it has now, and no results or preview until a query is typed", async ({
			page,
			player,
		}) => {
			const dialog = await editFromHeader(page, player, FOREIGN);

			await expect(nameField(dialog)).toHaveValue("Recently Added");
			await expect(queryField(dialog)).toHaveValue("");
			await expect(dialog.getByText(FOREIGN_QUERY)).toBeVisible();
			await expectSettlesAt(player, () => previews(player).length, 0);
			await expect(resultRows(dialog)).toHaveCount(0);
			await expect(saveButton(dialog)).toBeDisabled();

			await queryField(dialog).fill(POST_ROCK);
			await expect(resultRows(dialog).first()).toBeVisible();
			await expect(saveButton(dialog)).toBeEnabled();
		});

		test("Save replaces its query with no key and the default sort, closes, and the view shows the refilled playlist", async ({
			page,
			player,
		}) => {
			const dialog = await editFromHeader(page, player, FOREIGN);
			await queryField(dialog).fill(POST_ROCK);
			await expect(statsLine(dialog)).toContainText("13 tracks");
			await saveButton(dialog).click();

			await expect(dialog).toHaveCount(0);
			await expectSettlesAt(player, () => updatesOf(player, FOREIGN).length, 1);
			// `foo_jean` refuses a key on an autoplaylist it did not make.
			const { key, ...sent } = updatesOf(player, FOREIGN)[0].body as Record<
				string,
				unknown
			>;
			expect(key ?? "").toBe("");
			expect(sent).toEqual({ query: POST_ROCK, sort: "", forceSort: false });

			await expectRefilledWith(page, player, POST_ROCK);
			await expect(
				page.getByRole("heading", { level: 1, name: "Recently Added" }),
			).toBeVisible();
		});
	});
});
