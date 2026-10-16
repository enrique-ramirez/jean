import type {
	JlibColumn,
	JlibDelta,
	JlibSnapshot,
	JlibSpine,
	JlibSplice,
} from "@/shared/api/jlib";
import { jlibColumn, patchColumn, splicedColumn } from "@/shared/api/jlib";
import { LATE_FIELDS } from "./fields";
import { type LibraryColumns, UNRESOLVED } from "./libraryColumns";
import { joinedPathTable, type PathTable } from "./pathTable";

export interface LibrarySnapshot {
	columns: LibraryColumns;
	spine: JlibSpine;
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

export const columnsOfSnapshot = (
	library: JlibSnapshot,
	expressions: readonly string[],
): LibraryColumns => ({
	load: {},
	trackCount: library.trackCount,
	fields: fieldsOf(library, expressions),
});

export function withSpine(
	columns: LibraryColumns,
	spine: JlibSpine,
): LibrarySnapshot {
	const { directory, filename, subsong } = spine;
	return {
		columns,
		spine,
		paths: joinedPathTable(columns.trackCount, directory.at, filename.at),
		subsongs: subsongsOf(columns.trackCount, subsong),
	};
}

export const librarySnapshotOf = (
	library: JlibSnapshot,
	expressions: readonly string[],
): LibrarySnapshot =>
	withSpine(columnsOfSnapshot(library, expressions), library.spine);

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
		if (!fields[field].isLoaded) continue;

		const patched = patchColumn(fields[field], patch);
		if (!patched) return null;
		fields[field] = patched;
	}

	return { ...held, fields };
}

export function withLatePart(
	held: LibraryColumns,
	part: LibraryColumns,
): LibraryColumns | null {
	if (part.trackCount !== held.trackCount) return null;

	return {
		...held,
		fields: held.fields.map((column, field) =>
			column.isLoaded ? column : part.fields[field],
		),
	};
}

const rowsBefore = (splice: JlibSplice) =>
	splice.trackCount - splice.inserted.length + splice.removed.length;

export function splicedColumns(
	held: LibraryColumns,
	splice: JlibSplice,
	expressions: readonly string[],
): LibraryColumns | null {
	if (held.trackCount !== rowsBefore(splice)) return null;
	if ([...splice.columns.keys()].some((name) => !expressions.includes(name)))
		return null;

	const fields: JlibColumn[] = [];
	for (const [field, column] of held.fields.entries()) {
		if (!column.isLoaded) {
			fields.push(column);
			continue;
		}
		const spliced = splicedColumn(
			column,
			splice.columns.get(expressions[field]),
			splice,
		);
		if (!spliced) return null;
		fields.push(spliced);
	}

	return { load: {}, trackCount: splice.trackCount, fields };
}

export function splicedSpine(
	held: JlibSpine,
	splice: JlibSplice,
): JlibSpine | null {
	const directory = splicedColumn(
		held.directory,
		splice.spine.get("directory"),
		splice,
	);
	const filename = splicedColumn(
		held.filename,
		splice.spine.get("filename"),
		splice,
	);
	const subsong = splicedColumn(
		held.subsong,
		splice.spine.get("subsong"),
		splice,
	);
	return directory && filename && subsong
		? { directory, filename, subsong }
		: null;
}

const unresolvedColumn = (rows: number): JlibColumn =>
	jlibColumn(
		new Uint8Array(rows),
		{ count: 1, of: () => UNRESOLVED, appended: [] },
		{ distinct: 1, hasUnresolved: true, allUnresolved: true },
	);

export const withSettledLatePart = (
	columns: LibraryColumns,
): LibraryColumns => ({
	...columns,
	fields: columns.fields.map((column, field) =>
		column.isLoaded || !LATE_FIELDS.includes(field)
			? column
			: unresolvedColumn(columns.trackCount),
	),
});
