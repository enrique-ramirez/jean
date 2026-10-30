import {
	type LibraryColumns,
	rowAt,
	UNRESOLVED,
} from "../../src/domain/track/libraryColumns.ts";
import {
	type Refs,
	type TrackRows,
	wholeRefs,
} from "../../src/domain/track/project.ts";
import { type JlibColumn, jlibColumn } from "../../src/shared/api/jlib.ts";
import type { TrackColumns } from "../../src/shared/api/types.ts";

function interned() {
	const byText = new Map<string, number>();
	const values: string[] = [];
	const ids: number[] = [];

	return {
		add: (text = "") => {
			let id = byText.get(text);
			if (id === undefined) {
				id = values.length;
				values.push(text);
				byText.set(text, id);
			}
			ids.push(id);
		},

		column: (): JlibColumn =>
			jlibColumn(
				Uint32Array.from(ids),
				{ count: values.length, of: (id) => values[id] },
				{
					distinct: values.length,
					hasUnresolved: byText.has(UNRESOLVED),
					allUnresolved: values.every((text) => text === UNRESOLVED),
				},
			),
	};
}

export function columnCollector(fieldCount: number) {
	const load = {};
	const fields = Array.from({ length: fieldCount }, interned);
	let count = 0;

	return {
		add: (rows: TrackColumns[]) => {
			for (const row of rows) {
				for (let field = 0; field < fieldCount; field += 1)
					fields[field].add(row[field]);
				count += 1;
			}
		},

		table: (): LibraryColumns => {
			const trackCount = count;
			return {
				load,
				trackCount,
				fields: fields.map((field) => field.column()),
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

const refAt = (indices: Refs | null, position: number) =>
	indices ? indices[position] : position;

export const trackRows = (
	columns: LibraryColumns,
	indices: Refs | null = null,
): TrackRows => ({
	length: indices ? indices.length : columns.trackCount,
	columns,
	indices,
	at: (position) => rowAt(columns, refAt(indices, position)),
	ref: (position) => refAt(indices, position),
	isPending: () => false,
});

export const wholeRows = (columns: LibraryColumns): TrackRows =>
	trackRows(columns, wholeRefs(columns.trackCount));
