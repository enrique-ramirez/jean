import type { TrackColumns } from "@/shared/api/types";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { FIELD, tagKey, value } from "./fields";
import { growingIndex } from "./growingIndex";

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

const albumKeyOf = (row: TrackColumns) => {
	const album = value(row, FIELD.album);
	if (!album) return null;
	const artist =
		value(row, FIELD.albumArtist) ?? value(row, FIELD.artist) ?? "Unknown";
	return tagKey(`${artist} ${album}`);
};

/**
 * The tag is counted whole, as `summarise` counts it and `refsOfGenre` matches it: a row tagged
 * `Rock; Blues` is one genre and not two.
 */
function absorb(byKey: Map<string, Draft>, rows: TrackColumns[], from: number) {
	for (let ref = from; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const genre = value(row, FIELD.genre);
		if (!genre) continue;

		const key = tagKey(genre);
		let draft = byKey.get(key);
		if (!draft) {
			draft = {
				name: genre,
				key,
				match: fuzzyKey(genre),
				trackCount: 0,
				albums: new Map(),
			};
			byKey.set(key, draft);
		}

		draft.trackCount += 1;

		const album = albumKeyOf(row);
		if (!album) continue;
		const seen = draft.albums.get(album);
		if (seen) seen.trackCount += 1;
		else draft.albums.set(album, { ref, trackCount: 1 });
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

export function genresOf(rows: TrackColumns[]): Genre[] {
	const byKey = new Map<string, Draft>();
	absorb(byKey, rows, 0);
	return derive(byKey);
}

export const genreIndex = growingIndex(absorb, derive);
