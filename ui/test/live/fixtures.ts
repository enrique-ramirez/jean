import { test as base, expect } from "@playwright/test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { fetchLibrary } from "../../src/shared/api/fooJeanLibrary.ts";
import { COMPONENT, capabilities, component, send } from "./component.ts";

//   LIVE=http://<player-host>:<port>/ LIVE_LIBRARY_ROOT='D:\SomeFolder' pnpm test:live

const COLUMNS = {
	path: "%path%",
	title: "%title%",
	artist: "%artist%",
	album: "%album%",
	rating: "%rating%",
	seconds: "%length_seconds%",
	lyricLength: "$len($meta(unsynced lyrics))",
} as const;

export type LiveTrack = Record<keyof typeof COLUMNS, string> & {
	libraryPath: string;
};

export interface Install {
	root: string;
	structure: number;
	itemCount: number;
	tracks: LiveTrack[];
	canWriteRatings: boolean;
}

const LIBRARY_BUILD_MS = 5 * 60_000;
const LIBRARY_BUILDS = 2;

const readInstall = async (): Promise<Install> => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root)
		throw new Error(
			"LIVE_LIBRARY_ROOT must name the folder the test library sits under. These specs play, queue and write tags, so they refuse to run against a player they have not been told is disposable.",
		);

	// The same client the app polls the export from, so a spec waits out a build exactly as Jean
	// does rather than through a second copy of the 202/429 protocol.
	const result = await fetchLibrary(COMPONENT(), Object.values(COLUMNS));
	if (!result.ok)
		throw new Error(
			`GET /api/library/export -> ${result.reason} ${result.detail}`,
		);
	const library = result.library;
	const column = (expression: string) => {
		const found = library.columns.get(expression);
		if (!found) throw new Error(`the library export carries no ${expression}`);
		return found;
	};
	const columns = Object.entries(COLUMNS).map(
		([name, expression]) => [name, column(expression)] as const,
	);
	const { directory, filename } = library.spine;

	const tracks = Array.from({ length: library.trackCount }, (_, row) => ({
		...(Object.fromEntries(
			columns.map(([name, values]) => [name, values.at(row)]),
		) as Record<keyof typeof COLUMNS, string>),
		libraryPath: directory.at(row) + filename.at(row),
	}));

	const strays = tracks.filter((track) => !track.path.startsWith(root));
	if (strays.length)
		throw new Error(
			`${strays.length} of ${tracks.length} tracks sit outside ${root}, refusing to drive this player. First: ${strays[0]?.path}`,
		);

	// Warmed here, once, under this fixture's own budget, so a page in a later spec finds Jean's
	// columns already built instead of waiting out a fresh one under its test's shorter timeout.
	const warmed = await fetchLibrary(COMPONENT(), TRACK_EXPRESSIONS);
	if (!warmed.ok)
		throw new Error(
			`GET /api/library/export -> ${warmed.reason} ${warmed.detail}`,
		);

	const allowed = await capabilities();
	return {
		root,
		structure: warmed.library.structure,
		itemCount: library.trackCount,
		tracks,
		canWriteRatings:
			allowed.canWrite &&
			allowed.allowedFields.some((field) => field.toLowerCase() === "rating"),
	};
};

interface LiveFixtures {
	install: Install;
}

const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// No test-scoped fixtures of its own: `page` below overrides a built-in. `Record<string, never>`
// would give it an index signature, under which `install` resolves as `never`.
export const test = base.extend<Record<never, never>, LiveFixtures>({
	// Automatic, so no spec reaches the player before the guard has passed.
	install: [
		// biome-ignore lint/correctness/noEmptyPattern: playwright reads dependencies off this pattern
		async ({}, use) => {
			await use(await readInstall());
		},
		{ scope: "worker", auto: true, timeout: LIBRARY_BUILDS * LIBRARY_BUILD_MS },
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
export const reset = async () => {
	await send("/api/playback/stop");
	await component<void>("/api/queue", { method: "DELETE" });
};
