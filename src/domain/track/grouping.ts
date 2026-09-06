import type { TrackColumns } from "@/shared/api/types";
import { FIELD, sameTagValue, value } from "./fields";

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
	discs: DiscRun[] | null;
}

type OpenRun = Omit<AlbumRun, "discs"> & { discs: DiscRun[] };

// Free text, and rippers disagree: '1', '01' and '1/2' all turn up, the last writing the disc total
// into the same field.
export function discNumber(row: TrackColumns): number | null {
	const raw = value(row, FIELD.discNumber);
	if (raw === null) return null;
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const discsWorthDrawing = (discs: DiscRun[]): DiscRun[] | null =>
	discs.length >= 2 && discs.every((disc) => disc.number !== null)
		? discs
		: null;

// Contiguous runs only, never reordering: the player decides what comes next, so reordering here
// would desync the view from playback.
export function groupByAlbum(rows: TrackColumns[]): AlbumRun[] {
	const groups = rows.reduce<OpenRun[]>((built, row, index) => {
		const album = value(row, FIELD.album) ?? "Unknown album";
		const albumArtist =
			value(row, FIELD.albumArtist) ??
			value(row, FIELD.artist) ??
			"Unknown artist";
		const number = discNumber(row);

		const open = built[built.length - 1];
		const continues =
			open &&
			sameTagValue(open.album, album) &&
			sameTagValue(open.albumArtist, albumArtist);

		if (!continues) {
			built.push({
				key: `${albumArtist} ${album} ${index}`,
				album,
				albumArtist,
				year: value(row, FIELD.year),
				start: index,
				count: 1,
				discs: [{ number, start: index, count: 1 }],
			});
			return built;
		}

		open.count += 1;
		const disc = open.discs[open.discs.length - 1];
		if (disc.number === number) disc.count += 1;
		else open.discs.push({ number, start: index, count: 1 });

		return built;
	}, []);

	return groups.map((group) => ({
		...group,
		discs: discsWorthDrawing(group.discs),
	}));
}

// Artwork is addressed per row, so without this the browser cannot tell that a record's tracks
// share one picture.
export function albumCoverRows(groups: AlbumRun[], length: number) {
	const cover = new Int32Array(length);
	groups.forEach((group) => {
		cover.fill(group.start, group.start, group.start + group.count);
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
