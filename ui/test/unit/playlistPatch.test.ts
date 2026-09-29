import assert from "node:assert/strict";
import test from "node:test";

import {
	type LibraryColumns,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { pathCollector } from "../../src/domain/track/pathTable.ts";
import { patchPlaylist } from "../../src/domain/track/playlistPatch.ts";
import type { PlaylistChanges } from "../../src/shared/api/playlists.ts";

const MAX_APPENDED_CHARS = 256 * 1024;

interface Row {
	path: string;
	subsong: number;
	title: string;
}

const ROWS: Row[] = [
	{ path: "Artist/Album/01 One.flac", subsong: 0, title: "One" },
	{ path: "Artist/Album/02 Two.flac", subsong: 0, title: "Two" },
];

const heldOf = (rows: Row[]) => {
	const columns = libraryColumnsOf(
		rows.map((row) => [row.title]),
		1,
	);
	const paths = pathCollector();
	for (const row of rows) paths.add(row.path);
	return {
		columns,
		paths: paths.table(),
		subsongs: Int32Array.from(rows.map((row) => row.subsong)),
	};
};

const titleAt = (columns: LibraryColumns, position: number) =>
	columns.fields[0].at(position);

const changeOf = (
	moved: { position: number; row: Row }[],
	revision: string,
): PlaylistChanges => ({
	revision,
	items: moved.map(({ position, row }) => ({
		position,
		libraryPath: row.path,
		subsong: row.subsong,
	})),
	columns: [
		{
			text: moved.map(({ row }) => row.title),
			ids: moved.map((_, at) => at),
		},
	],
});

test("no changed row is an unchanged snapshot, not a patch", () => {
	const held = heldOf(ROWS);
	assert.deepEqual(patchPlaylist(held, 0, changeOf([], "2")), {
		kind: "unchanged",
	});
});

test("a changed row whose address does not match what is held is a reload", () => {
	const held = heldOf(ROWS);
	const elsewhere: Row = { ...ROWS[1], path: "Artist/Album/99 Nine.flac" };
	const patch = patchPlaylist(
		held,
		0,
		changeOf([{ position: 1, row: elsewhere }], "2"),
	);
	assert.deepEqual(patch, { kind: "reload" });
});

test("a response naming a different column set than the one held is a reload", () => {
	const held = heldOf(ROWS);
	const changed = changeOf(
		[{ position: 1, row: { ...ROWS[1], title: "Zwei" } }],
		"2",
	);
	const patch = patchPlaylist(held, 0, {
		...changed,
		columns: [...changed.columns, changed.columns[0]],
	});
	assert.deepEqual(patch, { kind: "reload" });
});

test("a patch that would push the held text past the appended budget is a reload instead", () => {
	const held = heldOf(ROWS);
	const changed: Row = { ...ROWS[1], title: "Zwei" };
	const patch = patchPlaylist(
		held,
		MAX_APPENDED_CHARS,
		changeOf([{ position: 1, row: changed }], "2"),
	);
	assert.deepEqual(patch, { kind: "reload" });
});

test("a patch within budget replaces only the row that moved and grows the budget by what it added", () => {
	const held = heldOf(ROWS);
	const changed: Row = { ...ROWS[1], title: "Zwei" };
	const patch = patchPlaylist(
		held,
		10,
		changeOf([{ position: 1, row: changed }], "2"),
	);

	assert.equal(patch.kind, "patched");
	if (patch.kind !== "patched") return;
	assert.equal(titleAt(patch.columns, 0), "One");
	assert.equal(titleAt(patch.columns, 1), "Zwei");
	assert.equal(patch.appendedChars, 10 + "Zwei".length);
});
