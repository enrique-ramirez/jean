import type { JlibColumn, JlibDelta, JlibSnapshot } from "@/shared/api/jlib";
import { patchColumn } from "@/shared/api/jlib";
import { byValue, type LibraryColumns } from "./libraryColumns";
import { joinedPathTable, type PathTable } from "./pathTable";

export interface LibrarySnapshot {
	columns: LibraryColumns;
	paths: PathTable;
	subsongs: Int32Array;
}

function subsongsOf(trackCount: number, subsong: JlibColumn): Int32Array {
	const known = Int32Array.from({ length: subsong.distinct }, (_, id) =>
		Number(subsong.value(id)),
	);

	const subsongs = new Int32Array(trackCount);
	for (let row = 0; row < trackCount; row += 1)
		subsongs[row] = known[subsong.ids[row]] || 0;
	return subsongs;
}

const fieldsOf = (
	library: JlibSnapshot,
	expressions: readonly string[],
): JlibColumn[] =>
	expressions.map((expression) => {
		const column = library.columns.get(expression);
		if (!column) throw new Error(`the snapshot carries no ${expression}`);
		return column;
	});

export function librarySnapshotOf(
	library: JlibSnapshot,
	expressions: readonly string[],
): LibrarySnapshot {
	const { directory, filename, subsong } = library.spine;
	const folders = byValue(directory, (raw) => raw);

	return {
		columns: {
			load: {},
			trackCount: library.trackCount,
			fields: fieldsOf(library, expressions),
		},
		paths: joinedPathTable(
			library.trackCount,
			(row) => folders[directory.ids[row]],
			filename.at,
		),
		subsongs: subsongsOf(library.trackCount, subsong),
	};
}

export function patchedColumns(
	held: LibraryColumns,
	delta: JlibDelta,
	expressions: readonly string[],
): LibraryColumns | null {
	if (delta.spine.length > 0) return null;
	if (delta.trackCount !== held.trackCount) return null;

	const fields = [...held.fields];
	for (const [name, patch] of delta.columns) {
		const field = expressions.indexOf(name);
		if (field < 0) return null;

		const patched = patchColumn(fields[field], patch);
		if (!patched) return null;
		fields[field] = patched;
	}

	return { ...held, fields };
}
