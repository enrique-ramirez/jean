import type { RowsWindow } from "@/shared/api/libraryRows";
import type { TrackColumns } from "@/shared/api/types";
import { EMPTY_COLUMNS, TRACK_EXPRESSIONS } from "./fields";
import { intensityOf, type Shading } from "./intensity";
import type { LibraryColumns } from "./libraryColumns";
import type { LibraryList, RowWindows } from "./rowWindows";

export type Refs = Int32Array | number[];

const refAt = (indices: Refs | null | undefined, position: number) =>
	indices ? indices[position] : position;

export interface RowsViewport {
	watch: (first: number, end: number, direction: -1 | 0 | 1) => void;
	leave: () => void;
}

export const NO_VIEWPORT: RowsViewport = { watch: () => {}, leave: () => {} };

export interface TrackRows {
	readonly length: number;
	readonly columns: LibraryColumns;
	readonly indices: Refs | null;
	readonly at: (position: number) => TrackColumns;
	readonly ref: (position: number) => number;
	readonly isPending: (position: number) => boolean;
	readonly viewport?: RowsViewport;
}

export interface ListedRows extends TrackRows {
	heat: ArrayLike<number>;
	patina: ArrayLike<number>;
}

export const PENDING_ROW: TrackColumns = Object.freeze(
	TRACK_EXPRESSIONS.map(() => ""),
) as TrackColumns;

export const rowInWindow = (window: RowsWindow, row: number): TrackColumns =>
	TRACK_EXPRESSIONS.map(
		(expression) => window.columns.get(expression)?.at(row) ?? "",
	);

export function shadedBy(
	rows: Pick<TrackRows, "length" | "at">,
	mostPlayed: number,
): Record<keyof Shading, ArrayLike<number>> {
	const now = Date.now();
	let last: { position: number; shading: Shading } | null = null;
	const shadingAt = (position: number) => {
		if (last?.position !== position)
			last = {
				position,
				shading: intensityOf(rows.at(position), mostPlayed, now),
			};
		return last.shading;
	};
	const column = (name: keyof Shading): ArrayLike<number> =>
		new Proxy({ length: rows.length } as ArrayLike<number>, {
			get: (target, key) => {
				const position = typeof key === "string" ? Number(key) : Number.NaN;
				return Number.isInteger(position)
					? shadingAt(position)[name]
					: Reflect.get(target, key);
			},
		});
	return { heat: column("heat"), patina: column("patina") };
}

const windowedLoads = new Map<number, object>();

const windowedLoadOf = (structure: number) => {
	let token = windowedLoads.get(structure);
	if (!token) {
		token = {};
		windowedLoads.set(structure, token);
		const [oldest] = windowedLoads.keys();
		if (windowedLoads.size > 2) windowedLoads.delete(oldest);
	}
	return token;
};

const landings = new WeakMap<LibraryColumns, (ref: number) => object | null>();

export const landingOf = (columns: LibraryColumns, ref: number) =>
	landings.get(columns)?.(ref) ?? null;

export const columnsReadingRows = (
	load: object,
	trackCount: number,
	rowOf: (ref: number) => TrackColumns,
	landing: (ref: number) => object | null,
): LibraryColumns => {
	const columns: LibraryColumns = {
		load,
		trackCount,
		fields: EMPTY_COLUMNS.fields.map((column, field) => ({
			...column,
			at: (ref: number) => rowOf(ref)[field],
		})),
	};
	landings.set(columns, landing);
	return columns;
};

export function windowedRows(
	windows: RowWindows,
	list: LibraryList,
	viewport: RowsViewport,
	mostPlayed = 0,
): ListedRows {
	const held = (position: number) => {
		const row = windows.at(list, position);
		return row?.kind === "library" ? row : null;
	};

	const at = (position: number) => {
		const row = held(position);
		return row ? rowInWindow(row.window, row.row) : PENDING_ROW;
	};

	const byOrdinal: LibraryList = list.ordinals
		? { ...list, ordinals: null }
		: list;
	const atOrdinal = (ordinal: number) => {
		const row = windows.at(byOrdinal, ordinal);
		return row?.kind === "library"
			? rowInWindow(row.window, row.row)
			: PENDING_ROW;
	};

	return {
		length: list.length,
		columns: columnsReadingRows(
			windowedLoadOf(list.structure),
			list.length,
			atOrdinal,
			(ordinal) => {
				const row = windows.at(byOrdinal, ordinal);
				return row?.kind === "library" ? row.window : null;
			},
		),
		indices: null,
		at,
		ref: (position) => refAt(list.ordinals, position),
		isPending: (position) => held(position) === null,
		viewport,
		...shadedBy({ length: list.length, at }, mostPlayed),
	};
}

let everyRef = new Int32Array(0);

export const wholeRefs = (length: number) => {
	if (everyRef.length !== length) {
		everyRef = new Int32Array(length);
		for (let index = 0; index < length; index += 1) everyRef[index] = index;
	}
	return everyRef;
};

export const EMPTY_VIEW: ListedRows & { indices: Refs } = Object.freeze({
	length: 0,
	columns: EMPTY_COLUMNS,
	indices: new Int32Array(0),
	at: () => PENDING_ROW,
	ref: (position: number) => position,
	isPending: () => false,
	heat: new Float32Array(0),
	patina: new Float32Array(0),
});
