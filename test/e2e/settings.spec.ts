import type { Page } from "./fixtures.ts";
import {
	expect,
	openLibrary,
	openSettings,
	playedFrom,
	requestsTo,
	settingsDialog,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

const tagWrites = (player: { requests: { method: string }[] }) =>
	requestsTo(player as never, "/api/tags").filter(
		(entry) => entry.method === "POST",
	);

test.describe("the settings dialog", () => {
	test("opens over the list rather than replacing it", async ({ page }) => {
		await openLibrary(page);
		await expect(trackRow(page, 0)).toBeVisible();

		await openSettings(page);

		await expect(trackRow(page, 0)).toBeAttached();
		await expect(page).toHaveURL(/#\/p7$/);
	});

	test("escape closes it, and does not clear the selection behind it", async ({
		page,
	}) => {
		test.skip(
			test.info().project.name === "mobile",
			"Escape is a keyboard route out",
		);

		await openLibrary(page);
		await trackRow(page, 3).click();
		await expect(trackRow(page, 3)).toHaveAttribute("aria-selected", "true");

		await openSettings(page);
		await page.keyboard.press("Escape");
		await expect(settingsDialog(page)).toBeHidden();

		// `Escape` in the playlist scope clears the selection; one press, one action.
		await expect(trackRow(page, 3)).toHaveAttribute("aria-selected", "true");
	});

	test("a click on the scrim closes it, a click inside does not", async ({
		page,
	}) => {
		test.skip(test.info().project.name === "mobile", "no scrim at this width");

		await openLibrary(page);
		await openSettings(page);

		await settingsDialog(page).click({ position: { x: 10, y: 10 } });
		await expect(settingsDialog(page)).toBeVisible();

		await page.mouse.click(4, 4);
		await expect(settingsDialog(page)).toBeHidden();
	});

	test("the close button says which key does the same", async ({ page }) => {
		await openLibrary(page);
		await openSettings(page);

		const close = page.getByRole("button", { name: "Close settings" });
		await expect(close).toContainText("Esc");
		await close.click();
		await expect(settingsDialog(page)).toBeHidden();
	});

	test("the app behind it does not answer the keyboard", async ({
		page,
		player,
	}) => {
		test.skip(
			test.info().project.name === "mobile",
			"there is no keyboard to own",
		);

		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText("Los Calientes");
		const played = requestsTo(player, "/player/play").length;

		await openSettings(page);
		await page.keyboard.press("Space");
		await page.keyboard.press("h");

		await expect(settingsDialog(page)).toBeVisible();
		expect(requestsTo(player, "/player/play-pause")).toEqual([]);
		expect(requestsTo(player, "/player/play").length).toBe(played);
	});

	// Playwright delivers the key over CDP, past the macOS menu bar, so this
	// covers the binding rather than the browser handing the key over.
	test("mod+, opens it, and closes it again", async ({ page }) => {
		test.skip(
			test.info().project.name === "mobile",
			"there is no keyboard to press it with",
		);

		await openLibrary(page);
		await page.keyboard.press("ControlOrMeta+Comma");
		await expect(settingsDialog(page)).toBeVisible();

		await page.keyboard.press("ControlOrMeta+Comma");
		await expect(settingsDialog(page)).toBeHidden();
	});

	test.describe("on a first load", () => {
		test.use({ firstRun: true });

		test("it opens itself, once", async ({ page }) => {
			await page.goto("/#/p7");
			await expect(settingsDialog(page)).toBeVisible();

			await page.getByRole("button", { name: "Close settings" }).click();
			await expect(settingsDialog(page)).toBeHidden();

			await page.reload();
			await expect(
				page.getByRole("heading", { level: 1, name: "Library" }),
			).toBeVisible();
			await expect(settingsDialog(page)).toBeHidden();
		});

		test.describe("with the library still to set up", () => {
			test.use({ withoutLibraryPlaylist: true, library: { supported: false } });

			test("it waits, because that is the one thing to do first", async ({
				page,
			}) => {
				await page.goto("/");
				await expect(
					page.getByRole("heading", { level: 1, name: /Point Jean at your/ }),
				).toBeVisible();
				await expect(settingsDialog(page)).toBeHidden();
			});
		});
	});

	test("foo_jean comes first", async ({ page }) => {
		await openLibrary(page);
		await openSettings(page);

		const headings = await settingsDialog(page)
			.getByRole("heading", { level: 2 })
			.allInnerTexts();
		expect(headings[0]).toBe("foo_jean");
	});

	test("a hint holds the caveat, and toggles it in place", async ({ page }) => {
		await openLibrary(page);
		await openSettings(page);

		const hint = page.getByRole("button", { name: "About following" });
		const text = page.getByText(/Search results are exempt/);

		await expect(text).toBeHidden();
		await hint.click();
		await expect(text).toBeVisible();

		// Inside the dialog rather than floating over it: a popover here is clipped
		// by the body's scroller.
		await expect(settingsDialog(page)).toContainText(
			"Search results are exempt",
		);

		await hint.click();
		await expect(text).toBeHidden();
	});
});

// ---- cursor follows playback ------------------------------------------------

const cursorRow = (page: Page) => page.locator('[data-cursor="true"]');

test.describe("cursor follows playback", () => {
	test("the cursor lands on the track the player moved to", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		// Driven on the player, with nothing clicked here.
		player.playItem("p7", 6);
		await expect(statusBar(page)).toContainText("La Fox");

		await expect(cursorRow(page)).toHaveAttribute("data-row", "6");
	});

	test.describe("with a writer", () => {
		test.use({
			withoutFields: ["%lastfm_play_count%"],
			retagged: { Deléctrico: { "%rating%": "3" } },
			fooJean: {},
			fooJeanToken: "0123456789abcdef0123456789abcdef",
		});

		test("is what makes the rating keys hit the track you are hearing", async ({
			page,
			player,
		}) => {
			test.skip(
				test.info().project.name === "mobile",
				"the rating keys are a keyboard",
			);

			await openLibrary(page);
			await trackRow(page, 0).click();

			player.playItem("p7", 2);
			await expect(statusBar(page)).toContainText("Deléctrico");

			await page.keyboard.press("3");
			await expect.poll(() => tagWrites(player).length).toBe(1);
			expect(tagWrites(player)[0].body).toMatchObject({
				path: expect.stringContaining("Deléctrico"),
			});
		});
	});

	test.describe("turned off", () => {
		test.use({ settings: { "jean.followPlayback": false } });

		test("the cursor stays where it was put", async ({ page, player }) => {
			await openLibrary(page);
			await trackRow(page, 1).click();
			await expect(cursorRow(page)).toHaveAttribute("data-row", "1");

			player.playItem("p7", 6);
			await expect(statusBar(page)).toContainText("La Fox");

			await expect(cursorRow(page)).toHaveAttribute("data-row", "1");
		});
	});
});

// ---- playback follows cursor ------------------------------------------------

test.describe("playback follows cursor", () => {
	test.use({
		settings: {
			"jean.playbackFollowsCursor": true,
			// Off, so the cursor is the one this test moves and nothing else.
			"jean.followPlayback": false,
		},
	});

	test("the next track is the row the cursor is on", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		player.playItem("p7", 2);
		await expect(statusBar(page)).toContainText("Deléctrico");

		await trackRow(page, 5).click();
		await expect(cursorRow(page)).toHaveAttribute("data-row", "5");

		// The player would otherwise have gone to 3.
		player.next();

		await expect(cursorRow(page)).toHaveAttribute("data-row", "5");
		await expect.poll(() => playedFrom(player)?.index).toBe(5);
	});

	test("does not fire on arrival, whatever the cursor is on", async ({
		page,
		player,
	}) => {
		// Opening a playlist puts the cursor on row 0.
		player.playItem("p7", 6);
		await openLibrary(page);
		await expect(statusBar(page)).toContainText("La Fox");

		await page.waitForTimeout(500);
		expect(requestsTo(player, "/player/play/p7/0")).toEqual([]);
		await expect(statusBar(page)).toContainText("La Fox");
	});

	test.describe("with the cursor following too", () => {
		test.use({
			settings: {
				"jean.playbackFollowsCursor": true,
				"jean.followPlayback": true,
			},
		});

		test("stays dormant, rather than replaying the track that ended", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			player.playItem("p7", 2);
			await expect(cursorRow(page)).toHaveAttribute("data-row", "2");

			// Without the `wasPlaying` guard this pair loops on one track forever.
			player.next();
			await expect(statusBar(page)).toContainText("Soy Rock");
			await page.waitForTimeout(500);

			await expect(cursorRow(page)).toHaveAttribute("data-row", "3");
			await expect(statusBar(page)).toContainText("Soy Rock");
		});
	});
});
