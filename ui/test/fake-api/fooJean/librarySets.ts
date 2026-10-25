import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import type { Sweep } from "../yielding.ts";
import {
	draftAlbumsSweep,
	figuresSweep,
	genreGroupsSweep,
	type LocalTime,
	lastPlayedOf,
	playsOf,
	readValue,
	releaseYearOf,
	type SummaryInput,
} from "./librarySummary.ts";

type SetFigures = components["schemas"]["SetFigures"];
type ArtistCards = components["schemas"]["ArtistCards"];
type AlbumRecord = components["schemas"]["AlbumRecord"];

const GENRES_PER_ARTIST = 4;

// The fake's own copy of the figures, cards and records `foo_jean` computes over a set of tracks.
export function* setsOverSweep(input: SummaryInput, local: LocalTime) {
	const { columns } = input;
	const trackCount = input.directory.length;
	const { draftAt, drafts } = yield* draftAlbumsSweep(
		columns,
		trackCount,
		local,
	);
	const genres = yield* genreGroupsSweep(columns);

	const figures = (ordinals: readonly number[]): Sweep<SetFigures> =>
		figuresSweep(columns, ordinals, draftAt);

	const cards = (ordinals: readonly number[]): ArtistCards => {
		let plays = 0;
		let unplayed = 0;
		let lastPlayed: number | null = null;
		let most: { ordinal: number; plays: number } | null = null;
		const tallies = new Map<number, number>();
		for (const ordinal of ordinals) {
			const count = playsOf(columns, ordinal) ?? 0;
			plays += count;
			if (count === 0) unplayed += 1;
			else if (most === null || count > most.plays)
				most = { ordinal, plays: count };

			const at = lastPlayedOf(columns, ordinal, local);
			if (at !== null && (lastPlayed === null || at > lastPlayed))
				lastPlayed = at;

			for (const group of genres.at(ordinal))
				tallies.set(group, (tallies.get(group) ?? 0) + 1);
		}
		const size = ordinals.length;
		return {
			playedShare: size > 0 ? (size - unplayed) / size : 0,
			plays,
			neverPlayed: unplayed,
			lastPlayed,
			mostPlayed: most && {
				ordinal: most.ordinal,
				title: readValue(columns.title?.[most.ordinal]) ?? "",
				plays: most.plays,
			},
			// Map keeps the groups in the order the set first met them, which a stable sort keeps among ties.
			topGenres: [...tallies]
				.sort((a, b) => b[1] - a[1])
				.slice(0, GENRES_PER_ARTIST)
				.map(([group, count]) => ({
					name: genres.names[group],
					count,
					share: Math.round((count / size) * 100),
				})),
		};
	};

	const records = (ordinals: readonly number[]): AlbumRecord[] => {
		const found = new Map<
			number,
			{ first: number; trackCount: number; year: number | null }
		>();
		for (const ordinal of ordinals) {
			const draft = draftAt[ordinal];
			if (draft < 0) continue;
			// An album's year is its earliest, since a reissue often tags its own year onto a track or two.
			const year = releaseYearOf(columns.year?.[ordinal]);
			const seen = found.get(draft);
			if (!seen) {
				found.set(draft, { first: ordinal, trackCount: 1, year });
				continue;
			}
			seen.trackCount += 1;
			if (year !== null && (seen.year === null || year < seen.year))
				seen.year = year;
		}
		return [...found]
			.map(([draft, album]) => ({
				album: drafts[draft].album,
				artist: drafts[draft].artist,
				year: album.year,
				cover: `${input.directory[album.first]}${input.filename[album.first]}`,
				trackCount: album.trackCount,
			}))
			.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
	};

	return { figures, cards, records };
}
