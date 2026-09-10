import type { Translate } from "@/shared/i18n/locale";
import { artistGroups, FIELD, readValue, tagGroups } from "./fields";
import { byValue } from "./libraryColumns";
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

		built.push({
			key: `${credit} ${name} ${index}`,
			album: name,
			albumArtist: credit,
			albumGroup,
			artistGroup,
			year: readValue(year.at(ref)),
			start: index,
			count: 1,
			discs: [{ number, start: index, count: 1 }],
		});
	}

	return built.map(({ albumGroup, artistGroup, ...group }) => ({
		...group,
		discs: discsWorthDrawing(group.discs),
	}));
}

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
