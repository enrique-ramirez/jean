import type { Translate } from "@/shared/i18n/locale";
import { artistGroups, FIELD, readValue, tagGroups, tagKey } from "./fields";
import { byValue, type LibraryColumns } from "./libraryColumns";
import type { TrackRows } from "./project";

export interface DiscRun {
	number: number | null;
	start: number;
	count: number;
}

export interface AlbumRun {
	key: string;
	album: string;
	albumArtist: string;
	year: string | null;
	start: number;
	count: number;
	cover: number;
	discs: DiscRun[] | null;
}

type OpenRun = Omit<AlbumRun, "discs"> & {
	discs: DiscRun[];
	albumGroup: number;
	artistGroup: number;
};

// Free text, and rippers disagree: '1', '01' and '1/2' all turn up, the last writing the disc total
// into the same field.
export function discNumber(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Track numbers are free text on the same terms discs are, so the same parser reads them.
const trackOrdinal = discNumber;

const discsWorthDrawing = (discs: DiscRun[]): DiscRun[] | null =>
	discs.length >= 2 && discs.every((disc) => disc.number !== null)
		? discs
		: null;

// Contiguous runs only, never reordering: the player decides what comes next, so reordering here
// would desync the view from playback.
export function groupByAlbum(rows: TrackRows, t: Translate): AlbumRun[] {
	const { columns } = rows;
	const album = columns.fields[FIELD.album];
	const year = columns.fields[FIELD.year];
	const disc = columns.fields[FIELD.discNumber];

	const albums = tagGroups(album);
	const artists = artistGroups(columns);
	const discs = byValue(disc, discNumber);

	const built: OpenRun[] = [];
	const coverOf = new Map<number, number>();

	for (let index = 0; index < rows.length; index += 1) {
		const ref = rows.ref(index);

		const albumGroup = albums.of[album.ids[ref]];
		const artistGroup = artists.at(ref);
		const number = discs[disc.ids[ref]];

		const open = built[built.length - 1];
		if (
			open &&
			open.albumGroup === albumGroup &&
			open.artistGroup === artistGroup
		) {
			open.count += 1;
			const run = open.discs[open.discs.length - 1];
			if (run.number === number) run.count += 1;
			else open.discs.push({ number, start: index, count: 1 });
			continue;
		}

		const name =
			albumGroup < 0 ? t("track.unknownAlbum") : albums.names[albumGroup];
		const credit =
			artistGroup < 0 ? t("track.unknownArtist") : artists.names[artistGroup];

		const record = albumGroup < 0 ? -1 : artists.pairedWith(ref, albumGroup);
		const cover = albumGroup < 0 ? index : (coverOf.get(record) ?? index);
		if (albumGroup >= 0) coverOf.set(record, cover);

		built.push({
			key: `${credit} ${name} ${index}`,
			album: name,
			albumArtist: credit,
			albumGroup,
			artistGroup,
			year: readValue(year.at(ref)),
			start: index,
			count: 1,
			cover,
			discs: [{ number, start: index, count: 1 }],
		});
	}

	return built.map(({ albumGroup, artistGroup, ...group }) => ({
		...group,
		discs: discsWorthDrawing(group.discs),
	}));
}

/**
 * The ref every track of a record shares a cover address through: the whole library's earliest disc,
 * then earliest track, ties broken by ref, which is stable and total whatever a tag omits or repeats.
 * Unlike `groupByAlbum`, this sweeps every row rather than contiguous runs, so it answers the same ref
 * for an album wherever it is reached from. A track with no album tag maps to itself, since it has no
 * record to share a cover with -- `coverIdentity` falls back to the track's own identity for exactly
 * that case, and this leaves it alone.
 */
export function canonicalTrackRefs(columns: LibraryColumns): Int32Array {
	const album = columns.fields[FIELD.album];
	const disc = columns.fields[FIELD.discNumber];
	const track = columns.fields[FIELD.trackNumber];

	const albums = tagGroups(album);
	const artists = artistGroups(columns);
	const discs = byValue(disc, discNumber);
	const tracks = byValue(track, trackOrdinal);

	const recordOf = new Int32Array(columns.trackCount).fill(-1);
	const best = new Map<
		number,
		readonly [disc: number, track: number, ref: number]
	>();

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup < 0) continue;

		const record = artists.pairedWith(ref, albumGroup);
		recordOf[ref] = record;

		const order = [
			discs[disc.ids[ref]] ?? 0,
			tracks[track.ids[ref]] ?? 0,
			ref,
		] as const;
		const held = best.get(record);
		if (
			!held ||
			order[0] < held[0] ||
			(order[0] === held[0] && order[1] < held[1])
		)
			best.set(record, order);
	}

	return Int32Array.from({ length: columns.trackCount }, (_, ref) => {
		const record = recordOf[ref];
		return record < 0 ? ref : (best.get(record)?.[2] ?? ref);
	});
}

export interface AlbumCanonicalIndex {
	// `credited` is the album artist, falling back to the artist: the same fallback `artistGroups`
	// resolves per row, taken here as text since the caller has no ref to resolve it from. Answers
	// null for a record this library does not hold, never a guess at the nearest one.
	refFor: (album: string, credited: string) => number | null;
}

/**
 * The same canonicalisation `canonicalTrackRefs` sweeps, looked up by an album's tag text rather
 * than by one of its own rows: what a per-track poll or a title-formatted read names a record by,
 * never a ref into this library. Built once per snapshot and cached the way the caller already
 * caches `canonicalTrackRefs`, so a lookup after the first costs an object property read.
 */
export function albumCanonicalIndex(
	columns: LibraryColumns,
): AlbumCanonicalIndex {
	const album = columns.fields[FIELD.album];
	const disc = columns.fields[FIELD.discNumber];
	const track = columns.fields[FIELD.trackNumber];

	const albums = tagGroups(album);
	const artists = artistGroups(columns);
	const discs = byValue(disc, discNumber);
	const tracks = byValue(track, trackOrdinal);

	const best = new Map<
		string,
		readonly [disc: number, track: number, ref: number]
	>();

	for (let ref = 0; ref < columns.trackCount; ref += 1) {
		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup < 0) continue;

		const key = `${albumGroup}:${artists.at(ref)}`;
		const order = [
			discs[disc.ids[ref]] ?? 0,
			tracks[track.ids[ref]] ?? 0,
			ref,
		] as const;
		const held = best.get(key);
		if (
			!held ||
			order[0] < held[0] ||
			(order[0] === held[0] && order[1] < held[1])
		)
			best.set(key, order);
	}

	return {
		refFor: (albumText, creditedText) => {
			const albumGroup = albums.group(tagKey(albumText));
			if (albumGroup < 0) return null;

			const creditedGroup = artists.group(tagKey(creditedText));
			if (creditedGroup < 0) return null;

			return best.get(`${albumGroup}:${creditedGroup}`)?.[2] ?? null;
		},
	};
}

export function albumCoverRows(groups: AlbumRun[], length: number) {
	const cover = new Int32Array(length);
	groups.forEach((group) => {
		cover.fill(group.cover, group.start, group.start + group.count);
	});
	return cover;
}

export function multiDiscRows(groups: AlbumRun[], length: number) {
	const flags = new Uint8Array(length);
	groups.forEach((group) => {
		if (group.discs) flags.fill(1, group.start, group.start + group.count);
	});
	return flags;
}
