import {
	artistGroups,
	FIELD,
	tagGroups,
} from "../../src/domain/track/fields.ts";
import { coverCandidates } from "../../src/domain/track/grouping.ts";
import type { Refs, TrackRows } from "../../src/domain/track/project.ts";

interface Run {
	albumGroup: number;
	artistGroup: number;
	start: number;
	count: number;
}

export function groupByAlbum(
	rows: TrackRows,
): { start: number; count: number }[] {
	const album = rows.columns.fields[FIELD.album];
	const albums = tagGroups(album);
	const artists = artistGroups(rows.columns);

	const runs: Run[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		const ref = rows.ref(index);
		const albumGroup = albums.of[album.ids[ref]];
		const artistGroup = artists.at(ref);
		const open = runs[runs.length - 1];
		if (
			open &&
			open.albumGroup === albumGroup &&
			open.artistGroup === artistGroup
		)
			open.count += 1;
		else runs.push({ albumGroup, artistGroup, start: index, count: 1 });
	}
	return runs.map(({ start, count }) => ({ start, count }));
}

export function coverCandidatesFromRuns(
	runs: Parameters<typeof coverCandidates>[0],
	positions: Refs | null,
): number[] {
	const { count, at } = coverCandidates(runs, positions);
	return Array.from({ length: count }, (_, index) => at(index));
}
