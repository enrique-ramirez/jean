import { trackRow } from "../e2e/fixtures.ts";
import { byTitle, rowsOf, TOKEN, writeRating } from "./component.ts";
import { expect, type Page, test } from "./fixtures.ts";

// Criterion 26 on a real player: a rating written outside Jean reaches the open playlist through
// the changes route, inside one poll, and costs no whole-playlist refetch.

const TITLE = process.env.LIVE_PLAYLIST ?? "#T10 a";

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

// The live fixture's own guard reads beefweb's `/api/library/items`, which released beefweb 0.10
// does not answer, so this spec carries the guard itself: one tag is written, to one track, and
// that track's path has to sit under the root the caller declared disposable.
test("a rating written at the player reaches the open playlist through the changes route", async ({
	page,
}) => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root)
		throw new Error("LIVE_LIBRARY_ROOT must name the disposable library root");

	const playlist = await byTitle(TITLE);
	const first = await rowsOf(playlist.id, 0, 1);
	const path = first.items[0].columns[0];
	if (!path.startsWith(root))
		throw new Error(
			`${path} sits outside ${root}, refusing to write a tag to it`,
		);

	await page.addInitScript(
		(values: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(values))
				window.localStorage.setItem(key, JSON.stringify(value));
		},
		{
			"jean.columns": ["duration", "rating"],
			"jean.fooJeanToken": TOKEN(),
		},
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

	await page.goto(`#/${playlist.id}`);
	await expect(
		page.getByRole("heading", { level: 1, name: TITLE }),
	).toBeVisible();
	await expect(page.getByRole("grid")).toHaveAttribute(
		"aria-rowcount",
		String(playlist.itemCount),
	);
	await expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated");

	const pageReads = () =>
		seen.filter((one) => one.url.includes(`${rowsRoute}?`));

	// The first load pages through the playlist, so the "no refetch" count below only means
	// something once that paging has stopped.
	await expect
		.poll(() => Date.now() - (pageReads().at(-1)?.at ?? 0), {
			timeout: 60_000,
			intervals: [500],
		})
		.toBeGreaterThan(QUIET_MS);

	const mark = seen.length;
	const startedAt = Date.now();
	await writeRating(path, "4");

	await expect(ratingOf(page, 0)).toHaveAccessibleName("4 of 5 stars");
	const shownAfterMs = Date.now() - startedAt;

	// A couple of further polls, so a refetch arriving late is still counted.
	await page.waitForTimeout(QUIET_MS);

	const after = seen.slice(mark);
	const changes = after.filter((one) =>
		one.url.includes(`${rowsRoute}/changes?`),
	);
	const refetches = after.filter((one) => one.url.includes(`${rowsRoute}?`));

	console.log(
		`[c26] playlist ${playlist.id} "${TITLE}", ${playlist.itemCount} rows`,
	);
	console.log(`[c26] rated track: ${path}`);
	console.log(`[c26] the new value is on screen after ${shownAfterMs} ms`);
	console.log(`[c26] changes requests after the write: ${changes.length}`);
	for (const one of changes) console.log(`[c26]   ${one.method} ${one.url}`);
	for (const body of changed) console.log(`[c26]   body ${body}`);
	console.log(
		`[c26] whole-playlist refetches after the write: ${refetches.length}`,
	);
	for (const one of refetches) console.log(`[c26]   ${one.method} ${one.url}`);

	expect(changes.length).toBeGreaterThan(0);
	expect(refetches).toEqual([]);

	await writeRating(path, "");
	await expect(ratingOf(page, 0)).toHaveAccessibleName("Unrated");
});
