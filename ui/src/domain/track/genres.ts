import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { artistGroups, FIELD, tagGroups, tagKey } from "./fields";
import { growingIndex } from "./growingIndex";
import type { TrackRows } from "./project";

export const COVERS_PER_TILE = 5;

export interface Genre {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	albumCount: number;
	coverRefs: number[];
}

interface Draft {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	albums: Map<string, { ref: number; trackCount: number }>;
}

/**
 * The tag is counted whole, as `summarise` counts it and `refsOfGenre` matches it: a row tagged
 * `Rock; Blues` is one genre and not two.
 */
function absorb(byKey: Map<string, Draft>, rows: TrackRows, from: number) {
	const { columns } = rows;
	const genre = columns.fields[FIELD.genre];
	const album = columns.fields[FIELD.album];

	const genres = tagGroups(genre);
	const albums = tagGroups(album);
	const artists = artistGroups(columns);

	const records = new Map<number, string>();

	for (let position = from; position < rows.length; position += 1) {
		const ref = rows.ref(position);
		const group = genres.of[genre.ids[ref]];
		if (group < 0) continue;

		const key = genres.keys[group];
		let draft = byKey.get(key);
		if (!draft) {
			const name = genres.names[group];
			draft = {
				name,
				key,
				match: fuzzyKey(name),
				trackCount: 0,
				albums: new Map(),
			};
			byKey.set(key, draft);
		}

		draft.trackCount += 1;

		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup < 0) continue;

		const pair = artists.pairedWith(ref, albumGroup);
		let record = records.get(pair);
		if (record === undefined) {
			const credited = artists.at(ref);
			const name = credited < 0 ? "Unknown" : artists.names[credited];
			record = tagKey(`${name} ${albums.names[albumGroup]}`);
			records.set(pair, record);
		}

		const seen = draft.albums.get(record);
		if (seen) seen.trackCount += 1;
		else draft.albums.set(record, { ref: position, trackCount: 1 });
	}
}

const derive = (byKey: Map<string, Draft>): Genre[] =>
	[...byKey.values()]
		.map(
			(draft): Genre => ({
				name: draft.name,
				key: draft.key,
				match: draft.match,
				trackCount: draft.trackCount,
				albumCount: draft.albums.size,
				coverRefs: [...draft.albums.values()]
					.sort((a, b) => b.trackCount - a.trackCount)
					.slice(0, COVERS_PER_TILE)
					.map((album) => album.ref),
			}),
		)
		.sort((a, b) => b.trackCount - a.trackCount || a.key.localeCompare(b.key));

export function genresOf(rows: TrackRows): Genre[] {
	const byKey = new Map<string, Draft>();
	absorb(byKey, rows, 0);
	return derive(byKey);
}

const GROUPED = [FIELD.genre, FIELD.album, FIELD.albumArtist, FIELD.artist];

export const genreIndex = growingIndex(GROUPED, absorb, derive);
