import type { TrackColumns } from "@/shared/api/types";
import {
	columnsReadingRows,
	type ListedRows,
	PENDING_ROW,
	type RowsViewport,
	shadedBy,
} from "./project";
import type { PlaylistList, RowWindows } from "./rowWindows";

const loads = new WeakMap<PlaylistList, object>();

const loadOf = (list: PlaylistList) => {
	let token = loads.get(list);
	if (!token) {
		token = {};
		loads.set(list, token);
	}
	return token;
};

export function windowedPlaylistRows(
	windows: RowWindows,
	list: PlaylistList,
	viewport: RowsViewport,
	mostPlays: number,
): ListedRows {
	const held = (position: number) => {
		const row = windows.at(list, position);
		return row?.kind === "playlist" ? row : null;
	};

	const at = (position: number) => {
		const row = held(position);
		return row
			? (row.page.items[row.row].columns as TrackColumns)
			: PENDING_ROW;
	};

	return {
		length: list.length,
		columns: columnsReadingRows(loadOf(list), list.length, at, (position) => {
			const row = windows.at(list, position);
			return row?.kind === "playlist" ? row.page : null;
		}),
		indices: null,
		at,
		ref: (position) => position,
		isPending: (position) => held(position) === null,
		viewport,
		...shadedBy({ length: list.length, at }, mostPlays),
	};
}
