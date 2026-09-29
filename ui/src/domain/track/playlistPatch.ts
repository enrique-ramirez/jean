import { patchColumn } from "@/shared/api/jlib";
import type { PlaylistChanges } from "@/shared/api/playlists";
import type { LibraryColumns } from "./libraryColumns";
import type { PathTable } from "./pathTable";

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
