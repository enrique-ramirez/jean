import type { Route } from "@playwright/test";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	guidOfPlaylist,
	HEADER_TILES_AT_MOST,
	routeOf,
	trackRow,
} from "./fixtures.ts";

// What a playlist view asks of the player, for the specs of the playlist views: a
// playlist read in windows of its rows, by `GET /api/playlists/{id}/items` with `offset` and
// `count`, beside its runs.

export const WINDOW_ROWS = 2048;

// `librarySize` puts this many generated tracks in `Library`, the fake's `p7`, which is then a
// playlist of two full windows and a short third.
export const LONG_PLAYLIST_ROWS = 5000;
export const LONG_PLAYLIST = "p7";

export interface PageAsk {
	offset: number;
	count: number;
}

const playlistPath = (player: FakePlayer, key: string) =>
	`/api/playlists/${guidOfPlaylist(player, key)}`;

export const pageAsks = (player: FakePlayer, key: string, from = 0) => {
	const route = `${playlistPath(player, key)}/items`;
	return player.requests
		.slice(from)
		.filter((entry) => entry.method === "GET" && routeOf(entry.path) === route)
		.map((entry): PageAsk => {
			const query = new URLSearchParams(entry.path.split("?")[1] ?? "");
			return {
				offset: Number(query.get("offset")),
				count: Number(query.get("count")),
			};
		});
};

// A header's covers may read a tile's row, and a tile is a few rows at most.
const isTileAsk = (ask: PageAsk) => ask.count <= HEADER_TILES_AT_MOST;

export const playlistAsksOf = (player: FakePlayer, key: string, from = 0) => {
	const prefix = `${playlistPath(player, key)}/`;
	const asks = player.requests
		.slice(from)
		.filter((entry) => routeOf(entry.path).startsWith(prefix))
		.map(
			(entry) => `${entry.method} ${routeOf(entry.path).slice(prefix.length)}`,
		);
	const pages = pageAsks(player, key, from);
	return {
		runs: asks.filter((ask) => ask === "GET runs").length,
		windows: pages.filter((ask) => !isTileAsk(ask)),
		tiles: pages.filter(isTileAsk),
		others: asks.filter((ask) => ask !== "GET runs" && ask !== "GET items"),
	};
};

export const expectTileAsksAtMost = (tiles: PageAsk[]) => {
	expect(tiles.length).toBeLessThanOrEqual(HEADER_TILES_AT_MOST);
	for (const tile of tiles)
		expect(tile.count).toBeLessThanOrEqual(HEADER_TILES_AT_MOST);
};

export interface RunsAnswer {
	status: number;
	etag: string | null;
	ifNoneMatch: string | null;
}

// Read in the browser: the fake's log has neither the request's headers nor the status.
export const recordRunsAnswers = (
	page: Page,
	player: FakePlayer,
	key: string,
) => {
	const answers: RunsAnswer[] = [];
	page.on("response", async (response) => {
		const url = new URL(response.url());
		if (url.pathname !== `${playlistPath(player, key)}/runs`) return;
		answers.push({
			status: response.status(),
			etag: await response.headerValue("etag"),
			ifNoneMatch: await response.request().headerValue("if-none-match"),
		});
	});
	return answers;
};

export const holdPlaylistPages = async (
	page: Page,
	player: FakePlayer,
	key: string,
	holds: (ask: PageAsk) => boolean,
) => {
	const route = `${playlistPath(player, key)}/items`;
	const held: Route[] = [];
	let rule = holds;
	let isReleased = false;
	await page.route(
		(url) => url.pathname === route,
		(asked) => {
			const query = new URL(asked.request().url()).searchParams;
			const ask = {
				offset: Number(query.get("offset")),
				count: Number(query.get("count")),
			};
			if (isReleased || !rule(ask)) return asked.fallback();
			held.push(asked);
		},
	);
	return {
		held,
		holdAlso: (more: (ask: PageAsk) => boolean) => {
			const before = rule;
			rule = (ask) => before(ask) || more(ask);
		},
		release: async () => {
			isReleased = true;
			for (const asked of held.splice(0)) await asked.fallback();
		},
	};
};

export const fromTheSecondWindow = (ask: PageAsk) => ask.offset >= WINDOW_ROWS;

export const everyPage = () => true;

// Sets the scroller so `row` sits at the top of the viewport. A list this long is under the
// scale's cap, so a row's offset is its index times its height.
export const scrollToRow = (page: Page, row: number) =>
	page.locator("main").evaluate((scroller, at) => {
		const grid = scroller.querySelector('[role="grid"]') as HTMLElement;
		const drawn = scroller.querySelector(
			'[role="row"][data-row]',
		) as HTMLElement;
		const margin =
			grid.getBoundingClientRect().top -
			scroller.getBoundingClientRect().top +
			scroller.scrollTop;
		scroller.scrollTop = margin + at * drawn.getBoundingClientRect().height;
	}, row);

// The count Jean draws: the higher of the two sources foobar2000 may carry.
export const playsOf = (track: Record<string, unknown>) =>
	Math.max(
		0,
		...["%lastfm_play_count%", "%play_count%"]
			.map((expression) => Number(track[expression]))
			.filter(Number.isFinite),
	);

export const titleIn = (player: FakePlayer, key: string, position: number) =>
	String(
		player.playlists.find((entry) => entry.id === key)?.items[position]?.[
			"%title%"
		],
	);

export const expectRowLanded = async (
	page: Page,
	index: number,
	title: string,
) => {
	await expect(trackRow(page, index)).not.toHaveAttribute("aria-busy", "true");
	await expect(trackRow(page, index)).toContainText(title);
};

export const expectRowPending = (page: Page, index: number) =>
	expect(trackRow(page, index)).toHaveAttribute("aria-busy", "true");
