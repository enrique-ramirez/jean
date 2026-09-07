import type { Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	FOO_JEAN_TOKEN,
	inSequence,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	openSettings,
	pressAndHold,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";

// The fake serves `foo_jean` on a second port, so everything here crosses a
// real origin boundary.

// Row numbers below are positions in the captured `Library` playlist: 0 Los
// Calientes, 1 Fizz, 2 Deléctrico, 3 Soy Rock, 4 Pendejo. Dropping play counts
// is what puts Rating on screen on a phone.
const RATED = {
	withoutFields: ["%lastfm_play_count%"],
	retagged: {
		"Los Calientes": { "%rating%": "5" }, // native scale, writable
		Deléctrico: { "%rating%": "3" }, // native scale, writable
		"Soy Rock": { "%rating%": "0" }, // unrated, writable
		Pendejo: { "%rating%": "100" }, // 0-100 scale -- read-only
	},
};

const readOnlyStars = (page: Page, row: number) =>
	trackRow(page, row).getByRole("img", { name: /stars|Unrated/ });

// An image when read-only, a group of buttons when writable, both naming the
// value.
const ratingOf = (page: Page, row: number) =>
	readOnlyStars(page, row).or(
		trackRow(page, row).getByRole("group", { name: /stars|Unrated/ }),
	);

const star = (page: Page, row: number, value: number) =>
	trackRow(page, row).getByRole("button", { name: `Rate ${value} of 5` });

// POST only: the browser's own preflight is not a request the app made.
const tagWrites = (player: { requests: { method: string }[] }) =>
	requestsTo(player as never, "/api/tags").filter(
		(entry) => entry.method === "POST",
	);

test.describe("with no foo_jean", () => {
	test.use(RATED);

	test("ratings are read-only and nothing is probed", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		await expect(readOnlyStars(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 0).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);

		await expect
			.poll(() => requestsTo(player, "/clientconfig/foo_jean").length)
			.toBeGreaterThan(0);
		await expectSettlesAt(player, () => requestsTo(player, "/api/status"), []);
		await expectSettlesAt(player, () => tagWrites(player), []);
	});
});

test.describe("with writing switched off", () => {
	test.use({
		...RATED,
		fooJean: { allowedFields: [] },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("draws the same read-only column", async ({ page }) => {
		await openLibrary(page);
		await expect(readOnlyStars(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 0).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
	});
});

test.describe("with foo_jean and a token", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("clicking a star sends one write, with the path and the value", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await star(page, 2, 4).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			path: expect.stringContaining("Deléctrico"),
			fields: { rating: "4" },
		});

		// Optimistic, since beefweb pushes nothing when a track's tags change.
		await expect(page.locator('[role="row"][data-row="2"]')).toContainText(
			"Deléctrico",
		);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
		await expect(
			trackRow(page, 2).getByRole("button", { name: /^Clear rating/ }),
		).toBeVisible();
	});

	// Read back off the player rather than out of Jean's own cache.
	test("the value survives a reload", async ({ page, player }) => {
		await openLibrary(page);
		await star(page, 2, 2).click();
		await expectSettlesAt(player, () => tagWrites(player).length, 1);

		await page.reload();
		await openLibrary(page);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("2 of 5 stars");
	});

	test("clicking the star already set clears the rating", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		// Deléctrico is at 3, so the third star is the one that clears it.
		await trackRow(page, 2)
			.getByRole("button", { name: "Clear rating (3 of 5 stars)" })
			.click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "" },
		});

		await page.reload();
		await openLibrary(page);
		await expect(ratingOf(page, 2)).toHaveAccessibleName("Unrated");
	});

	// `100` is a rating on the 0-100 scale, and writing a native `4` over it would
	// turn 4% into four stars.
	test("a track on another scale is read-only and sends nothing", async ({
		page,
		player,
	}) => {
		await openLibrary(page);

		await expect(readOnlyStars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 4).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);

		// Per track rather than the column giving up.
		await expect(star(page, 2, 4)).toBeVisible();
		await expectSettlesAt(player, () => tagWrites(player), []);
	});

	test("a burst on one row settles into the last value", async ({
		page,
		player,
	}) => {
		await page.request.post("/__control/latency", { data: { ms: 250 } });
		await openLibrary(page);
		await expect(star(page, 2, 1)).toBeVisible();

		// Dispatched from inside the page: three `.click()` calls are three round
		// trips, and under parallel workers they can take longer apart than the
		// latency they have to land inside. Buttons are collected once and clicked
		// by position, because the star now set relabels itself "Clear rating".
		await page.evaluate(() => {
			const row = document.querySelector('[role="row"][data-row="2"]');
			const stars = [
				...(row?.querySelectorAll("button") ?? []),
			] as HTMLButtonElement[];
			stars[0].click();
			stars[1].click();
			stars[4].click();
		});

		await expect
			.poll(() => tagWrites(player).at(-1)?.body)
			.toMatchObject({ fields: { rating: "5" } });
		// Exactly two: the first goes immediately, the last is the one queued
		// behind it, and the middle is dropped. Without coalescing this is three.
		await expectSettlesAt(player, () => tagWrites(player).length, 2);
	});

	// Hovering the star that would clear a rating fades the stars, and clicking a
	// star must not leave the clearing preview armed under a pointer that has not
	// moved.
	test("keep showing the rating they hold, hovered and clicked", async ({
		page,
	}) => {
		await openLibrary(page);

		// Los Calientes is at 5, so its fifth star is the one that would clear it.
		await trackRow(page, 0)
			.getByRole("button", { name: "Clear rating (5 of 5 stars)" })
			.hover();
		await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");

		await star(page, 2, 5).hover();
		await star(page, 2, 5).click();
		await expect(ratingOf(page, 2)).toHaveAccessibleName("5 of 5 stars");
	});

	test("two rows in flight both land", async ({ page, player }) => {
		await page.request.post("/__control/latency", { data: { ms: 200 } });
		await openLibrary(page);

		await star(page, 2, 4).click();
		await star(page, 3, 2).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 2);
		const written = tagWrites(player).map(
			(entry) => (entry.body as { fields: { rating: string } }).fields.rating,
		);
		expect(written.sort()).toEqual(["2", "4"]);
	});

	test.describe("a library with no ratings at all", () => {
		test.use({ withoutFields: ["%lastfm_play_count%", "%rating%"] });

		test("can be given its first rating", async ({ page }) => {
			await openLibrary(page);
			await expect(star(page, 0, 4)).toBeVisible();
		});
	});
});

// The media library API reports relative, forward-slashed paths and the
// component needs an absolute one. `#/all` is the autoplaylist on a fallback
// player, so this runs on both sources.
test.describe("rating from All music", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("sends an absolute path, not the library's relative one", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect(trackRow(page, 0)).toBeAttached();

		await star(page, 2, 4).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		const { path } = tagWrites(player)[0].body as { path: string };
		expect(path).toMatch(/^[A-Z]:\\/);
		expect(path).toContain("\\Music\\");
	});
});

test.describe("rating with the number keys", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("rates the row under the cursor", async ({ page, player }) => {
		await openLibrary(page);
		// Down twice from row 0 puts the cursor on Deléctrico.
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("4");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			path: expect.stringContaining("Deléctrico"),
			fields: { rating: "4" },
		});
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
	});

	test("zero removes the rating", async ({ page, player }) => {
		await openLibrary(page);
		await page.keyboard.press("0");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "" } });
	});

	test("does nothing on a track Jean may not write", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await inSequence([0, 1, 2, 3], () => page.keyboard.press("ArrowDown"));
		await page.keyboard.press("2");

		await expect(readOnlyStars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		await expectSettlesAt(player, () => tagWrites(player), []);
	});

	test.describe("with the now-playing screen up", () => {
		// Off, so the cursor stays on a different track from the one playing --
		// which is the arrangement the screen has to answer for.
		test.use({ settings: { "jean.followPlayback": false } });

		test("they rate the track the screen is showing, not the row behind it", async ({
			page,
			player,
		}) => {
			await openLibrary(page);
			await trackRow(page, 2).dblclick();
			await expect(page.locator("footer")).toContainText("Deléctrico");
			// A click moves the cursor and leaves playback alone, so the marked row
			// and the playing track are now two different tracks.
			await trackRow(page, 0).click();

			await openNowPlaying(page);
			await page.keyboard.press("4");

			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			expect(tagWrites(player)[0].body).toMatchObject({
				path: expect.stringContaining("Deléctrico"),
				fields: { rating: "4" },
			});

			// The stars on the screen move; Los Calientes, under the cursor behind
			// the layer, keeps the five it had.
			await expect(
				nowPlayingScreen(page).getByRole("group", { name: /stars|Unrated/ }),
			).toHaveAccessibleName("4 of 5 stars");
			await nowPlayingScreen(page)
				.getByRole("button", { name: "Close now playing" })
				.click();
			await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");
		});
	});

	// Away from any list there is no cursor, so the keys fall through to what is
	// playing. Success is silent everywhere; only a failure speaks.
	test("falls back to the playing track, silently", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");

		// A dialog owns the keyboard while it is open and the rating keys do not
		// fire there, so Home is the remaining place with a player and no cursor.
		await page.goto("/#/home");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await page.keyboard.press("3");

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			path: expect.stringContaining("Deléctrico"),
			fields: { rating: "3" },
		});
		await expect(page.getByRole("status")).toHaveCount(0);
	});

	// A read-only scale is read-only however the rating is reached, and the
	// playing track is the one path with no row on screen to say so.
	test("refuses a playing track on a scale Jean does not write", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 4).dblclick();
		await expect(page.locator("footer")).toContainText("Pendejo");

		// The screen draws the `100` as five read-only stars, which is also how
		// this test knows the player has answered with the rating.
		await openNowPlaying(page);
		await expect(
			nowPlayingScreen(page).getByRole("img", { name: /stars|Unrated/ }),
		).toHaveAccessibleName("5 of 5 stars");
		await nowPlayingScreen(page)
			.getByRole("button", { name: "Close now playing" })
			.click();
		// The screen publishes what it would do with a digit for as long as it is
		// on screen, exit animation included, so the fallback is only reachable
		// once it has gone.
		await expect(nowPlayingScreen(page)).toBeHidden();

		await page.goto("/#/home");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await page.keyboard.press("2");

		await expectSettlesAt(player, () => tagWrites(player), []);
	});
});

test.describe("when foo_jean refuses the field", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 403 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test.skip(
		({ isMobile }) => Boolean(isMobile),
		"the row's stars are a pointer control; touch uses the track menu",
	);

	test("stops offering the control instead of retrying", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await star(page, 2, 4).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(
			trackRow(page, 2).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
		await expect(readOnlyStars(page, 2)).toHaveAccessibleName("3 of 5 stars");
	});
});

// The playing track has no row to overlay, so its optimistic value lives in the
// now-playing query and a refusal has to put that back.
test.describe("when a rating from the now-playing screen is refused", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 500 },
		fooJeanToken: FOO_JEAN_TOKEN,
	});

	test("the stars go back to the rating the player holds", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");
		await openNowPlaying(page);

		const stars = nowPlayingScreen(page).getByRole("group", {
			name: /stars|Unrated/,
		});
		await expect(stars).toHaveAccessibleName("3 of 5 stars");
		await stars.getByRole("button", { name: "Rate 5 of 5" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		await expect(page.getByRole("status")).toContainText("was not rated");
		await expect(stars).toHaveAccessibleName("3 of 5 stars");
	});
});

test.describe("the track actions on the now-playing screen", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("offer no rating until the player has answered with one", async ({
		page,
	}) => {
		let answer = () => {};
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		// The screen's own read of the track. The update stream carries `trcolumns`
		// too and must go on flowing, so the path has to be matched exactly.
		await page.route(
			(url) =>
				url.pathname === "/api/query" && url.searchParams.has("trcolumns"),
			async (route) => {
				await answered;
				await route.continue();
			},
		);

		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await openNowPlaying(page);
		await page.getByRole("button", { name: "Track actions" }).click();

		await expect(
			page.getByRole("menuitem", { name: "Add to queue" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);

		answer();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toBeVisible();
	});
});

test.describe("rating from the track menu", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

	test("a hold opens a rating page that writes", async ({ page, player }) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 2));

		await page.getByRole("menuitem", { name: "Rating" }).click();
		await page.getByRole("menuitem", { name: "4 stars" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({
			fields: { rating: "4" },
		});
	});

	test("the page offers a way to remove the rating", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 2));

		await page.getByRole("menuitem", { name: "Rating" }).click();
		await page.getByRole("menuitem", { name: "No rating" }).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "" } });
	});

	test("is absent for a track on a scale Jean does not write", async ({
		page,
	}) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 4));

		await expect(
			page.getByRole("menuitem", { name: "Add to queue" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(0);
	});
});

const settings = async (page: Page) => {
	await openSettings(page);
	await expect(
		page.getByRole("heading", { level: 2, name: "foo_jean" }),
	).toBeVisible();
};

test.describe("what the settings screen says", () => {
	test.describe("not installed", () => {
		test("says what it is and does not nag", async ({ page }) => {
			await settings(page);
			await expect(page.getByText("Not installed")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Check again" }),
			).toBeVisible();
			await expect(
				page.getByText(/writes tags back to your library/),
			).toBeVisible();
			await expect(page.getByText(/not published yet/)).toBeVisible();
			await expect(page.getByLabel("Token")).toHaveCount(0);
		});
	});

	test.describe("installed but could not bind", () => {
		test.use({
			fooJean: {
				listening: false,
				portInUse: true,
				error: "could not bind 127.0.0.1:8881; the port is in use",
			},
		});

		test("shows the component's own words and the remedy", async ({ page }) => {
			await settings(page);
			await expect(page.getByText(/could not start on port/)).toBeVisible();
			await expect(page.getByText(/the port is in use/)).toBeVisible();
			await expect(page.getByText(/Another program already has/)).toBeVisible();
		});
	});

	test.describe("advertised but unreachable", () => {
		test.use({ fooJean: { reachable: false } });

		test("names the fix rather than going quiet", async ({ page }) => {
			await settings(page);
			await expect(page.getByText(/this device cannot reach it/)).toBeVisible();
			await expect(page.getByText(/Preferences . Tools . Jean/)).toBeVisible();
			await expect(page.getByText(/0\.0\.0\.0/)).toBeVisible();
		});
	});

	test.describe("listening, with no token stored", () => {
		test.use({ fooJean: {} });

		test("asks for the token, once", async ({ page }) => {
			await settings(page);
			await expect(page.getByText("Needs token")).toBeVisible();
			await expect(page.getByText(/needs the token/)).toBeVisible();
			await expect(page.getByLabel("Token")).toBeVisible();
		});

		test("masks the token and can show it", async ({ page }) => {
			await settings(page);
			await expect(page.getByLabel("Token")).toHaveAttribute(
				"type",
				"password",
			);
			// Exact, or it also matches the sidebar's "Show playlists".
			await page.getByRole("button", { name: "Show", exact: true }).click();
			await expect(page.getByLabel("Token")).toHaveAttribute("type", "text");
		});

		test("pasting the token switches ratings on", async ({ page }) => {
			await settings(page);
			await page.getByLabel("Token").fill(FOO_JEAN_TOKEN);
			await page.getByRole("button", { name: "Save" }).click();

			await expect(page.getByText(/Connected to foo_jean/)).toBeVisible();
			await expect(page.getByText("Connected", { exact: true })).toBeVisible();
			await expect(page.getByLabel("Token")).toHaveCount(0);
		});
	});

	test.describe("a token that is stored and working", () => {
		test.use({ fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

		// There is one token and it is working, so the panel offers no way to replace it -- the only
		// thing a field here could do is break the connection it is reporting.
		test("is never shown and never offered for editing", async ({ page }) => {
			await settings(page);

			await expect(page.getByText(/Connected to foo_jean/)).toBeVisible();
			await expect(page.getByLabel("Token")).toHaveCount(0);
			await expect(page.getByRole("button", { name: /token/i })).toHaveCount(0);
		});
	});

	// The component's allowlist is the ceiling; these choose from underneath it.
	test.describe("choosing what Jean may write", () => {
		test.use({ ...RATED, fooJean: {}, fooJeanToken: FOO_JEAN_TOKEN });

		test("draws one switch per permitted field, on by default", async ({
			page,
		}) => {
			await settings(page);
			await expect(
				page.getByRole("switch", { name: "Ratings" }),
			).toHaveAttribute("aria-checked", "true");
		});

		// A phone never draws the stars, so their absence would pass either way;
		// the track menu is the one surface both projects share.
		test("switching a field off takes the control away everywhere", async ({
			page,
			player,
		}) => {
			await settings(page);
			await page.getByRole("switch", { name: "Ratings" }).click();

			await openLibrary(page);
			await expect(
				trackRow(page, 2).getByRole("button", { name: /^Rate / }),
			).toHaveCount(0);
			await expect(readOnlyStars(page, 2)).toHaveAccessibleName("3 of 5 stars");

			await pressAndHold(page, trackRow(page, 2));
			await expect(
				page.getByRole("menuitem", { name: "Add to queue" }),
			).toBeVisible();
			await expect(page.getByRole("menuitem", { name: "Rating" })).toHaveCount(
				0,
			);

			await expectSettlesAt(player, () => tagWrites(player), []);
		});

		test("switching it back on restores the control", async ({ page }) => {
			await settings(page);
			await page.getByRole("switch", { name: "Ratings" }).click();
			await page.getByRole("switch", { name: "Ratings" }).click();

			await openLibrary(page);
			await pressAndHold(page, trackRow(page, 2));
			await expect(
				page.getByRole("menuitem", { name: "Rating" }),
			).toBeVisible();
		});
	});

	test.describe("a token the component refuses", () => {
		test.use({ fooJean: {}, fooJeanToken: "not-the-right-token-at-all-no" });

		test("says it was refused rather than going read-only in silence", async ({
			page,
		}) => {
			await settings(page);
			await expect(page.getByText("Token refused")).toBeVisible();
			await expect(page.getByText(/refused that token/)).toBeVisible();
		});
	});

	// The record still says `foo_jean`, as a forgery would; the thing listening
	// on the port it names does not.
	test.describe("something else on the advertised port", () => {
		test.use({
			fooJean: { agentName: "not_foo_jean" },
			fooJeanToken: FOO_JEAN_TOKEN,
		});

		test("refuses to send the token, and says why", async ({
			page,
			player,
		}) => {
			await settings(page);
			await expect(page.getByText(/it is not foo_jean/)).toBeVisible();
			await expect(
				page.getByText(/token has not been sent to it/),
			).toBeVisible();

			expect(requestsTo(player, "/api/status").length).toBeGreaterThan(0);
			await expectSettlesAt(
				player,
				() => requestsTo(player, "/api/capabilities"),
				[],
			);
		});
	});

	test.describe("an API version Jean does not understand", () => {
		test.use({ fooJean: { apiVersion: 99 }, fooJeanToken: FOO_JEAN_TOKEN });

		test("refuses to proceed and says which is which", async ({
			page,
			player,
		}) => {
			await settings(page);
			await expect(page.getByText(/version 99/)).toBeVisible();
			await expectSettlesAt(
				player,
				() => requestsTo(player, "/api/capabilities"),
				[],
			);
		});
	});

	test.describe("connected with writing switched off", () => {
		test.use({ fooJean: { allowedFields: [] }, fooJeanToken: FOO_JEAN_TOKEN });

		test("says the allowlist is empty rather than claiming to be broken", async ({
			page,
		}) => {
			await settings(page);
			await expect(page.getByText("Connected", { exact: true })).toBeVisible();
			await expect(
				page.getByText(/permits no fields to be written/),
			).toBeVisible();
			await expect(page.getByText(/Fields they may write/)).toBeVisible();
			// Scoped to this panel: Settings has other switches.
			await expect(
				page
					.getByRole("region", { name: "foo_jean" })
					.or(
						page
							.locator("section")
							.filter({ has: page.getByRole("heading", { name: "foo_jean" }) }),
					)
					.getByRole("switch"),
			).toHaveCount(0);
		});
	});
});
