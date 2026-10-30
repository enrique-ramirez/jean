import type { JlibColumn } from "@/shared/api/jlib";
import type { TrackColumns } from "@/shared/api/types";

export const UNRESOLVED = "?";

export interface LibraryColumns {
	readonly load: object;
	readonly trackCount: number;
	readonly fields: readonly JlibColumn[];
}

export const isLoaded = (columns: LibraryColumns, fields: readonly number[]) =>
	fields.every((field) => columns.fields[field].isLoaded);

export function rowAt({ fields }: LibraryColumns, ref: number): TrackColumns {
	const row: string[] = new Array(fields.length);
	for (let field = 0; field < fields.length; field += 1)
		row[field] = fields[field].at(ref);
	return row;
}

export const byValue = <T>(column: JlibColumn, of: (raw: string) => T): T[] => {
	const values = new Array<T>(column.distinct);
	for (let id = 0; id < column.distinct; id += 1)
		values[id] = of(column.value(id));
	return values;
};
