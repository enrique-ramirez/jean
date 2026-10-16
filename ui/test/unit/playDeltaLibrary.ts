import { mock, type TestContext } from "node:test";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	loadComponentLibrary,
	recheckComponentLibrary,
} from "../../src/domain/track/libraryLoader.ts";
import {
	type LibrarySnapshot,
	librarySnapshotOf,
} from "../../src/domain/track/librarySnapshot.ts";
import {
	type PlaylistSnapshot,
	playlistSnapshot,
} from "../../src/domain/track/playlistEntries.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import {
	type Column,
	changedColumn,
	type Dictionary,
	dictionary,
	encodeJlib,
	wholeColumn,
} from "../fake-api/jlib.ts";

export const NOW = Date.UTC(2026, 5, 15, 12);

const DAY_MS = 24 * 60 * 60 * 1000;

export const PLAY_FIELDS = [
	FIELD.playCount,
	FIELD.lastPlayed,
	FIELD.playCountLocal,
	FIELD.lastPlayedLocal,
] as const;

export type Random = () => number;

export const seeded = (seed: number): Random => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
};

const below = (random: Random, count: number) => Math.floor(random() * count);

const pick = <T>(random: Random, from: readonly T[]): T =>
	from[below(random, from.length)];

const pad = (part: number) => String(part).padStart(2, "0");

// 'YYYY-MM-DD HH:MM:SS' in local time, as the playback-statistics components write it.
export const stamp = (at: number) => {
	const when = new Date(at);
	return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
};

const daysAgo = (random: Random, most: number) =>
	stamp(NOW - Math.floor(random() * most * DAY_MS));

export interface Change {
	ordinal: number;
	field: number;
	value: string;
}

interface Revision {
	revision: number;
	changed: Map<number, Set<number>>;
	sizes: Map<string, number>;
}

export interface PlayLibrary {
	readonly rows: string[][];
	readonly paths: readonly string[];
	readonly subsongs: readonly number[];
	readonly structure: number;
	readonly revision: number;
	exported: () => ArrayBuffer;
	rebuilt: () => ArrayBuffer;
	change: (changes: readonly Change[]) => void;
	changesSince: (since: number) => ArrayBuffer;
}

const bufferOf = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

const ARTISTS = [
	"Babasónicos",
	"Brand New",
	"Alice in Chains",
	"As Tall as Lions",
	"Have a Nice Life",
	"Fictional Band",
	"Imaginary Quartet",
	"The Placeholders",
];

const GENRES = ["Rock", "Jazz", "Rock, Pop", "Shoegaze", "?"];

function trackRow(random: Random, tags: Partial<Record<number, string>>) {
	const row: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
	for (const [field, value] of Object.entries(tags))
		if (value !== undefined) row[Number(field)] = value;

	row[FIELD.duration] = String(120 + below(random, 300));
	row[FIELD.codec] = pick(random, ["FLAC", "MP3"]);
	row[FIELD.bitrate] = row[FIELD.codec] === "FLAC" ? "900" : "320";
	row[FIELD.added] = daysAgo(random, 900);

	row[FIELD.playCount] = pick(random, [
		"0",
		"N/A",
		"?",
		String(1 + below(random, 40)),
		String(1 + below(random, 200)),
	]);
	row[FIELD.lastPlayed] =
		row[FIELD.playCount] === "0" || row[FIELD.playCount] === "N/A"
			? "N/A"
			: daysAgo(random, 700);
	row[FIELD.playCountLocal] = pick(random, [
		"?",
		"0",
		String(below(random, 30)),
	]);
	row[FIELD.lastPlayedLocal] = pick(random, ["?", daysAgo(random, 400)]);
	return row;
}

export function playLibrary(random: Random): PlayLibrary {
	const rows: string[][] = [];
	const paths: string[] = [];
	const subsongs: number[] = [];

	const albums = 30 + below(random, 15);
	for (let album = 0; album < albums; album += 1) {
		const isCompilation = album % 9 === 4;
		const albumArtist = isCompilation
			? "Various Artists"
			: pick(random, ARTISTS);
		const name = `Record ${album}`;
		const year = String(1980 + below(random, 45));
		const genre = pick(random, GENRES);
		const discs = album % 7 === 3 ? 2 : 1;
		const isCue = album % 11 === 5;

		for (let disc = 1; disc <= discs; disc += 1) {
			const tracks = 1 + below(random, 9);
			for (let track = 1; track <= tracks; track += 1) {
				const title = `Song ${album}-${disc}-${track}`;
				const artist = isCompilation ? pick(random, ARTISTS) : albumArtist;
				rows.push(
					trackRow(random, {
						[FIELD.trackNumber]: pad(track),
						[FIELD.discNumber]: discs > 1 ? String(disc) : "?",
						[FIELD.title]: title,
						[FIELD.artist]: artist,
						[FIELD.album]: name,
						[FIELD.albumArtist]: album % 3 === 0 ? "?" : albumArtist,
						[FIELD.year]: year,
						[FIELD.genre]: genre,
					}),
				);
				paths.push(
					isCue
						? `${albumArtist}/${name}/${name}.flac`
						: `${albumArtist}/${name}/${disc}-${pad(track)} ${title}.flac`,
				);
				subsongs.push(isCue ? track : 0);
			}
		}
	}

	for (let single = 0; single < 4; single += 1) {
		const artist = pick(random, ARTISTS);
		const title = `Loose ${single}`;
		rows.push(
			trackRow(random, {
				[FIELD.title]: title,
				[FIELD.artist]: artist,
				[FIELD.genre]: pick(random, GENRES),
			}),
		);
		paths.push(`${artist}/Singles/${title}.mp3`);
		subsongs.push(0);
	}

	return heldLibrary(rows, paths, subsongs);
}

const cut = (path: string) => path.lastIndexOf("/") + 1;

function heldLibrary(
	rows: string[][],
	paths: string[],
	subsongs: number[],
): PlayLibrary {
	const structure = 7;
	let revision = 40;
	const dictionaries = new Map<string, Dictionary>();
	const dictionaryFor = (name: string, from = dictionaries) => {
		let held = from.get(name);
		if (!held) {
			held = dictionary();
			from.set(name, held);
		}
		return held;
	};

	const exportWith = (from: Map<string, Dictionary>) => {
		const bone = (name: string, values: string[]) =>
			wholeColumn(null, dictionaryFor(name, from), values);
		return bufferOf(
			encodeJlib({
				kind: "snapshot",
				structure,
				revision,
				trackCount: rows.length,
				columns: TRACK_EXPRESSIONS.map(
					(expression, field): Column =>
						wholeColumn(
							expression,
							dictionaryFor(expression, from),
							rows.map((row) => row[field]),
						),
				),
				spine: {
					directory: bone(
						"directory",
						paths.map((path) => path.slice(0, cut(path))),
					),
					filename: bone(
						"filename",
						paths.map((path) => path.slice(cut(path))),
					),
					subsong: bone("subsong", subsongs.map(String)),
				},
			}),
		);
	};

	const sizes = () =>
		new Map(
			[...dictionaries].map(([name, dict]) => [name, dict.values.length]),
		);

	const exported = exportWith(dictionaries);
	const history: Revision[] = [
		{ revision, changed: new Map(), sizes: sizes() },
	];

	return {
		rows,
		paths,
		subsongs,
		structure,
		get revision() {
			return revision;
		},
		exported: () => exported,
		rebuilt: () => exportWith(new Map()),
		change: (changes) => {
			const changed = new Map<number, Set<number>>();
			for (const { ordinal, field, value } of changes) {
				rows[ordinal][field] = value;
				dictionaryFor(TRACK_EXPRESSIONS[field]).id(value);
				const ordinals = changed.get(field) ?? new Set<number>();
				ordinals.add(ordinal);
				changed.set(field, ordinals);
			}
			revision += 1;
			history.push({ revision, changed, sizes: sizes() });
		},
		changesSince: (since) => {
			const at = history.findIndex((entry) => entry.revision === since);
			if (at < 0) throw new Error(`no revision ${since} is held`);

			const moved = new Map<number, Set<number>>();
			for (const entry of history.slice(at + 1))
				for (const [field, ordinals] of entry.changed) {
					const held = moved.get(field) ?? new Set<number>();
					for (const ordinal of ordinals) held.add(ordinal);
					moved.set(field, held);
				}

			return bufferOf(
				encodeJlib({
					kind: "delta",
					structure,
					revision,
					since,
					trackCount: rows.length,
					columns: [...moved].map(([field, ordinals]) => {
						const name = TRACK_EXPRESSIONS[field];
						return changedColumn(
							name,
							dictionaryFor(name),
							history[at].sizes.get(name) ?? 0,
							[...ordinals]
								.sort((a, b) => a - b)
								.map((ordinal) => ({ ordinal, value: rows[ordinal][field] })),
						);
					}),
					spine: {},
				}),
			);
		},
	};
}

export const decodedSnapshot = (bytes: ArrayBuffer): LibrarySnapshot => {
	const library = decodeJlib(bytes);
	if (library.kind !== "snapshot") throw new Error("not a snapshot");
	return librarySnapshotOf(library, TRACK_EXPRESSIONS);
};

const playsOf = (raw: string) => {
	const plays = Number(raw);
	return Number.isFinite(plays) ? plays : 0;
};

const mostPlayed = (library: PlayLibrary) =>
	library.rows.reduce(
		(most, row, ordinal) =>
			playsOf(row[FIELD.playCount]) >
			playsOf(library.rows[most][FIELD.playCount])
				? ordinal
				: most,
		0,
	);

function playValue(random: Random, field: number, now: string): string {
	switch (field) {
		case FIELD.playCount:
			return pick(random, [
				String(playsOf(now) + 1),
				"0",
				"N/A",
				"?",
				String(300 + below(random, 300)),
			]);
		case FIELD.playCountLocal:
			return pick(random, [String(playsOf(now) + 1), "0", "?"]);
		default:
			return pick(random, [
				daysAgo(random, 40),
				daysAgo(random, 3000),
				"N/A",
				"?",
			]);
	}
}

export function randomPlayDelta(
	random: Random,
	library: PlayLibrary,
): Change[] {
	const changes: Change[] = [];
	const rows = 1 + below(random, 4);
	for (let at = 0; at < rows; at += 1) {
		const ordinal =
			random() < 0.2 ? mostPlayed(library) : below(random, library.rows.length);
		const fields = PLAY_FIELDS.filter(() => random() < 0.5);
		for (const field of fields.length > 0
			? fields
			: [pick(random, PLAY_FIELDS)])
			changes.push({
				ordinal,
				field,
				value: playValue(random, field, library.rows[ordinal][field]),
			});
	}
	return changes;
}

let origins = 0;

const flush = () => new Promise((resolve) => setImmediate(resolve));

export interface LoadedLibrary {
	origin: string;
	key: string;
	snapshot: () => PlaylistSnapshot;
	apply: (changes: readonly Change[]) => Promise<void>;
}

export async function loadedLibrary(
	t: TestContext,
	library: PlayLibrary,
): Promise<LoadedLibrary> {
	origins += 1;
	const origin = `http://play-delta-${origins}.invalid:8881`;

	const realFetch = globalThis.fetch;
	mock.timers.enable({ apis: ["Date"], now: NOW });
	t.after(() => {
		mock.timers.reset();
		globalThis.fetch = realFetch;
	});

	globalThis.fetch = ((request: Request) => {
		const url = new URL(request.url);
		if (url.pathname === "/api/library/export")
			return Promise.resolve(new Response(library.exported()));
		if (url.pathname === "/api/library/changes")
			return Promise.resolve(
				new Response(
					library.changesSince(Number(url.searchParams.get("since"))),
				),
			);
		return Promise.reject(new Error(`unexpected request: ${url.pathname}`));
	}) as typeof fetch;

	const key = loadComponentLibrary(origin);
	while (playlistSnapshot(key).isLoading) await flush();
	if (playlistSnapshot(key).columns.trackCount !== library.rows.length)
		throw new Error("the library did not load");

	return {
		origin,
		key,
		snapshot: () => playlistSnapshot(key),
		apply: async (changes) => {
			library.change(changes);
			await recheckComponentLibrary(origin, {
				structure: library.structure,
				revision: library.revision,
			});
		},
	};
}
