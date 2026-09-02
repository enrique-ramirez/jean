import type { Page } from "./fixtures.ts";
import {
	expect,
	inSequence,
	openLibrary,
	openSettings,
	pressAndHold,
	requestsTo,
	test,
	trackRow,
} from "./fixtures.ts";

// Writing a rating back, through `foo_jean`. The fake serves it on a second
// port, so everything here crosses a real origin boundary.

const TOKEN = "0123456789abcdef0123456789abcdef";

// The captured `Library` playlist's opening rows, and the row numbers used below
// are their positions in it: 0 Los Calientes, 1 Fizz, 2 Deléctrico, 3 Soy Rock,
// 4 Pendejo. Dropping play counts is also what puts Rating on screen on a phone.
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

// The value, whichever control is drawn: an image when read-only, a group of
// buttons when writable, both naming it.
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

// ---- with nothing installed -------------------------------------------------

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

		// The record is read, answers null, and that is the end of it.
		await expect
			.poll(() => requestsTo(player, "/clientconfig/foo_jean").length)
			.toBeGreaterThan(0);
		expect(requestsTo(player, "/api/status")).toEqual([]);
		expect(tagWrites(player)).toEqual([]);
	});

	test("an empty allowlist behaves exactly like no component", async ({
		page,
	}) => {
		await openLibrary(page);
		await expect(readOnlyStars(page, 0)).toBeVisible();
	});
});

test.describe("with writing switched off", () => {
	test.use({ ...RATED, fooJean: { allowedFields: [] }, fooJeanToken: TOKEN });

	test("draws the same read-only column", async ({ page }) => {
		await openLibrary(page);
		await expect(readOnlyStars(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 0).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
	});
});

// ---- writing ----------------------------------------------------------------

test.describe("with foo_jean and a token", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: TOKEN });

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

		await expect.poll(() => tagWrites(player).length).toBe(1);
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
	test("the value survives a reload", async ({ page }) => {
		await openLibrary(page);
		await star(page, 2, 2).click();

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

		await expect.poll(() => tagWrites(player).length).toBe(1);
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
		expect(tagWrites(player)).toEqual([]);
	});

	test("a burst on one row settles into the last value", async ({
		page,
		player,
	}) => {
		await page.request.post("/__control/latency", { data: { ms: 250 } });
		await openLibrary(page);
		await expect(star(page, 2, 1)).toBeVisible();

		// Dispatched from inside the page, not driven over the wire. Three
		// `.click()` calls are three round trips, and under parallel workers they
		// can take longer apart than the latency they are meant to land inside --
		// so each write finishes before the next click and there is nothing left
		// to coalesce. The test then fails for a reason that has nothing to do
		// with coalescing, and only in a full run.
		//
		// Buttons are collected once and clicked by position, because the labels
		// change as the value does: the star now set reads "Clear rating".
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
		// Exactly two, not "at most": the first goes immediately, the last is the
		// one queued behind it, and the middle is dropped. Without coalescing this
		// is three, so the number is what makes the test worth having.
		expect(tagWrites(player).length).toBe(2);
	});

	// Two ways this went wrong, both of which made a rated track read as unrated.
	// The stars have to keep showing the value they hold: hovering the star that
	// would clear it fades them, and clicking a star must not leave the clearing
	// preview armed under a pointer that has not moved.
	test("keep showing the rating they hold, hovered and clicked", async ({
		page,
	}) => {
		await openLibrary(page);

		// Los Calientes is at 5, so its fifth star is the one that would clear it
		// and says so rather than offering the value it already holds.
		await trackRow(page, 0)
			.getByRole("button", { name: "Clear rating (5 of 5 stars)" })
			.hover();
		await expect(ratingOf(page, 0)).toHaveAccessibleName("5 of 5 stars");
		await expect(trackRow(page, 0).locator("svg[class*='fill']")).toHaveCount(
			5,
		);

		await star(page, 2, 5).hover();
		await star(page, 2, 5).click();
		await expect(ratingOf(page, 2)).toHaveAccessibleName("5 of 5 stars");
		await expect(
			trackRow(page, 2).locator("[data-clearing='true']"),
		).toHaveCount(0);
	});

	// The case a single pending slot would get wrong.
	test("two rows in flight both land", async ({ page, player }) => {
		await page.request.post("/__control/latency", { data: { ms: 200 } });
		await openLibrary(page);

		await star(page, 2, 4).click();
		await star(page, 3, 2).click();

		await expect.poll(() => tagWrites(player).length).toBe(2);
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

// The other half of the source seam, and where the path is a trap: the media
// library API reports relative, forward-slashed paths and the component needs an
// absolute one. Runs on both sources, since `#/all` is the autoplaylist on a
// fallback player.
test.describe("rating from All music", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: TOKEN });

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

		await expect.poll(() => tagWrites(player).length).toBe(1);
		const { path } = tagWrites(player)[0].body as { path: string };
		expect(path).toMatch(/^[A-Z]:\\/);
		expect(path).toContain("\\Musica\\");
	});
});

// ---- from the keyboard ------------------------------------------------------

test.describe("rating with the number keys", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: TOKEN });

	test("rates the row under the cursor", async ({ page, player }) => {
		await openLibrary(page);
		// Down twice from row 0 puts the cursor on Deléctrico, which is marked on
		// screen -- what the keys act on is the thing you are looking at.
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("4");

		await expect.poll(() => tagWrites(player).length).toBe(1);
		expect(tagWrites(player)[0].body).toMatchObject({
			path: expect.stringContaining("Deléctrico"),
			fields: { rating: "4" },
		});
		await expect(ratingOf(page, 2)).toHaveAccessibleName("4 of 5 stars");
	});

	test("zero removes the rating", async ({ page, player }) => {
		await openLibrary(page);
		await page.keyboard.press("0");

		await expect.poll(() => tagWrites(player).length).toBe(1);
		expect(tagWrites(player)[0].body).toMatchObject({ fields: { rating: "" } });
	});

	// Read-only scales are read-only however the rating is reached. There is no
	// pointer over the row here to notice a rescale, which makes it worse.
	test("does nothing on a track Jean may not write", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await inSequence([0, 1, 2, 3], () => page.keyboard.press("ArrowDown"));
		await page.keyboard.press("2");

		await expect(readOnlyStars(page, 4)).toHaveAccessibleName("5 of 5 stars");
		expect(tagWrites(player)).toEqual([]);
	});

	// Away from any list there is no cursor, so the keys fall through to what is
	// playing. It used to announce that in a toast, on the argument that no stars
	// are on screen to show it; that toast is gone. A rating is a small,
	// reversible, one-click act, and once the now-playing screen grew its own
	// stars the confirmation was being thrown over a control that had already
	// drawn the answer. Success is silent everywhere now; only a failure speaks.
	test("falls back to the playing track, silently", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await trackRow(page, 2).dblclick();
		await expect(page.locator("footer")).toContainText("Deléctrico");

		// Home, not the settings dialog this used to use: a dialog owns the
		// keyboard while it is open, so the rating keys deliberately do not fire
		// there. Home is the remaining place with a player and no cursor.
		await page.goto("/#/home");
		await expect(
			page.getByRole("heading", { level: 1, name: /of music/ }),
		).toBeVisible();
		await page.keyboard.press("3");

		await expect.poll(() => tagWrites(player).length).toBe(1);
		expect(tagWrites(player)[0].body).toMatchObject({
			path: expect.stringContaining("Deléctrico"),
			fields: { rating: "3" },
		});
		await expect(page.getByRole("status")).toHaveCount(0);
	});
});

// ---- when the component refuses ---------------------------------------------

test.describe("when foo_jean refuses the field", () => {
	test.use({
		...RATED,
		fooJean: { failWrites: 403 },
		fooJeanToken: TOKEN,
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

		await expect.poll(() => tagWrites(player).length).toBe(1);
		await expect(
			trackRow(page, 2).getByRole("button", { name: /^Rate / }),
		).toHaveCount(0);
		await expect(readOnlyStars(page, 2)).toHaveAccessibleName("3 of 5 stars");

		// And no second attempt, however long it is left.
		await expect.poll(() => tagWrites(player).length).toBe(1);
	});
});

// ---- by thumb and by keyboard -----------------------------------------------

test.describe("rating from the track menu", () => {
	test.use({ ...RATED, fooJean: {}, fooJeanToken: TOKEN });

	test("a hold opens a rating page that writes", async ({ page, player }) => {
		await openLibrary(page);
		await pressAndHold(page, trackRow(page, 2));

		await page.getByRole("menuitem", { name: "Rating" }).click();
		await page.getByRole("menuitem", { name: "4 stars" }).click();

		await expect.poll(() => tagWrites(player).length).toBe(1);
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

		await expect.poll(() => tagWrites(player).length).toBe(1);
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

// ---- every state says something a person can act on -------------------------

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
			// Still offered here: this is a state you can leave by installing it.
			await expect(
				page.getByRole("button", { name: "Check again" }),
			).toBeVisible();
			await expect(
				page.getByText(/writes tags back to your library/),
			).toBeVisible();
			await expect(page.getByText(/not published yet/)).toBeVisible();
			// No credential asked for a program that is not there.
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
			// The pane rather than the config key: the remedy has to be findable by
			// somebody reading this on a phone, who has to walk to the player anyway.
			await expect(page.getByText(/Preferences . Tools . Jean/)).toBeVisible();
			await expect(page.getByText(/0\.0\.0\.0/)).toBeVisible();
		});
	});

	test.describe("listening, with no token stored", () => {
		test.use({ fooJean: {} });

		// The badge names the state rather than collapsing to on/off. "Not
		// connected" here would send somebody to debug a network that is working.
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
			await page.getByLabel("Token").fill(TOKEN);
			await page.getByRole("button", { name: "Save" }).click();

			await expect(page.getByText(/Connected to foo_jean/)).toBeVisible();
			await expect(page.getByText("Connected", { exact: true })).toBeVisible();
			// And gets out of the way: a stored token that works is a setting
			// nobody touches again.
			await expect(page.getByLabel("Token")).toHaveCount(0);
		});
	});

	test.describe("a token that is stored and working", () => {
		test.use({ fooJean: {}, fooJeanToken: TOKEN });

		test("collapses to a button instead of a filled field", async ({
			page,
		}) => {
			await settings(page);
			await expect(page.getByLabel("Token")).toHaveCount(0);

			await page.getByRole("button", { name: "Change token" }).click();
			await expect(page.getByLabel("Token")).toBeVisible();
		});

		test("can be left alone again without changing it", async ({ page }) => {
			await settings(page);
			await page.getByRole("button", { name: "Change token" }).click();
			await page.getByLabel("Token").fill("something-else-entirely-here-ok");
			await page.getByRole("button", { name: "Cancel" }).click();

			await expect(page.getByLabel("Token")).toHaveCount(0);
			await expect(page.getByText(/Connected to foo_jean/)).toBeVisible();
		});
	});

	// The component's allowlist is the ceiling; these choose from underneath it.
	test.describe("choosing what Jean may write", () => {
		test.use({ ...RATED, fooJean: {}, fooJeanToken: TOKEN });

		test("draws one switch per permitted field, on by default", async ({
			page,
		}) => {
			await settings(page);
			await expect(
				page.getByRole("switch", { name: "Ratings" }),
			).toHaveAttribute("aria-checked", "true");
		});

		// Through the track menu, the one surface both projects share: a phone never
		// draws the stars, so their absence would pass either way.
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

			expect(tagWrites(player)).toEqual([]);
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

	// The record still says `foo_jean`, as a forgery would; the thing listening on
	// the port it names does not.
	test.describe("something else on the advertised port", () => {
		test.use({ fooJean: { agentName: "not_foo_jean" }, fooJeanToken: TOKEN });

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
			expect(requestsTo(player, "/api/capabilities")).toEqual([]);
		});
	});

	test.describe("an API version Jean does not understand", () => {
		test.use({ fooJean: { apiVersion: 99 }, fooJeanToken: TOKEN });

		test("refuses to proceed and says which is which", async ({
			page,
			player,
		}) => {
			await settings(page);
			await expect(page.getByText(/version 99/)).toBeVisible();
			expect(requestsTo(player, "/api/capabilities")).toEqual([]);
		});
	});

	test.describe("connected with writing switched off", () => {
		test.use({ fooJean: { allowedFields: [] }, fooJeanToken: TOKEN });

		test("says the allowlist is empty rather than claiming to be broken", async ({
			page,
		}) => {
			await settings(page);
			// The component answered, so "Connected" is true; what it permits is a
			// separate fact and belongs in the sentence.
			await expect(page.getByText("Connected", { exact: true })).toBeVisible();
			await expect(
				page.getByText(/permits no fields to be written/),
			).toBeVisible();
			await expect(page.getByText(/Fields they may write/)).toBeVisible();
			// Scoped to this panel: Settings has other switches, and whether the
			// component permits a field to be written is a claim about foo_jean.
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
