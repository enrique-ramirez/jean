import { SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { columnsOf, slicedOver } from "./columnCache";
import { artistGroups, FIELD, readValue, tagGroups, tagKey } from "./fields";
import type { TrackRows } from "./project";

const TILE_FIELDS = [FIELD.album, FIELD.title, FIELD.albumArtist, FIELD.artist];

export function* albumTilesSteps(rows: TrackRows): Steps<number[]> {
	const { columns } = rows;
	const album = columns.fields[FIELD.album];
	const title = columns.fields[FIELD.title];

	const albums = yield* tagGroups.steps(album);
	const artists = yield* artistGroups.steps(columns);

	const seenAlbums = new Set<number>();
	const seenTracks = new Set<string>();
	const tiles: number[] = [];

	for (let at = 0; at < rows.length; at += 1) {
		if ((at & SLICE_MASK) === 0) yield;
		const ref = rows.ref(at);

		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup >= 0) {
			const pair = artists.pairedWith(ref, albumGroup);
			if (seenAlbums.has(pair)) continue;
			seenAlbums.add(pair);
			tiles.push(at);
			continue;
		}

		const name = readValue(title.at(ref));
		if (name !== null) {
			const pair = `${tagKey(name)}\u0000${artists.at(ref)}`;
			if (seenTracks.has(pair)) continue;
			seenTracks.add(pair);
		}
		tiles.push(at);
	}

	return tiles;
}

export const tilesHeld = slicedOver<number[]>();
const NO_INDICES: readonly number[] = [];

export const tileKeys = (rows: TrackRows) => [
	...columnsOf(rows.columns, TILE_FIELDS),
	rows.indices ?? NO_INDICES,
];

export const tileSteps = (rows: TrackRows) =>
	tilesHeld.steps(tileKeys(rows), () => albumTilesSteps(rows));
