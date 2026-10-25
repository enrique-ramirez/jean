import { albumRoute } from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	coversFromTheComponent,
	expect,
	expectSettlesAt,
	openLibrary,
	rowByTitle,
	test,
	trackRow,
} from "./fixtures.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// Deathconsciousness is the fixture's two-disc album and the last one in the
// Library, so everything here scrolls to the end first. Both discs number their
// tracks from 01, so a track number alone cannot tell them apart.
const DISC_ONE = "A Quick One Before The Eternal Worm Devours Connecticut";
const DISC_TWO = "Waiting For Black Metal Records To Come In The Mail";

// Jar Of Flies is the fixture's single-disc album.
const SINGLE_DISC_ALBUM = "Jar Of Flies";
const SINGLE_DISC_TRACK = "Nutshell";

const trackNumberOf = (row: Locator) => row.locator(":scope > span").first();

const heading = (page: Page, name: string) =>
	page.getByRole("heading", { level: 3, name });

test.describe("a multi-disc album in the album layout", () => {
	test.use({ settings: { "jean.layout": "album" } });

	test("the discs are headed inside one album, not split into two", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(heading(page, "Disc 1")).toBeVisible();
		await expect(heading(page, "Disc 2")).toBeVisible();

		const album = page
			.locator("section")
			.filter({ hasText: "Deathconsciousness" });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(2);
	});

	test("the numbers stay bare, because the heading already said it", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("01");
	});

	test("an ordinary album is not headed at all", async ({ page }) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK));

		const album = page
			.locator("section")
			.filter({ hasText: SINGLE_DISC_ALBUM });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(0);
	});
});

test.describe("a multi-disc album in the list layout", () => {
	test.use({ settings: { "jean.layout": "compact" } });

	test("the track number carries the disc, since nothing else can", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		await expect(trackNumberOf(rowByTitle(page, DISC_ONE))).toHaveText("1.01");
		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("2.01");
	});

	test("the number fits its column rather than running into what follows", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_ONE));

		// Four characters where the column was drawn for two.
		const fits = await rowByTitle(page, DISC_ONE).evaluate(
			(row: HTMLElement) => {
				const cell = row.firstElementChild;
				return cell!.scrollWidth <= cell!.clientWidth;
			},
		);
		expect(fits).toBe(true);
	});

	test("a single-disc album keeps a plain number", async ({ page }) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK));

		await expect(trackNumberOf(rowByTitle(page, SINGLE_DISC_TRACK))).toHaveText(
			"02",
		);
	});
});

// %discnumber% is a tag like any other, and plenty of libraries never wrote it.
// Split by layout rather than looped: only the album layout can draw a disc
// heading, and only the compact one can prefix a number, so one body would
// carry a live assertion and a dead one in each pass.
test.describe("a library with no disc tags, in the album layout", () => {
	test.use({
		withoutFields: ["%discnumber%"],
		settings: { "jean.layout": "album" },
	});

	test("the album is not headed into discs it was never told about", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		const album = page
			.locator("section")
			.filter({ hasText: "Deathconsciousness" });
		await expect(album).toHaveCount(1);
		await expect(album.getByRole("heading", { level: 3 })).toHaveCount(0);
	});
});

test.describe("a library with no disc tags, in the list layout", () => {
	test.use({
		withoutFields: ["%discnumber%"],
		settings: { "jean.layout": "compact" },
	});

	test("the number stays bare rather than being prefixed with a guess", async ({
		page,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, DISC_TWO));

		// Both discs number from 01, and with the tag gone there is nothing to tell
		// them apart with: "2.01" here would be invented.
		await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText("01");
		await expect(trackNumberOf(rowByTitle(page, DISC_ONE))).toHaveText("01");
	});
});

// In All Music the album groups are the runs `GET /api/library/runs`
// answers, and a group's name and disc headings come from its rows, a skeleton until they land.
const groups = (page: Page) => page.locator("main [data-span-start]");

const groupAt = (page: Page, start: number) =>
	page.locator(`main [data-span-start="${start}"]`);

const recordRuns = (page: Page) => {
	const answered: { lengths: number[]; covers: number[] }[] = [];
	page.on("response", async (response) => {
		if (new URL(response.url()).pathname !== "/api/library/runs") return;
		if (response.status() === 200) answered.push(await response.json());
	});
	return async () => {
		await expect
			.poll(() => answered.length, {
				message: "All Music never asked for the runs",
			})
			.toBeGreaterThan(0);
		const { lengths } = answered[answered.length - 1];
		let start = 0;
		return lengths.map((count) => {
			const run = { start, count };
			start += count;
			return run;
		});
	};
};

const nextFrames = (page: Page) =>
	page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);

// A virtualised list mounts what is near the viewport, so it is walked a screen short of a screenful
// at a time, which nothing drawn can fall between, reading what each stop has mounted.
const walkTheList = async <T>(page: Page, read: () => Promise<T[]>) => {
	const seen: T[] = [];
	for (;;) {
		seen.push(...(await read()));
		const moved = await page.evaluate(() => {
			const scroller = document.querySelector("main") as HTMLElement;
			const from = scroller.scrollTop;
			scroller.scrollBy(0, scroller.clientHeight * 0.8);
			return scroller.scrollTop > from;
		});
		if (!moved) return seen;
		await nextFrames(page);
	}
};

const groupsDrawn = async (page: Page) => {
	await expect(groups(page).first()).toBeAttached();
	const spans = await walkTheList(page, () =>
		groups(page).evaluateAll((sections) =>
			sections.map((section) => [
				Number((section as HTMLElement).dataset.spanStart),
				Number((section as HTMLElement).dataset.spanCount),
			]),
		),
	);
	return [...new Map(spans.map(([start, count]) => [start, count]))]
		.sort(([left], [right]) => left - right)
		.map(([start, count]) => ({ start, count }));
};

const rowsDrawn = async (page: Page) => {
	const rows = await walkTheList(page, () =>
		page
			.locator('main [role="row"][data-row]')
			.evaluateAll((drawn) =>
				drawn.map(
					(row) =>
						[
							Number((row as HTMLElement).dataset.row),
							row.textContent ?? "",
						] as [number, string],
				),
			),
	);
	return [...new Map(rows)].sort(([left], [right]) => left - right);
};

const holdRows = (page: Page, hold: boolean) =>
	page.request.post("/__control/holdRows", { data: { hold } });

test.describe("All Music in the album layout", () => {
	test.use({ settings: { "jean.layout": "album" } });

	test("draws one group per run the component answers", async ({ page }) => {
		const runs = recordRuns(page);
		await page.goto("/#/all");

		expect(await groupsDrawn(page)).toEqual(await runs());
	});

	// Jar Of Flies' first track credits whitespace alone and its second no one. The component reads
	// both as nobody and answers them as one run, where the rows alone would draw two groups.
	test.describe("where the rows and the runs disagree", () => {
		test.use({
			retagged: {
				"Rotten Apple": { "%artist%": " ", "%album artist%": " " },
				Nutshell: { "%artist%": "?", "%album artist%": "?" },
			},
		});

		test("the runs decide the groups", async ({ page }) => {
			const runs = recordRuns(page);
			await page.goto("/#/all");

			const answered = await runs();
			expect(answered[0]).toEqual({ start: 0, count: 2 });
			expect(await groupsDrawn(page)).toEqual(answered);
		});
	});

	test.describe("with the rows held", () => {
		test.use({ fooJean: { holdRows: true } });

		test("an album's name and its disc headings wait for its rows, and land with them", async ({
			page,
			player,
		}) => {
			const runs = recordRuns(page);
			await page.goto("/#/all");
			const last = (await runs()).at(-1);
			if (!last) throw new Error("the library answered no runs");
			await expect
				.poll(() => player.fooJean.rowsHeld.length, {
					message: "All Music never asked for its rows",
				})
				.toBeGreaterThan(0);

			const album = groupAt(page, last.start);
			await scrollUntilMounted(page, album);
			expect(await album.getByRole("heading", { level: 3 }).count()).toBe(0);
			expect(
				await album.getByRole("link", { name: "Deathconsciousness" }).count(),
			).toBe(0);
			expect(await album.getByText(en["track.unknownAlbum"]).count()).toBe(0);

			await holdRows(page, false);
			await expect(
				album.getByRole("link", { name: "Deathconsciousness" }),
			).toBeVisible();
			await expect(heading(page, "Disc 1")).toBeVisible();
			await expect(heading(page, "Disc 2")).toBeVisible();
		});
	});
});

test.describe("All Music in the list layout, with the rows held", () => {
	test.use({
		settings: { "jean.layout": "compact" },
		fooJean: { holdRows: true },
	});

	test("a second disc's track number waits for its rows, and lands carrying the disc", async ({
		page,
		player,
	}) => {
		await page.goto("/#/all");
		await expect
			.poll(() => player.fooJean.rowsHeld.length, {
				message: "All Music never asked for its rows",
			})
			.toBeGreaterThan(0);
		const ordinal = player
			.ordinalOrder()
			.findIndex((entry) => entry.track["%title%"] === DISC_TWO);
		const row = page.locator(`main [role="row"][data-row="${ordinal}"]`);
		await scrollUntilMounted(page, row);

		expect(await trackNumberOf(row).textContent()).not.toBe("2.01");

		await holdRows(page, false);
		await expect(trackNumberOf(row)).toHaveText("2.01");
	});
});

// An album page's positions are its own, numbered from 0, and its ordinals start wherever the album
// sits in the library: Lafcadio at ordinal 7, past Jar Of Flies' run of seven, and Deathconsciousness
// at 41, its second disc opening at its eighth track. Groups drawn by the library's runs over those
// positions split the album where Jar Of Flies ends, run on past its last row, and take another
// track's cover.
const albumOf = (player: FakePlayer, album: string) =>
	player.ordinalOrder().filter((entry) => entry.track["%album%"] === album);

const openAlbumPage = async (
	page: Page,
	player: FakePlayer,
	credit: string,
	album: string,
) => {
	const tracks = albumOf(player, album);
	await page.goto(`/#/${albumRoute(credit, album)}`);
	await expect(
		page.getByRole("heading", { level: 1, name: album }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toContainText(
		String(tracks[0].track["%title%"]),
	);
	return tracks;
};

test.describe("an album page for an album the library's first run does not start", () => {
	test.describe("in the album layout", () => {
		test.use({ settings: { "jean.layout": "album" } });

		test("draws the album as one group of its own rows, and no row past its end", async ({
			page,
			player,
		}) => {
			const tracks = await openAlbumPage(
				page,
				player,
				"As Tall as Lions",
				"Lafcadio",
			);

			expect(await groupsDrawn(page)).toEqual([
				{ start: 0, count: tracks.length },
			]);
			const rows = await rowsDrawn(page);
			expect(rows.map(([position]) => position)).toEqual(
				tracks.map((_, position) => position),
			);
			rows.forEach(([position, text]) => {
				expect(text).toContain(String(tracks[position].track["%title%"]));
			});
		});

		test("heads the album's discs where its discs change", async ({
			page,
			player,
		}) => {
			const tracks = await openAlbumPage(
				page,
				player,
				"Have a Nice Life",
				"Deathconsciousness",
			);

			expect(await groupsDrawn(page)).toEqual([
				{ start: 0, count: tracks.length },
			]);
			const album = groupAt(page, 0);
			await scrollUntilMounted(
				page,
				album.getByRole("heading", { name: "Disc 2" }),
			);
			const headed = await album
				.getByRole("heading", { level: 3 })
				.evaluateAll((headings) =>
					headings.map((heading) => [
						heading.textContent,
						heading.nextElementSibling?.getAttribute("data-row") ?? null,
					]),
				);
			const secondDisc = tracks.findIndex(
				(entry) => entry.track["%discnumber%"] === "2",
			);
			expect(headed).toEqual([
				["Disc 1", "0"],
				["Disc 2", String(secondDisc)],
			]);
		});
	});

	test.describe("in the list layout, with covers", () => {
		test.use({ settings: { "jean.layout": "compact", "jean.artwork": true } });

		test("asks for the album's own cover on every row, and no other", async ({
			page,
			player,
		}) => {
			const tracks = await openAlbumPage(
				page,
				player,
				"As Tall as Lions",
				"Lafcadio",
			);
			await rowsDrawn(page);

			await expectSettlesAt(
				player,
				() => [...new Set(coversFromTheComponent(player))],
				[tracks[0].path],
			);
		});
	});
});
