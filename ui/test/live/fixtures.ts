import { test as base, expect } from "@playwright/test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { fetchLibrary } from "../../src/shared/api/fooJeanLibrary.ts";
import {
	COMPONENT,
	capabilities,
	component,
	type Playlist,
	playlists,
	send,
	underRoot,
} from "./component.ts";

//   LIVE=http://<player-host>:<port>/ LIVE_LIBRARY_ROOT=<root> pnpm test:live

const COLUMNS = {
	path: "%path%",
	subsong: "%subsong%",
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

// A library may hold files with no tags at all, so a search term comes from the first artist the
// player actually resolved rather than one only a particular library carries.
export const searchTerm = (install: Install) => {
	const found = install.tracks.find((track) => track.artist !== "?");
	if (!found)
		throw new Error(
			"every track in this library is untagged, so there is no artist to search for",
		);
	return found.artist;
};

const LIBRARY_BUILD_MS = 5 * 60_000;
const LIBRARY_BUILDS = 2;

// The same client the app polls the export from, so a caller waits out a build exactly as Jean
// does rather than through a second copy of the 202/429 protocol.
const readTracks = async (): Promise<LiveTrack[]> => {
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

	return Array.from({ length: library.trackCount }, (_, row) => ({
		...(Object.fromEntries(
			columns.map(([name, values]) => [name, values.at(row)]),
		) as Record<keyof typeof COLUMNS, string>),
		libraryPath: directory.at(row) + filename.at(row),
	}));
};

const readInstall = async (): Promise<Install> => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root)
		throw new Error(
			"LIVE_LIBRARY_ROOT must name the folder the test library sits under. These specs play, queue and write tags, so they refuse to run against a player they have not been told is disposable.",
		);

	const tracks = await readTracks();

	const strays = tracks.filter((track) => !underRoot(track.path, root));
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
		itemCount: tracks.length,
		tracks,
		canWriteRatings:
			allowed.canWrite &&
			allowed.allowedFields.some((field) => field.toLowerCase() === "rating"),
	};
};

interface LiveFixtures {
	install: Install;
}

const MAX_NAMED = 5;

const bounded = (items: string[]): string => {
	const shown = items.slice(0, MAX_NAMED);
	const rest = items.length - shown.length;
	return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
};

interface Snapshot {
	playlists: Playlist[];
	tracks: LiveTrack[];
}

const describeDrift = (before: Snapshot, after: Snapshot): string | null => {
	const diffs: string[] = [];

	const beforeIds = new Set(before.playlists.map((entry) => entry.id));
	const afterIds = new Set(after.playlists.map((entry) => entry.id));
	const added = after.playlists.filter((entry) => !beforeIds.has(entry.id));
	const removed = before.playlists.filter((entry) => !afterIds.has(entry.id));
	if (added.length)
		diffs.push(
			`playlist(s) added: ${bounded(added.map((entry) => `${entry.title} (${entry.id})`))}`,
		);
	if (removed.length)
		diffs.push(
			`playlist(s) removed: ${bounded(removed.map((entry) => `${entry.title} (${entry.id})`))}`,
		);

	// foobar2000 numbers a cue sheet's or another multi-track file's subsongs from 1, sharing one
	// %path% among rows that can carry independent ratings; a plain file reports subsong 0.
	const key = (track: LiveTrack) => `${track.path}\u0000${track.subsong}`;
	const name = (track: LiveTrack) =>
		track.subsong === "0" ? track.path : `${track.path}#${track.subsong}`;

	const afterRatingByKey = new Map(
		after.tracks.map((track) => [key(track), track.rating]),
	);
	const moved = before.tracks
		.filter((track) => {
			const rating = afterRatingByKey.get(key(track));
			return rating !== undefined && rating !== track.rating;
		})
		.map(
			(track) =>
				`${name(track)}: ${track.rating} -> ${afterRatingByKey.get(key(track))}`,
		);
	if (moved.length)
		diffs.push(
			`rating changed for ${moved.length} track(s): ${bounded(moved)}`,
		);

	return diffs.length
		? `the run did not leave the player as found: ${diffs.join("; ")}`
		: null;
};

const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// No test-scoped fixtures of its own: `page` below overrides a built-in. `Record<string, never>`
// would give it an index signature, under which `install` resolves as `never`.
export const test = base.extend<Record<never, never>, LiveFixtures>({
	// Automatic, so no spec reaches the player before the guard has passed. Its teardown runs once
	// per worker, and the live project runs one worker, so this is the whole run's before-and-after.
	install: [
		// biome-ignore lint/correctness/noEmptyPattern: playwright reads dependencies off this pattern
		async ({}, use) => {
			const install = await readInstall();
			const before = (await playlists()).filter((entry) => entry.role === null);
			await use(install);
			const drift = describeDrift(
				{ playlists: before, tracks: install.tracks },
				{
					playlists: (await playlists()).filter((entry) => entry.role === null),
					tracks: await readTracks(),
				},
			);
			if (drift) throw new Error(drift);
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
