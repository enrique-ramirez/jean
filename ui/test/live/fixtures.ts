import { test as base, expect } from "@playwright/test";
import { TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import { fetchLibrary } from "../../src/shared/api/fooJeanLibrary.ts";
import {
	COMPONENT,
	capabilities,
	component,
	type Playlist,
	PROBES,
	player,
	playlists,
	removePlaylist,
	rowsOf,
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

export const searchTerm = (install: Install) => {
	const found = install.tracks.find((track) => track.artist !== "?");
	if (!found)
		throw new Error(
			"every track in this library is untagged, so there is no artist to search for",
		);
	return found.artist;
};

const LIBRARY_BUILD_MS = 5 * 60_000;
// Playwright runs a fixture's teardown against what is left of the same timeout its setup used, so
// this budgets the closing read beside the two opening ones.
const LIBRARY_BUILDS = 3;

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

interface PlaylistContents {
	playlist: Playlist;
	rows: string[];
}

interface Snapshot {
	playlists: PlaylistContents[];
	tracks: LiveTrack[];
}

// `foo_jean`'s own maximum for a playlist read's `count`; `contract/openapi.yaml` refuses anything larger.
const EVERY_ROW = 4294967295;

// foobar2000 numbers a cue sheet's or another multi-track file's subsongs from 1, sharing one %path%
// among rows that can carry independent ratings; a plain file reports subsong 0.
const rowName = (path: string, subsong: string) =>
	subsong === "0" ? path : `${path}#${subsong}`;

const readPlaylists = async (): Promise<PlaylistContents[]> =>
	Promise.all(
		(await playlists())
			.filter((entry) => entry.role === null)
			.map(async (playlist) => {
				const { items } = await rowsOf(playlist.id, 0, EVERY_ROW, [
					"%path%",
					"%subsong%",
				]);
				return {
					playlist,
					rows: items.map(({ columns: [path, subsong] }) =>
						rowName(path, subsong),
					),
				};
			}),
	);

const sweepProbes = async () => {
	const titles = new Set<string>(Object.values(PROBES));
	for (const entry of await playlists())
		if (titles.has(entry.title)) await removePlaylist(entry.id);
};

const describeRows = (before: string[], after: string[]): string | null => {
	if (before.length !== after.length)
		return `${before.length} rows -> ${after.length} rows`;
	const row = before.findIndex((name, index) => name !== after[index]);
	return row === -1 ? null : `row ${row}: ${before[row]} -> ${after[row]}`;
};

const describeDrift = (before: Snapshot, after: Snapshot): string | null => {
	const diffs: string[] = [];
	const label = ({ playlist }: PlaylistContents) =>
		`${playlist.title} (${playlist.id})`;

	const beforeById = new Map(
		before.playlists.map((entry) => [entry.playlist.id, entry]),
	);
	const afterById = new Map(
		after.playlists.map((entry) => [entry.playlist.id, entry]),
	);
	const added = after.playlists.filter(
		(entry) => !beforeById.has(entry.playlist.id),
	);
	const removed = before.playlists.filter(
		(entry) => !afterById.has(entry.playlist.id),
	);
	if (added.length)
		diffs.push(`playlist(s) added: ${bounded(added.map(label))}`);
	if (removed.length)
		diffs.push(`playlist(s) removed: ${bounded(removed.map(label))}`);

	const kept = before.playlists.flatMap((entry) => {
		const found = afterById.get(entry.playlist.id);
		return found ? [[entry, found] as const] : [];
	});
	const renamed = kept
		.filter(([was, now]) => was.playlist.title !== now.playlist.title)
		.map(([was, now]) => `${label(was)} -> ${now.playlist.title}`);
	if (renamed.length) diffs.push(`playlist(s) renamed: ${bounded(renamed)}`);
	const edited = kept.flatMap(([was, now]) => {
		const change = describeRows(was.rows, now.rows);
		return change ? [`${label(was)}, ${change}`] : [];
	});
	if (edited.length) diffs.push(`playlist rows changed: ${bounded(edited)}`);

	const key = (track: LiveTrack) => `${track.path}\u0000${track.subsong}`;

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
				`${rowName(track.path, track.subsong)}: ${track.rating} -> ${afterRatingByKey.get(key(track))}`,
		);
	if (moved.length)
		diffs.push(
			`rating changed for ${moved.length} track(s): ${bounded(moved)}`,
		);

	return diffs.length
		? `the run did not leave the player as found: ${diffs.join("; ")}`
		: null;
};

interface QueuedEntry {
	title: string;
	libraryPath: string | null;
	location: { playlistId: string; index: number } | null;
}

type QueueRequest =
	| { playlistId: string; positions: number[] }
	| { structure: number; ordinals: number[] };

const requeue = (entry: QueuedEntry, install: Install): QueueRequest => {
	if (entry.location)
		return {
			playlistId: entry.location.playlistId,
			positions: [entry.location.index],
		};
	const ordinals = install.tracks.flatMap((track, ordinal) =>
		track.libraryPath === entry.libraryPath ? [ordinal] : [],
	);
	if (entry.libraryPath && ordinals.length === 1)
		return { structure: install.structure, ordinals };
	throw new Error(
		`the play queue holds ${entry.title}, which reset() could not queue again: it has no playlist row, and ${ordinals.length} library tracks answer its path. Empty the queue at the player first.`,
	);
};

const readQueue = async (install: Install) =>
	(await component<{ entries: QueuedEntry[] }>("/api/queue")).entries.map(
		(entry) => requeue(entry, install),
	);

// What `reset()` puts back, read by the worker fixture before any spec reaches the player.
let recordedQueue: QueueRequest[] | null = null;

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
			const install = await readInstall();
			await sweepProbes();
			const before = await readPlaylists();
			recordedQueue = await readQueue(install);
			await use(install);
			const drift = describeDrift(
				{ playlists: before, tracks: install.tracks },
				{ playlists: await readPlaylists(), tracks: await readTracks() },
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

export const refuseUnmuted = async () => {
	if (!(await player()).muted)
		throw new Error("Mute the player first: these specs play real audio.");
};

// Restores the player to stopped and the queue to what it held when the run began. Every spec that
// starts something owns putting it back, because the next one reads the same single player.
export const reset = async () => {
	if (!recordedQueue)
		throw new Error("reset() ran before the install fixture read the queue");
	await send("/api/playback/stop");
	await component<void>("/api/queue", { method: "DELETE" });
	for (const request of recordedQueue) await send("/api/queue", request);
};
