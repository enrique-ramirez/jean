import { test as base, expect } from "@playwright/test";

import { fieldTable } from "../../src/shared/api/fieldTable.ts";

//   LIVE=http://<player-host>:8880/jean/ LIVE_LIBRARY_ROOT='D:\SomeFolder' pnpm test:live

// A comma inside an expression would split beefweb's own `columns` list, so these stay comma-free.
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

	// Read off beefweb rather than off the component, so the expected set is not the thing under
	// test. Sorted by `%path%`, which is absolute, while the component orders by the
	// library-relative one: the two agree on a single-root library, and this harness already
	// insists on one through `LIVE_LIBRARY_ROOT`.
	const columns = encodeURIComponent(expressions.join(","));
	const { libraryItems } = await api<{
		libraryItems: { totalCount: number; items: { columns: string[] }[] };
	}>(
		origin,
		`/library/items?columns=${columns}&sort=${encodeURIComponent("%path%")}`,
	);
	const tracks = libraryItems.items.map(({ columns: values }) => ({
		path: values[FIELD.path],
		title: values[FIELD.title],
		artist: values[FIELD.artist],
		album: values[FIELD.album],
		rating: values[FIELD.rating],
	}));

	const strays = tracks.filter((track) => !track.path.startsWith(root));
	if (strays.length)
		throw new Error(
			`${strays.length} of ${tracks.length} tracks sit outside ${root} -- refusing to drive this player. First: ${strays[0]?.path}`,
		);

	const record = await api<unknown>(origin, "/clientconfig/foo_jean");

	return {
		origin,
		info: player.info,
		itemCount: libraryItems.totalCount,
		tracks,
		hasFooJean: record !== null,
	};
};

interface LiveFixtures {
	install: Install;
}

const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// No test-scoped fixtures of its own -- `page` below overrides a built-in. `Record<string, never>`
// would give it an index signature, under which `install` resolves as `never`.
export const test = base.extend<Record<never, never>, LiveFixtures>({
	// Worker-scoped, so it takes the url from the environment rather than from `baseURL`, which is
	// test-scoped and cannot be depended on here.
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
