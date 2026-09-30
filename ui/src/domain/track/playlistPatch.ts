import { jlibColumn, patchColumn } from "@/shared/api/jlib";
import type { PlaylistChanges } from "@/shared/api/playlists";
import type { LibraryColumns } from "./libraryColumns";
import { type PathTable, pathCollector } from "./pathTable";
import type { PlaylistSnapshot } from "./playlistEntries";

const MAX_APPENDED_CHARS = 256 * 1024;

export type PlaylistPatch =
	| { kind: "reload" }
	| { kind: "unchanged" }
	| { kind: "patched"; columns: LibraryColumns; appendedChars: number };

const RELOAD: PlaylistPatch = { kind: "reload" };

function patchedPlaylistColumns(
	held: LibraryColumns,
	changes: PlaylistChanges,
): LibraryColumns | null {
	if (changes.columns.length !== held.fields.length) return null;

	const ordinals = Uint32Array.from(changes.items, (row) => row.position);

	const fields: LibraryColumns["fields"][number][] = [];
	for (let index = 0; index < held.fields.length; index += 1) {
		const field = held.fields[index];
		const column = changes.columns[index];
		const base = field.distinct;
		const patched = patchColumn(field, {
			ordinals,
			ids: Uint32Array.from(changes.items, (_, at) => base + column.ids[at]),
			base,
			appended: column.text,
			distinct: base + column.text.length,
			hasUnresolved: false,
			allUnresolved: false,
		});
		if (!patched) return null;
		fields.push(patched);
	}

	return { ...held, fields };
}

// In foobar2000 every track of one cue sheet is a subsong of one file and shares its library path,
// so the path alone cannot tell two of those rows apart.
function fitsHeldAddresses(
	paths: PathTable | null,
	subsongs: Int32Array | null,
	items: PlaylistChanges["items"],
): boolean {
	return items.every(
		(row) =>
			(paths?.at(row.position) ?? "") === (row.libraryPath ?? "") &&
			(subsongs?.[row.position] ?? 0) === row.subsong,
	);
}

function appendedCharCount(columns: PlaylistChanges["columns"]): number {
	let total = 0;
	for (const column of columns)
		for (const value of column.text) total += value.length;
	return total;
}

export function patchPlaylist(
	held: {
		columns: LibraryColumns;
		paths: PathTable | null;
		subsongs: Int32Array | null;
	},
	appendedChars: number,
	changes: PlaylistChanges,
): PlaylistPatch {
	if (!fitsHeldAddresses(held.paths, held.subsongs, changes.items))
		return RELOAD;
	if (changes.items.length === 0) return { kind: "unchanged" };

	const appended = appendedChars + appendedCharCount(changes.columns);
	if (appended > MAX_APPENDED_CHARS) return RELOAD;

	const columns = patchedPlaylistColumns(held.columns, changes);
	return columns
		? { kind: "patched", columns, appendedChars: appended }
		: RELOAD;
}

export function moveOrder(
	count: number,
	positions: readonly number[],
	to: number,
): Int32Array | null {
	const moved = [...new Set(positions)].sort((a, b) => a - b);
	if (moved.some((at) => !Number.isInteger(at) || at < 0 || at >= count))
		return null;
	if (!Number.isInteger(to) || to < 0 || to > count - moved.length) return null;

	const isMoved = new Set(moved);
	const rest: number[] = [];
	for (let at = 0; at < count; at += 1) if (!isMoved.has(at)) rest.push(at);
	return Int32Array.from([...rest.slice(0, to), ...moved, ...rest.slice(to)]);
}

export function reorderedSnapshot(
	held: PlaylistSnapshot,
	order: ArrayLike<number>,
	structure: number,
): PlaylistSnapshot {
	const { columns, paths, subsongs } = held;
	if (order.length !== columns.trackCount)
		throw new Error(
			`an order of ${order.length} rows cannot reorder ${columns.trackCount}`,
		);

	let reorderedPaths: PathTable | null = null;
	if (paths) {
		const collector = pathCollector();
		for (let position = 0; position < order.length; position += 1)
			collector.add(paths.at(order[position]));
		reorderedPaths = collector.table();
	}

	return {
		...held,
		structure,
		columns: {
			load: {},
			trackCount: columns.trackCount,
			fields: columns.fields.map((field) =>
				jlibColumn(
					Uint32Array.from(order, (old) => field.ids[old]),
					field.dict,
					{
						distinct: field.distinct,
						hasUnresolved: field.hasUnresolved,
						allUnresolved: field.allUnresolved,
					},
				),
			),
		},
		paths: reorderedPaths,
		subsongs: subsongs && Int32Array.from(order, (old) => subsongs[old]),
		heat: Float32Array.from(order, (old) => held.heat[old]),
		patina: Float32Array.from(order, (old) => held.patina[old]),
	};
}
