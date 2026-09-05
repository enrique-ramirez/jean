import { test as base, expect } from "@playwright/test";

import { fieldTable } from "../../src/shared/api/fieldTable.ts";

// A real foobar2000 rather than the fake, so nothing here may assume what is in it: whatever a
// spec needs about the library it reads off the player first. That is also the point of these
// specs -- everywhere the fake supplies both sides of a comparison it is only checking that a
// string equals itself, and a path join, a decoded cover and an SSE update are three of those.
//
//   LIVE=http://<player-host>:8880/jean/ LIVE_LIBRARY_ROOT='D:\SomeFolder' pnpm test:live
//
// `LIVE` is the url the app is served at, since beefweb serves its own client at the root and
// Jean under a `urlMappings` prefix. The api origin is taken from it.

const LIBRARY_PLAYLIST = "#Jean Library";

// Pairs rather than a bare list, because the player answers positionally: written out separately,
// the day somebody inserts an expression in the middle is the day a row reports its album as its
// artist. A comma inside an expression would split beefweb's own `columns` list the same way, so
// these stay comma-free too.
const { expressions, index: FIELD } = fieldTable([
	["path", "%path%"],
	["title", "%title%"],
	["artist", "%artist%"],
	["album", "%album%"],
	["rating", "%rating%"],
] as const);

export interface LiveTrack {
	path: string;
	title: string;
	artist: string;
	album: string;
	rating: string;
}

export interface Install {
	origin: string;
	info: { name: string; version: string; pluginVersion: string };
	libraryId: string;
	itemCount: number;
	tracks: LiveTrack[];
	hasFooJean: boolean;
}

export const api = async <T>(
	origin: string,
	path: string,
	init?: RequestInit,
): Promise<T> => {
	const response = await fetch(`${origin}/api${path}`, init);
	if (!response.ok)
		throw new Error(
			`${init?.method ?? "GET"} /api${path} -> ${response.status}`,
		);
	// beefweb answers a write with an empty body, which is not JSON.
	const body = await response.text();
	return (body ? JSON.parse(body) : undefined) as T;
};

export const post = (origin: string, path: string, body?: unknown) =>
	api<void>(origin, path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

const readInstall = async (origin: string): Promise<Install> => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root)
		throw new Error(
			"LIVE_LIBRARY_ROOT must name the folder the test library sits under. These specs play, queue and write tags, so they refuse to run against a player they have not been told is disposable.",
		);

	const { player } = await api<{ player: { info: Install["info"] } }>(
		origin,
		"/player",
	);

	const { playlists } = await api<{
		playlists: { id: string; title: string; itemCount: number }[];
	}>(origin, "/playlists");
	const library = playlists.find((one) => one.title === LIBRARY_PLAYLIST);
	if (!library)
		throw new Error(
			`${origin} has no ${LIBRARY_PLAYLIST} playlist, so there is nothing for Jean to read as the library on a player with no media library API.`,
		);

	const columns = encodeURIComponent(expressions.join(","));
	const { playlistItems } = await api<{
		playlistItems: { items: { columns: string[] }[] };
	}>(
		origin,
		`/playlists/${library.id}/items/0:${library.itemCount}?columns=${columns}`,
	);
	const tracks = playlistItems.items.map(({ columns: values }) => ({
		path: values[FIELD.path],
		title: values[FIELD.title],
		artist: values[FIELD.artist],
		album: values[FIELD.album],
		rating: values[FIELD.rating],
	}));

	// The guard. One track outside the named root is enough to stop, because the alternative is
	// discovering afterwards that the queue and the tags written belonged to somebody's library.
	const strays = tracks.filter((track) => !track.path.startsWith(root));
	if (strays.length)
		throw new Error(
			`${strays.length} of ${tracks.length} tracks sit outside ${root} -- refusing to drive this player. First: ${strays[0]?.path}`,
		);

	// null is the not-installed answer, and is the common case.
	const record = await api<unknown>(origin, "/clientconfig/foo_jean");

	return {
		origin,
		info: player.info,
		libraryId: library.id,
		itemCount: library.itemCount,
		tracks,
		hasFooJean: record !== null,
	};
};

interface LiveFixtures {
	install: Install;
}

// The same seeds the fake suite uses, for the same reason: the play-count shading introduces
// itself on first sight and would otherwise cover the toolbar in every spec.
const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// No test-scoped fixtures of its own -- `page` below overrides a built-in. `Record<string, never>`
// would give it an index signature, under which `install` resolves as `never`.
export const test = base.extend<Record<never, never>, LiveFixtures>({
	// Worker-scoped, so the library is read once rather than per test. It takes the url from the
	// environment rather than from `baseURL`, which is test-scoped and cannot be depended on here.
	install: [
		// biome-ignore lint/correctness/noEmptyPattern: playwright reads dependencies off this pattern
		async ({}, use) => {
			const live = process.env.LIVE;
			if (!live)
				throw new Error("LIVE must name the url the app is served at.");
			await use(await readInstall(new URL(live).origin));
		},
		{ scope: "worker" },
	],

	// Reduced motion for the same reason the fake suite does it: Playwright will not click a
	// target whose bounding box never holds still, and `reducedMotion` in `use` is accepted and
	// silently ignored.
	page: async ({ page }, use) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.addInitScript((values: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(values))
				window.localStorage.setItem(key, JSON.stringify(value));
		}, SEEDED_SETTINGS);
		await use(page);
	},
});

export type { Locator, Page } from "@playwright/test";
export { expect };

// Restores the player to stopped and the queue to empty. Every spec that starts something owns
// putting it back, because the next one reads the same single player.
export const reset = async (origin: string) => {
	await post(origin, "/player/stop");
	await post(origin, "/playqueue/clear");
};
