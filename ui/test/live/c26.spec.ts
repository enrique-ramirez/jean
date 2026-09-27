import { trackRow } from "../e2e/fixtures.ts";
import {
	FIXTURES,
	type FixtureRow,
	fixtureRows,
	rowsOf,
	writeRating,
} from "./component.ts";
import { expect, type LiveTrack, type Page, test } from "./fixtures.ts";

// On a real player: a rating written outside Jean reaches the open playlist through the changes
// route, inside one poll, and costs no whole-playlist refetch.

// Either control, as `player-poll.spec.ts` does it: `Stars` is an `img` and `StarsInput` a `group`.
const ratingOf = (page: Page, row: number) =>
	trackRow(page, row)
		.getByRole("img", { name: /stars|Unrated/ })
		.or(trackRow(page, row).getByRole("group", { name: /stars|Unrated/ }));

interface Seen {
	method: string;
	url: string;
	at: number;
}

const QUIET_MS = 3_000;
const PAGING_TIMEOUT_MS = 60_000;

const hasLibraryPath = (
	row: FixtureRow,
): row is FixtureRow & { libraryPath: string } => row.libraryPath !== null;

const countsByLibraryPath = (paths: string[]) => {
	const counts = new Map<string, number>();
	for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
	return counts;
};

const uniquelyAddressed = (rows: FixtureRow[], tracks: LiveTrack[]) => {
	const inLibrary = rows.filter(hasLibraryPath);
	const rowCounts = countsByLibraryPath(
		inLibrary.map((row) => row.libraryPath),
	);
	const trackCounts = countsByLibraryPath(
		tracks.map((track) => track.libraryPath),
	);
	const found = inLibrary.find(
		(row) =>
			rowCounts.get(row.libraryPath) === 1 &&
			trackCounts.get(row.libraryPath) === 1,
	);
	if (!found)
		throw new Error(
			`no row in ${FIXTURES} names a media library track by an address nothing else in the playlist or the library shares`,
		);
	return found;
};

test("a rating written at the player reaches the open playlist through the changes route", async ({
	page,
	install,
}) => {
	test.setTimeout(PAGING_TIMEOUT_MS + 30_000);
	const { playlist, rows } = await fixtureRows();
	const { row, path, libraryPath } = uniquelyAddressed(rows, install.tracks);

	// foobar2000 answers `?` for a field with no value, which for a rating means unrated.
	const held = (await rowsOf(playlist.id, row, 1, ["%rating%"])).items[0]
		.columns[0];
	const notedRating = held === "?" ? "" : held;

	await page.addInitScript(
		(values: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(values))
				window.localStorage.setItem(key, JSON.stringify(value));
		},
		{ "jean.columns": ["duration", "rating"] },
	);

	const seen: Seen[] = [];
	const rowsRoute = `/api/playlists/${playlist.id}/items`;
	const changed: string[] = [];
	page.on("request", (request) => {
		seen.push({ method: request.method(), url: request.url(), at: Date.now() });
	});
	page.on("response", async (response) => {
		if (!response.url().includes(`${rowsRoute}/changes?`)) return;
		try {
			changed.push(await response.text());
		} catch {
			// A navigation can discard a body before it is read; the request log still counts it.
		}
	});

	try {
		await writeRating({ track: libraryPath, path }, "");

		await page.goto(`#/${playlist.id}`);
		await expect(
			page.getByRole("heading", { level: 1, name: FIXTURES }),
		).toBeVisible();
		await expect(page.getByRole("grid")).toHaveAttribute(
			"aria-rowcount",
			String(playlist.itemCount),
		);
		await expect(ratingOf(page, row)).toHaveAccessibleName("Unrated");

		const pageReads = () =>
			seen.filter((one) => one.url.includes(`${rowsRoute}?`));

		// The first load pages through the playlist, so the "no refetch" count below only means
		// something once that paging has stopped.
		await expect
			.poll(() => Date.now() - (pageReads().at(-1)?.at ?? 0), {
				timeout: PAGING_TIMEOUT_MS,
				intervals: [500],
			})
			.toBeGreaterThan(QUIET_MS);

		const mark = seen.length;
		const startedAt = Date.now();
		await writeRating({ track: libraryPath, path }, "4");

		const rated = (await rowsOf(playlist.id, row, 1, ["%rating%"])).items[0]
			.columns[0];
		expect(rated).toBe("4");

		await expect(ratingOf(page, row)).toHaveAccessibleName("4 of 5 stars");
		const shownAfterMs = Date.now() - startedAt;

		// A couple of further polls, so a refetch arriving late is still counted.
		await page.waitForTimeout(QUIET_MS);

		const after = seen.slice(mark);
		const changes = after.filter((one) =>
			one.url.includes(`${rowsRoute}/changes?`),
		);
		const refetches = after.filter((one) => one.url.includes(`${rowsRoute}?`));

		console.log(
			`[c26] playlist ${playlist.id} "${FIXTURES}", ${playlist.itemCount} rows`,
		);
		console.log(`[c26] rated track: ${path}`);
		console.log(`[c26] the new value is on screen after ${shownAfterMs} ms`);
		console.log(`[c26] changes requests after the write: ${changes.length}`);
		for (const one of changes) console.log(`[c26]   ${one.method} ${one.url}`);
		for (const body of changed) console.log(`[c26]   body ${body}`);
		console.log(
			`[c26] whole-playlist refetches after the write: ${refetches.length}`,
		);
		for (const one of refetches)
			console.log(`[c26]   ${one.method} ${one.url}`);

		expect(changes.length).toBeGreaterThan(0);
		expect(refetches).toEqual([]);
	} finally {
		await writeRating({ track: libraryPath, path }, notedRating);
	}
});
