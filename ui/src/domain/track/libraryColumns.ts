import { type JlibColumn, jlibColumn } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";

export const UNRESOLVED = "?";

export interface LibraryColumns {
	readonly load: object;
	readonly trackCount: number;
	readonly fields: readonly JlibColumn[];
}

export function rowAt({ fields }: LibraryColumns, ref: number): TrackColumns {
	const row: string[] = new Array(fields.length);
	for (let field = 0; field < fields.length; field += 1)
		row[field] = fields[field].at(ref);
	return row;
}

export const someFieldMoved = (
	fields: readonly number[],
	before: LibraryColumns,
	after: LibraryColumns,
) => fields.some((field) => before.fields[field] !== after.fields[field]);

export const byValue = <T>(column: JlibColumn, of: (raw: string) => T): T[] =>
	Array.from({ length: column.distinct }, (_, id) => of(column.value(id)));

const BLOCK = 256;

const grownTo = (ids: Uint32Array<ArrayBuffer>, length: number) => {
	if (length < ids.length) return ids;
	const grown = new Uint32Array(ids.length * 2);
	grown.set(ids);
	return grown;
};

interface Interned {
	add: (text: string | undefined) => void;
	column: (length: number) => JlibColumn;
}

function interned(): Interned {
	const byText = new Map<string, number>();
	const values: string[] = [];
	let ids = new Uint32Array(BLOCK);
	let count = 0;
	let resolved = 0;

	return {
		add: (text = "") => {
			let id = byText.get(text);
			if (id === undefined) {
				id = values.length;
				values.push(text);
				byText.set(text, id);
				if (text !== UNRESOLVED) resolved += 1;
			}

			ids = grownTo(ids, count);
			ids[count] = id;
			count += 1;
		},

		column: (length) =>
			jlibColumn(
				ids.subarray(0, length),
				{ count: values.length, of: (id) => values[id], appended: [] },
				{
					distinct: values.length,
					hasUnresolved: byText.has(UNRESOLVED),
					allUnresolved: resolved === 0,
				},
			),
	};
}

export interface ColumnCollector {
	add: (rows: TrackColumns[]) => void;
	count: () => number;
	table: () => LibraryColumns;
}

export function columnCollector(fieldCount: number): ColumnCollector {
	const load = {};
	const fields = Array.from({ length: fieldCount }, interned);
	let count = 0;

	return {
		add: (rows) => {
			for (const row of rows) {
				for (let field = 0; field < fieldCount; field += 1)
					fields[field].add(row[field]);
				count += 1;
			}
		},

		count: () => count,

		table: () => {
			const trackCount = count;
			return {
				load,
				trackCount,
				fields: fields.map((field) => field.column(trackCount)),
			};
		},
	};
}

export function libraryColumnsOf(
	rows: TrackColumns[],
	fieldCount: number,
): LibraryColumns {
	const collector = columnCollector(fieldCount);
	collector.add(rows);
	return collector.table();
}
