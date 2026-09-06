import { FIELD, tagKey, value } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";

// How many sleeves a tile draws, as a fanned stack. The biggest albums in the genre rather than a
// sample of it: those are the records the genre *is*, and a genre with six albums should not deal a
// different five every visit.
export const COVERS_PER_TILE = 5;

export interface Genre {
	/** The tag as the library spells it, taken from the first row that carried it. */
	name: string;
	/** `tagKey`, which is what `refsOfGenre` matches on, so the tile and the view it opens agree. */
	key: string;
	/** Folded once here, because the page scores every genre against every keystroke. */
	match: FuzzyKey;
	trackCount: number;
	albumCount: number;
	/** One ref per album, biggest album first: the addresses the tile asks the source for artwork by. */
	coverRefs: number[];
}

interface Draft {
	name: string;
	key: string;
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
 * Every genre in the library, biggest first, with enough about each to draw a tile.
 * Takes rows rather than the snapshot so a caller's `useMemo` can depend on the rows alone.
 *
 * The tag is counted whole, exactly as `summarise` counts it and `refsOfGenre` matches it: a row
 * tagged `Rock; Blues` is one genre called `Rock; Blues` and not two. Splitting here would make the
 * figure on a tile disagree with the view behind it, which is the one thing the count must never do.
 */
export function genresOf(rows: TrackColumns[]): Genre[] {
	const byKey = new Map<string, Draft>();

	for (let ref = 0; ref < rows.length; ref += 1) {
		const row = rows[ref];
		const genre = value(row, FIELD.genre);
		if (!genre) continue;

		const key = tagKey(genre);
		let draft = byKey.get(key);
		if (!draft) {
			draft = { name: genre, key, trackCount: 0, albums: new Map() };
			byKey.set(key, draft);
		}

		draft.trackCount += 1;

		const album = albumKeyOf(row);
		if (!album) continue;
		const seen = draft.albums.get(album);
		// The first ref of an album, not the last: artwork is asked for by track, and the opening
		// track of a record is the one most likely to carry the embedded sleeve.
		if (seen) seen.trackCount += 1;
		else draft.albums.set(album, { ref, trackCount: 1 });
	}

	return [...byKey.values()]
		.map(
			(draft): Genre => ({
				name: draft.name,
				key: draft.key,
				match: fuzzyKey(draft.name),
				trackCount: draft.trackCount,
				albumCount: draft.albums.size,
				coverRefs: [...draft.albums.values()]
					.sort((a, b) => b.trackCount - a.trackCount)
					.slice(0, COVERS_PER_TILE)
					.map((album) => album.ref),
			}),
		)
		.sort((a, b) => b.trackCount - a.trackCount || a.key.localeCompare(b.key));
}
