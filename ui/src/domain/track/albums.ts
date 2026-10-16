import { finished, SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { overColumnsByName } from "./columnCache";
import {
	artistGroups,
	coverKey,
	FIELD,
	lastPlayedIn,
	playCountsIn,
	readNumber,
	readTimestamp,
	readValue,
	tagGroups,
	tagKey,
	withBothSources,
} from "./fields";
import { growingIndex } from "./growingIndex";
import { INTENSITY_FIELDS, rowPlays } from "./intensity";
import { byValueSteps, type LibraryColumns, rowsMoved } from "./libraryColumns";
import type { TrackRows } from "./project";
import { starsOf } from "./rating";

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "APE", "WAVPACK", "TAK"]);

// The raw tag, never a display fallback: `coverIdentity` folds a missing artist to nothing, so
// standing in `Unknown artist` here would give the same record two identities.
const keyOf = (artist: string | null | undefined, album: string) =>
	coverKey(artist, album);

const blankAlbum = (
	key: string,
	album: string,
	artist: string | null,
	match: FuzzyKey,
) => ({
	key,
	album,
	match,
	// The tag as it stands, not a display fallback: what to call an untagged record is a phrase,
	// chosen where it renders.
	artistTag: artist,
	refs: [] as number[],
	plays: 0,
	lastPlayed: 0,
	added: 0,
	bitrateTotal: 0,
	bitrateCount: 0,
	year: null as number | null,
	lossless: true,
	ratings: [] as number[],
});

type AlbumDraft = ReturnType<typeof blankAlbum>;

const summed = (album: AlbumDraft) => ({
	...album,
	refs: Int32Array.from(album.refs),
	trackCount: album.refs.length,
	playsPerTrack: album.refs.length > 0 ? album.plays / album.refs.length : 0,
	bitrate:
		album.bitrateCount > 0 ? album.bitrateTotal / album.bitrateCount : null,
	ratedCount: album.ratings.length,
	rating:
		album.ratings.length > 0
			? album.ratings.reduce((total, one) => total + one, 0) /
				album.ratings.length
			: null,
});

export type Album = ReturnType<typeof summed>;

export interface CoveredAlbum extends Album {
	artworkUrl: string | null;
}

function* collect(
	byKey: Map<string, AlbumDraft>,
	rows: TrackRows,
	from: number,
): Steps<void> {
	const { columns } = rows;
	const album = columns.fields[FIELD.album];
	const albums = yield* tagGroups.steps(album);
	const artists = yield* artistGroups.steps(columns);

	const plays = yield* playCountsIn.steps(columns);
	const playedAt = yield* lastPlayedIn.steps(columns);
	const addedAt = yield* byValueSteps(
		columns.fields[FIELD.added],
		readTimestamp,
	);
	const years = yield* byValueSteps(columns.fields[FIELD.year], readNumber);
	const bitrates = yield* byValueSteps(
		columns.fields[FIELD.bitrate],
		readNumber,
	);
	const lossy = yield* byValueSteps(columns.fields[FIELD.codec], (raw) => {
		const codec = readValue(raw);
		return codec !== null && !LOSSLESS.has(codec.toUpperCase());
	});
	const ratings = yield* byValueSteps(columns.fields[FIELD.rating], (raw) =>
		starsOf(readNumber(raw)),
	);

	const year = columns.fields[FIELD.year].ids;
	const bitrate = columns.fields[FIELD.bitrate].ids;
	const codec = columns.fields[FIELD.codec].ids;
	const rating = columns.fields[FIELD.rating].ids;
	const added = columns.fields[FIELD.added].ids;

	const drafts = new Map<number, AlbumDraft>();

	for (let position = from; position < rows.length; position += 1) {
		if ((position & SLICE_MASK) === 0) yield;
		const ref = rows.ref(position);
		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup < 0) continue;

		const artistGroup = artists.at(ref);
		let draft = drafts.get(artists.pairedWith(ref, albumGroup));
		if (!draft) {
			const name = albums.names[albumGroup];
			const artist = artistGroup < 0 ? null : artists.names[artistGroup];
			const key = keyOf(artist, name);
			draft = byKey.get(key) ?? blankAlbum(key, name, artist, fuzzyKey(name));
			summaries.delete(draft);
			byKey.set(key, draft);
			drafts.set(artists.pairedWith(ref, albumGroup), draft);
		}

		draft.refs.push(position);
		draft.plays += plays(ref) ?? 0;

		const played = playedAt(ref);
		if (played !== null && played > draft.lastPlayed) draft.lastPlayed = played;

		const arrived = addedAt[added[ref]];
		if (arrived !== null && arrived > draft.added) draft.added = arrived;

		// The earliest of them: a reissue often tags its own release year onto one or two tracks.
		const released = years[year[ref]];
		if (
			released !== null &&
			released > 1000 &&
			(draft.year === null || released < draft.year)
		)
			draft.year = released;

		const rate = bitrates[bitrate[ref]];
		if (rate) {
			draft.bitrateTotal += rate;
			draft.bitrateCount += 1;
		}

		if (lossy[codec[ref]]) draft.lossless = false;

		const stars = ratings[rating[ref]];
		if (stars !== null) draft.ratings.push(stars);
	}
}

const summaries = new WeakMap<AlbumDraft, Album>();

const summaryOf = (draft: AlbumDraft) => {
	let summary = summaries.get(draft);
	if (!summary) {
		summary = summed(draft);
		summaries.set(draft, summary);
	}
	return summary;
};

const derive = (byKey: Map<string, AlbumDraft>): Album[] =>
	[...byKey.values()].map(summaryOf);

export function albumsOf(rows: TrackRows): Album[] {
	const byKey = new Map<string, AlbumDraft>();
	finished(collect(byKey, rows, 0));
	return derive(byKey);
}

const COLLECTED = withBothSources([
	FIELD.album,
	FIELD.albumArtist,
	FIELD.artist,
	FIELD.playCount,
	FIELD.lastPlayed,
	FIELD.year,
	FIELD.bitrate,
	FIELD.codec,
	FIELD.rating,
	FIELD.added,
]);

function replay(
	byKey: Map<string, AlbumDraft>,
	before: LibraryColumns,
	after: LibraryColumns,
) {
	const moved = rowsMoved(INTENSITY_FIELDS, before, after);
	if (moved.length === 0) return;

	const album = after.fields[FIELD.album];
	const albums = tagGroups(album);
	const artists = artistGroups(after);
	const touched = new Set<AlbumDraft>();

	for (const ref of moved) {
		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup < 0) continue;

		const artistGroup = artists.at(ref);
		const artist = artistGroup < 0 ? null : artists.names[artistGroup];
		const draft = byKey.get(keyOf(artist, albums.names[albumGroup]));
		if (draft) touched.add(draft);
	}

	for (const draft of touched) {
		draft.plays = 0;
		draft.lastPlayed = 0;
		for (const position of draft.refs) {
			const { plays, lastPlayed } = rowPlays(after, position);
			draft.plays += plays;
			if (lastPlayed !== null && lastPlayed > draft.lastPlayed)
				draft.lastPlayed = lastPlayed;
		}
		summaries.delete(draft);
	}
}

export const albumIndex = growingIndex(COLLECTED, collect, derive, {
	patchable: INTENSITY_FIELDS,
	patch: replay,
});

export interface AlbumTracks {
	refs: Int32Array;
	// As the files spell them. The route carries the halves normalised, and a page may not draw those.
	album: string;
	artist: string | null;
}

/**
 * One record's rows. It takes two tags to name one: `Blood, Sweat & Tears` is an album by two
 * different bands, and a title on its own would collect both. Matched through the key `albumsOf`
 * groups by, so a count beside a title and the page behind it can never be different sets.
 */
export const refsOfAlbum = overColumnsByName(
	[FIELD.album, FIELD.albumArtist, FIELD.artist],
	(artist: string | null | undefined, album: string) =>
		JSON.stringify([artist ?? null, album]),
	albumRefs,
);

function albumRefs(
	columns: LibraryColumns,
	artist: string | null | undefined,
	album: string,
): AlbumTracks {
	const nothing = { refs: new Int32Array(0), album, artist: null };
	if (!tagKey(album)) return nothing;

	const column = columns.fields[FIELD.album];
	const albums = tagGroups(column);
	const albumGroup = albums.group(tagKey(album));
	if (albumGroup < 0) return nothing;

	const artists = artistGroups(columns);
	const artistGroup = artists.group(tagKey(artist));

	const refs: number[] = [];
	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		if (albums.of[column.ids[ref]] !== albumGroup) continue;
		if (artists.at(ref) !== artistGroup) continue;
		refs.push(ref);
	}

	if (refs.length === 0) return nothing;

	return {
		refs: Int32Array.from(refs),
		album: albums.names[albumGroup],
		artist: artistGroup < 0 ? null : artists.names[artistGroup],
	};
}

export function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = Float64Array.from(values).sort();
	const at = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round((sorted.length - 1) * fraction)),
	);
	return sorted[at];
}
