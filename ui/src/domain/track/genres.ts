import { type FuzzyKey, fuzzyKey } from "@/shared/lib/text";
import { artistGroups, FIELD, genreGroups, tagGroups, tagKey } from "./fields";
import { growingIndex } from "./growingIndex";
import type { TrackRows } from "./project";

const COVERS_PER_TILE = 2;

export interface Genre {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	albumCount: number;
	artistCount: number;
	coverRefs: number[];
}

interface Draft {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	albums: Map<string, { ref: number; trackCount: number }>;
	artists: Set<string>;
}

function absorb(byKey: Map<string, Draft>, rows: TrackRows, from: number) {
	const { columns } = rows;
	const genre = columns.fields[FIELD.genre];
	const album = columns.fields[FIELD.album];

	const genres = genreGroups(genre);
	const albums = tagGroups(album);
	const artists = artistGroups(columns);

	const records = new Map<number, string>();
	const artistKeys = new Map<number, string>();

	const draftOf = (group: number) => {
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
				artists: new Set(),
			};
			byKey.set(key, draft);
		}
		return draft;
	};

	for (let position = from; position < rows.length; position += 1) {
		const ref = rows.ref(position);
		const groups = genres.of[genre.ids[ref]];
		if (groups.length === 0) continue;

		const credited = artists.at(ref);
		let artist: string | undefined;
		if (credited >= 0) {
			artist = artistKeys.get(credited);
			if (artist === undefined) {
				artist = tagKey(artists.names[credited]);
				artistKeys.set(credited, artist);
			}
		}

		const albumGroup = albums.of[album.ids[ref]];
		let record: string | undefined;
		if (albumGroup >= 0) {
			const pair = artists.pairedWith(ref, albumGroup);
			record = records.get(pair);
			if (record === undefined) {
				const name = credited < 0 ? "Unknown" : artists.names[credited];
				record = tagKey(`${name} ${albums.names[albumGroup]}`);
				records.set(pair, record);
			}
		}

		for (const group of groups) {
			const draft = draftOf(group);
			draft.trackCount += 1;
			if (artist !== undefined) draft.artists.add(artist);
			if (record === undefined) continue;

			const seen = draft.albums.get(record);
			if (seen) seen.trackCount += 1;
			else draft.albums.set(record, { ref: position, trackCount: 1 });
		}
	}
}

const inKeyOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const derive = (byKey: Map<string, Draft>): Genre[] =>
	[...byKey.values()]
		.map(
			(draft): Genre => ({
				name: draft.name,
				key: draft.key,
				match: draft.match,
				trackCount: draft.trackCount,
				albumCount: draft.albums.size,
				artistCount: draft.artists.size,
				coverRefs: [...draft.albums.values()]
					.sort((a, b) => b.trackCount - a.trackCount)
					.slice(0, COVERS_PER_TILE)
					.map((album) => album.ref),
			}),
		)
		.sort((a, b) => b.trackCount - a.trackCount || inKeyOrder(a.key, b.key));

export function genresOf(rows: TrackRows): Genre[] {
	const byKey = new Map<string, Draft>();
	absorb(byKey, rows, 0);
	return derive(byKey);
}

const GROUPED = [FIELD.genre, FIELD.album, FIELD.albumArtist, FIELD.artist];

export const genreIndex = growingIndex(GROUPED, absorb, derive);
