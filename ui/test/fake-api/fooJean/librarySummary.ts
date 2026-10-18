import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { compareUtf8, shuffledTail } from "../jlib.ts";

type LibrarySummary = components["schemas"]["LibrarySummary"];
type SummaryAlbum = components["schemas"]["SummaryAlbum"];
type SummaryShelf = components["schemas"]["SummaryShelf"];

export const SUMMARY_ROLES = [
	"trackNumber",
	"discNumber",
	"title",
	"artist",
	"album",
	"albumArtist",
	"duration",
	"playCount",
	"lastPlayed",
	"rating",
	"year",
	"genre",
	"codec",
	"bitrate",
	"playCountLocal",
	"lastPlayedLocal",
	"added",
] as const;

export type SummaryRole = (typeof SUMMARY_ROLES)[number];

export const LIBRARY_ROLE_NAMES = [
	...SUMMARY_ROLES,
	"artists",
	"artistIds",
	"albumArtists",
	"albumArtistIds",
	"artistSort",
] as const;

export type LibraryRoleName = (typeof LIBRARY_ROLE_NAMES)[number];

export interface LocalTime {
	epochMsOf(
		year: number,
		month: number,
		day: number,
		hour: number,
		minute: number,
		second: number,
	): number;
	yyyymmddOf(epochMs: number): number;
}

const MINUTE_MS = 60_000;

export const fixedOffset = (minutes: number): LocalTime => ({
	epochMsOf: (year, month, day, hour, minute, second) =>
		Date.UTC(year, month - 1, day, hour, minute, second) - minutes * MINUTE_MS,
	yyyymmddOf: (epochMs) => {
		const local = new Date(epochMs + minutes * MINUTE_MS);
		return (
			local.getUTCFullYear() * 10_000 +
			(local.getUTCMonth() + 1) * 100 +
			local.getUTCDate()
		);
	},
});

export interface SummaryInput {
	structure: number;
	revision: number;
	directory: string[];
	filename: string[];
	columns: Partial<Record<SummaryRole, string[]>>;
}

const LIMIT = 24;
const MINIMUM = 4;
const RANKING_POOL = 8;
const MIN_RANKED_TRACKS = 4;
const TOP_TRACKS = 10;
const TOP_GENRES = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const RECENT_WINDOW_MS = 30 * DAY_MS;
const ADDED_WINDOW_MS = 28 * DAY_MS;
const FIRST_RUN_GAP_MS = 60 * 1000;
const FIRST_RUN_SHARE = 0.25;
const FORGOTTEN_AFTER_MS = 1.5 * YEAR_MS;
const FIRST_YEAR = 1000;
const MAX_STARS = 5;
const POPM_FLOORS = [224, 160, 96, 32, 1];
const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "APE", "WAVPACK", "TAK"]);
export const VALUE_SEPARATOR = "\u001f";
const UNPLAYED = "0";
const ABSENT = new Set(["?", "", "N/A"]);

export const readValue = (raw: string | undefined): string | null =>
	raw === undefined || ABSENT.has(raw) ? null : raw;

const readNumber = (raw: string | undefined): number | null => {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
};

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) *$/;

const readTimestamp = (
	raw: string | undefined,
	local: LocalTime,
): number | null => {
	const text = readValue(raw);
	const parts = text === null ? null : TIMESTAMP.exec(text);
	if (!parts) return null;
	const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
	// Date.UTC rolls an impossible date over to a possible one; a tag that says 13-45 is no date.
	const checked = new Date(
		Date.UTC(year, month - 1, day, hour, minute, second),
	);
	if (
		year < 100 ||
		checked.getUTCFullYear() !== year ||
		checked.getUTCMonth() !== month - 1 ||
		checked.getUTCDate() !== day ||
		checked.getUTCHours() !== hour ||
		checked.getUTCMinutes() !== minute ||
		checked.getUTCSeconds() !== second
	)
		return null;
	return local.epochMsOf(year, month, day, hour, minute, second);
};

export const tagKey = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const starsOf = (raw: number | null): number | null => {
	if (raw === null || raw <= 0) return null;
	if (raw <= MAX_STARS) return raw;
	if (raw <= 10) return raw / 2;
	if (raw <= 100) return (raw / 100) * MAX_STARS;
	if (raw <= 255)
		return MAX_STARS - POPM_FLOORS.findIndex((floor) => raw >= floor);
	return null;
};

const leadingPositiveInteger = (raw: string | undefined): number | null => {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const tagGrouper = () => {
	const byKey = new Map<string, number>();
	const names: string[] = [];
	const add = (raw: string) => {
		const key = tagKey(raw);
		let group = byKey.get(key);
		if (group === undefined) {
			group = names.length;
			names.push(raw);
			byKey.set(key, group);
		}
		return group;
	};
	const addBytewise = (values: readonly string[]) => {
		const groups = new Map<string, number>();
		const distinct = [
			...new Set(values.filter((raw) => readValue(raw) !== null)),
		].sort(compareUtf8);
		for (const raw of distinct) groups.set(raw, add(raw));
		return groups;
	};
	return {
		names,
		add,
		addBytewise,
		group: (key: string) => byKey.get(key) ?? -1,
	};
};

type Columns = SummaryInput["columns"];

const cell = (columns: Columns, role: SummaryRole, at: number) =>
	columns[role]?.[at];

const larger = (a: number | null, b: number | null) =>
	a === null ? b : b === null ? a : Math.max(a, b);

const unlessUnplayed = <T>(
	raw: string | undefined,
	parse: (raw: string | undefined) => T | null,
) => (raw === UNPLAYED ? null : parse(raw));

const playsOf = (columns: Columns, at: number) =>
	larger(
		unlessUnplayed(cell(columns, "playCount", at), readNumber),
		unlessUnplayed(cell(columns, "playCountLocal", at), readNumber),
	);

const lastPlayedOf = (columns: Columns, at: number, local: LocalTime) => {
	const parse = (raw: string | undefined) => readTimestamp(raw, local);
	return larger(
		unlessUnplayed(cell(columns, "lastPlayed", at), parse),
		unlessUnplayed(cell(columns, "lastPlayedLocal", at), parse),
	);
};

interface Draft {
	album: string;
	artist: string | null;
	ordinals: number[];
	plays: number;
	lastPlayed: number;
	added: number;
	bitrateTotal: number;
	bitrateCount: number;
	lossless: boolean;
	stars: number[];
}

interface Album extends Draft {
	trackCount: number;
	playsPerTrack: number;
	bitrate: number | null;
	ratedCount: number;
	rating: number | null;
	cover: string;
}

const percentile = (values: number[], fraction: number): number => {
	if (values.length === 0) return 0;
	const sorted = Float64Array.from(values).sort();
	const at = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round((sorted.length - 1) * fraction)),
	);
	return sorted[at];
};

// foo_playcount's first run stamps every track already in the library with that moment, one after
// another, so the largest unbroken run of arrivals is when it was installed if the run is a good
// share of the library.
function firstRunOf(arrivals: number[]): { from: number; to: number } | null {
	const sorted = Float64Array.from(arrivals).sort();
	let run = { from: 0, to: 0, count: 0 };
	let start = 0;
	for (let at = 1; at <= sorted.length; at += 1) {
		if (at < sorted.length && sorted[at] - sorted[at - 1] <= FIRST_RUN_GAP_MS)
			continue;
		if (at - start > run.count)
			run = { from: sorted[start], to: sorted[at - 1], count: at - start };
		start = at;
	}
	return run.count > 0 && run.count >= sorted.length * FIRST_RUN_SHARE
		? run
		: null;
}

const byPlays = (a: Album, b: Album) => b.plays - a.plays;

const hasEnoughToRank = (pool: Album[]) => pool.length >= RANKING_POOL;

const busiest = (pool: Album[]) =>
	percentile(
		pool.map((album) => album.playsPerTrack),
		0.75,
	);

interface ShelfRule {
	id: SummaryShelf["id"];
	minimum: number;
	pick: (albums: Album[], now: number) => Album[];
}

const SHELVES: ShelfRule[] = [
	{
		id: "added",
		minimum: 1,
		pick: (albums, now) => {
			const since = now - ADDED_WINDOW_MS;
			const firstRun = firstRunOf(
				albums.filter((album) => album.added > 0).map((album) => album.added),
			);
			return albums
				.filter((album) => album.added > since)
				.filter(
					(album) =>
						!firstRun ||
						album.added < firstRun.from ||
						album.added > firstRun.to,
				)
				.sort((a, b) => b.added - a.added);
		},
	},
	{
		id: "recent",
		minimum: MINIMUM,
		pick: (albums, now) =>
			albums
				.filter((album) => album.lastPlayed > now - RECENT_WINDOW_MS)
				.sort((a, b) => b.lastPlayed - a.lastPlayed),
	},
	{
		id: "top",
		minimum: MINIMUM,
		pick: (albums) => albums.filter((album) => album.plays > 0).sort(byPlays),
	},
	{
		id: "rated",
		minimum: MINIMUM,
		pick: (albums) => {
			const rated = albums.filter((album) => album.ratedCount >= 2);
			if (!hasEnoughToRank(rated)) return [];
			const good = percentile(
				rated.map((album) => album.rating as number),
				0.5,
			);
			return rated
				.filter((album) => (album.rating as number) >= good)
				.sort(
					(a, b) =>
						(b.rating as number) - (a.rating as number) ||
						b.ratedCount - a.ratedCount,
				);
		},
	},
	{
		id: "loved",
		minimum: MINIMUM,
		pick: (albums, now) => {
			const played = albums.filter(
				(album) =>
					album.plays > 0 &&
					album.lastPlayed > 0 &&
					album.trackCount >= MIN_RANKED_TRACKS,
			);
			if (!hasEnoughToRank(played)) return [];
			const busy = busiest(played);
			const silent = now - FORGOTTEN_AFTER_MS;
			return played
				.filter(
					(album) => album.playsPerTrack >= busy && album.lastPlayed <= silent,
				)
				.sort(byPlays);
		},
	},
	{
		id: "upgrade",
		minimum: MINIMUM,
		pick: (albums) => {
			const lossy = albums.filter(
				(album) =>
					!album.lossless &&
					Boolean(album.bitrate) &&
					album.plays > 0 &&
					album.trackCount >= MIN_RANKED_TRACKS,
			);
			if (!hasEnoughToRank(lossy)) return [];
			const busy = busiest(lossy);
			const poor = percentile(
				lossy.map((album) => album.bitrate as number),
				0.25,
			);
			return lossy
				.filter(
					(album) =>
						album.playsPerTrack >= busy && (album.bitrate as number) <= poor,
				)
				.sort(byPlays);
		},
	},
	{
		id: "unopened",
		minimum: MINIMUM,
		pick: (albums) =>
			albums.some((album) => album.plays > 0)
				? albums
						.filter((album) => album.plays === 0)
						.sort((a, b) => b.trackCount - a.trackCount)
				: [],
	},
];

const documentOf = ({
	album,
	artist,
	cover,
	ordinals,
	trackCount,
	plays,
	lastPlayed,
	added,
	rating,
	ratedCount,
	bitrate,
}: Album): SummaryAlbum => ({
	album,
	artist,
	cover,
	ordinals,
	trackCount,
	plays,
	lastPlayed,
	added,
	rating,
	ratedCount,
	bitrate,
});

const emptyDraft = (album: string, artist: string | null): Draft => ({
	album,
	artist,
	ordinals: [],
	plays: 0,
	lastPlayed: 0,
	added: 0,
	bitrateTotal: 0,
	bitrateCount: 0,
	lossless: true,
	stars: [],
});

function addTrack(
	draft: Draft,
	columns: Columns,
	at: number,
	local: LocalTime,
) {
	draft.ordinals.push(at);
	draft.plays += playsOf(columns, at) ?? 0;

	const played = lastPlayedOf(columns, at, local);
	if (played !== null && played > draft.lastPlayed) draft.lastPlayed = played;

	const arrived = readTimestamp(cell(columns, "added", at), local);
	if (arrived !== null && arrived > draft.added) draft.added = arrived;

	const rate = readNumber(cell(columns, "bitrate", at));
	if (rate) {
		draft.bitrateTotal += rate;
		draft.bitrateCount += 1;
	}

	const codec = readValue(cell(columns, "codec", at));
	if (codec !== null && !LOSSLESS.has(codec.toUpperCase()))
		draft.lossless = false;

	const stars = starsOf(readNumber(cell(columns, "rating", at)));
	if (stars !== null) draft.stars.push(stars);
}

function draftAlbums(columns: Columns, count: number, local: LocalTime) {
	const albumNames = tagGrouper();
	const albumGroupOf = albumNames.addBytewise(columns.album ?? []);
	const artistNames = tagGrouper();
	const byAlbumArtist = artistNames.addBytewise(columns.albumArtist ?? []);
	const byArtist = artistNames.addBytewise(columns.artist ?? []);
	const creditedGroup = (at: number) =>
		byAlbumArtist.get(cell(columns, "albumArtist", at) ?? "") ??
		byArtist.get(cell(columns, "artist", at) ?? "");

	const drafts = new Map<string, Draft>();
	const tracksOfRecord = new Map<string, number[]>();
	const recordOf = new Array<string | null>(count).fill(null);

	for (let at = 0; at < count; at += 1) {
		const albumGroup = albumGroupOf.get(cell(columns, "album", at) ?? "");
		if (albumGroup === undefined) continue;

		const artistGroup = creditedGroup(at);
		const record = `${albumGroup}\u0000${artistGroup ?? -1}`;
		recordOf[at] = record;
		const tracks = tracksOfRecord.get(record);
		if (tracks) tracks.push(at);
		else tracksOfRecord.set(record, [at]);

		const name = albumNames.names[albumGroup];
		const artist =
			artistGroup === undefined ? null : artistNames.names[artistGroup];
		const mergeKey = `${tagKey(name)}\u0000${tagKey(artist)}`;
		let draft = drafts.get(mergeKey);
		if (!draft) {
			draft = emptyDraft(name, artist);
			drafts.set(mergeKey, draft);
		}
		addTrack(draft, columns, at, local);
	}

	return { drafts: [...drafts.values()], tracksOfRecord, recordOf };
}

const discAndTrackOf = (columns: Columns, at: number) => [
	leadingPositiveInteger(cell(columns, "discNumber", at)) ?? 0,
	leadingPositiveInteger(cell(columns, "trackNumber", at)) ?? 0,
];

const firstTrackOf = (columns: Columns, tracks: number[]) =>
	tracks.reduce((best, at) => {
		const [bestDisc, bestTrack] = discAndTrackOf(columns, best);
		const [disc, track] = discAndTrackOf(columns, at);
		return disc < bestDisc || (disc === bestDisc && track < bestTrack)
			? at
			: best;
	}, tracks[0]);

const finishedAlbum = (draft: Draft, cover: string): Album => ({
	...draft,
	trackCount: draft.ordinals.length,
	playsPerTrack: draft.plays / draft.ordinals.length,
	bitrate:
		draft.bitrateCount > 0 ? draft.bitrateTotal / draft.bitrateCount : null,
	ratedCount: draft.stars.length,
	rating:
		draft.stars.length > 0
			? draft.stars.reduce((total, one) => total + one, 0) / draft.stars.length
			: null,
	cover,
});

function shelvesOf(albums: Album[], now: number, local: LocalTime) {
	if (albums.length === 0) return [];
	const shelves: SummaryShelf[] = [];
	for (const { id, minimum, pick } of SHELVES) {
		const picked = pick(albums, now);
		if (picked.length >= minimum)
			shelves.push({ id, albums: picked.slice(0, LIMIT).map(documentOf) });
	}
	if (shelves.length === 0 && albums.length >= MINIMUM)
		shelves.push({
			id: "starter",
			albums: shuffledTail(albums, BigInt(local.yyyymmddOf(now)), LIMIT).map(
				documentOf,
			),
		});
	return shelves;
}

interface ArtistEntry {
	name: string | null;
	plays: number;
	albumCount: number;
	trackCount: number;
	cover: Album;
}

function artistsOf(albums: Album[]): ArtistEntry[] {
	const byKey = new Map<string, ArtistEntry>();
	for (const album of albums) {
		const key = tagKey(album.artist);
		const entry = byKey.get(key) ?? {
			name: album.artist,
			plays: 0,
			albumCount: 0,
			trackCount: 0,
			cover: album,
		};
		entry.plays += album.plays;
		entry.albumCount += 1;
		entry.trackCount += album.trackCount;
		if (album.plays > entry.cover.plays) entry.cover = album;
		byKey.set(key, entry);
	}
	return [...byKey.values()];
}

const mostPlayed = <T extends { plays: number }>(entries: T[]) =>
	entries.reduce<T | null>(
		(best, entry) =>
			entry.plays > 0 && (best === null || entry.plays > best.plays)
				? entry
				: best,
		null,
	);

function totalsOf(columns: Columns, count: number) {
	let seconds = 0;
	let earliest: number | null = null;
	let latest: number | null = null;
	for (let at = 0; at < count; at += 1) {
		seconds += readNumber(cell(columns, "duration", at)) ?? 0;
		const released = readNumber(cell(columns, "year", at));
		if (released !== null && released > FIRST_YEAR) {
			earliest = earliest === null ? released : Math.min(earliest, released);
			latest = latest === null ? released : Math.max(latest, released);
		}
	}
	return { seconds, earliest, latest };
}

function genreTalliesOf(columns: Columns, count: number) {
	const genres = tagGrouper();
	const groupsOf = new Map<string, number[]>();
	const distinct = [
		...new Set((columns.genre ?? []).filter((one) => readValue(one) !== null)),
	].sort(compareUtf8);
	for (const raw of distinct)
		groupsOf.set(raw, [
			...new Set(
				raw
					.split(VALUE_SEPARATOR)
					.filter((genre) => tagKey(genre) !== "")
					.map(genres.add),
			),
		]);

	const counts = new Array<number>(genres.names.length).fill(0);
	for (let at = 0; at < count; at += 1)
		for (const group of groupsOf.get(cell(columns, "genre", at) ?? "") ?? [])
			counts[group] += 1;

	return genres.names
		.map((name, group) => ({ name, count: counts[group] }))
		.filter((entry) => entry.count > 0)
		.sort((a, b) => b.count - a.count);
}

export function summarise(
	input: SummaryInput,
	now: number,
	local: LocalTime,
): LibrarySummary {
	const { directory, filename, columns } = input;
	const trackCount = directory.length;

	const { drafts, tracksOfRecord, recordOf } = draftAlbums(
		columns,
		trackCount,
		local,
	);
	const coverOf = (at: number) => {
		const record = recordOf[at];
		const tracks = record === null ? undefined : tracksOfRecord.get(record);
		const cover = tracks ? firstTrackOf(columns, tracks) : at;
		return `${directory[cover]}${filename[cover]}`;
	};
	const albums = drafts.map((draft) =>
		finishedAlbum(draft, coverOf(draft.ordinals[0])),
	);

	const artists = artistsOf(albums);
	const topArtist = mostPlayed(artists);
	const topAlbum = mostPlayed(albums);
	const { seconds, earliest, latest } = totalsOf(columns, trackCount);
	const genres = genreTalliesOf(columns, trackCount);

	const topTracks = Array.from({ length: trackCount }, (_, at) => ({
		at,
		plays: playsOf(columns, at) ?? 0,
	}))
		.filter(({ plays }) => plays > 0)
		.sort((a, b) => b.plays - a.plays)
		.slice(0, TOP_TRACKS)
		.map(({ at, plays }) => ({
			ordinal: at,
			title: readValue(cell(columns, "title", at)),
			artist:
				readValue(cell(columns, "artist", at)) ??
				readValue(cell(columns, "albumArtist", at)),
			plays,
			cover: coverOf(at),
		}));

	return {
		structure: input.structure,
		revision: input.revision,
		trackCount,
		seconds,
		earliestYear: earliest,
		latestYear: latest,
		albumCount: albums.length,
		artistCount: artists.length,
		genreCount: genres.length,
		topGenres: genres.slice(0, TOP_GENRES).map(({ name, count }) => ({
			name,
			count,
			share: Math.round((count / trackCount) * 100),
		})),
		topAlbum: topAlbum && documentOf(topAlbum),
		topArtist: topArtist && {
			name: topArtist.name,
			plays: topArtist.plays,
			albumCount: topArtist.albumCount,
			trackCount: topArtist.trackCount,
			cover: documentOf(topArtist.cover),
		},
		topTracks,
		shelves: shelvesOf(albums, now, local),
	};
}
