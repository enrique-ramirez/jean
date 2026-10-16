import { type Album, albumIndex } from "@/domain/track/albums";
import { buildBeforeLanding } from "@/domain/track/landingWork";
import type { LibraryColumns } from "@/domain/track/libraryColumns";
import { trackRows } from "@/domain/track/project";
import { finished, type Steps } from "@/shared/lib/idle";
import { type LibraryStats, libraryStats } from "./libraryStats";
import { buildShelves, type FilledShelf } from "./shelves";

export interface HomeData {
	albums: Album[];
	shelves: FilledShelf<Album>[];
	stats: LibraryStats;
}

interface Held {
	columns: LibraryColumns;
	shelves?: FilledShelf<Album>[];
	stats?: LibraryStats;
}

const held = new WeakMap<Album[], Held>();

function* homeDataSteps(
	albums: Album[],
	columns: LibraryColumns,
): Steps<HomeData> {
	let kept = held.get(albums);
	if (kept?.columns !== columns) {
		kept = { columns };
		held.set(albums, kept);
	}
	kept.shelves ??= buildShelves(albums, columns);
	yield;
	kept.stats ??= libraryStats({ rows: trackRows(columns), albums });
	return { albums, shelves: kept.shelves, stats: kept.stats };
}

const NO_ALBUMS: Album[] = [];

function* homeSteps(columns: LibraryColumns, key: string): Steps<HomeData> {
	const albums =
		columns.trackCount === 0
			? NO_ALBUMS
			: yield* albumIndex.steps(key, columns);
	return yield* homeDataSteps(albums, columns);
}

buildBeforeLanding(homeSteps);

export const homeData = (key: string, columns: LibraryColumns): HomeData =>
	finished(homeSteps(columns, key));
