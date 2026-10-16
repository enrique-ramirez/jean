import { type Ids, type JlibColumn, jlibColumn } from "@/shared/api/jlib";
import { encodedSnapshot } from "@/shared/api/jlibEncode";
import { TRACK_EXPRESSIONS } from "./fields";
import { UNRESOLVED } from "./libraryColumns";
import type { ReplayedLibrary } from "./libraryReplay";

// UTF-8 byte order is code point order, which UTF-16 order matches except where a surrogate meets a
// code unit above the surrogates.
const unsurrogated = (unit: number) =>
	unit >= 0xe000 ? unit - 0x800 : unit >= 0xd800 ? unit + 0x2000 : unit;

export function compareUtf8(left: string, right: string) {
	const shared = Math.min(left.length, right.length);
	for (let at = 0; at < shared; at += 1) {
		const a = left.charCodeAt(at);
		const b = right.charCodeAt(at);
		if (a !== b) return unsurrogated(a) - unsurrogated(b);
	}
	return left.length - right.length;
}

const idsFor = (distinct: number, length: number): Ids =>
	distinct <= 0x100
		? new Uint8Array(length)
		: distinct <= 0x10000
			? new Uint16Array(length)
			: new Uint32Array(length);

function rekeyedColumn(column: JlibColumn): JlibColumn {
	const { ids } = column;
	const used = new Uint8Array(column.distinct);
	for (let row = 0; row < ids.length; row += 1) used[ids[row]] = 1;

	const kept: { id: number; value: string }[] = [];
	for (let id = 0; id < used.length; id += 1)
		if (used[id]) kept.push({ id, value: column.value(id) });
	kept.sort((a, b) => compareUtf8(a.value, b.value));

	const renumbered = new Uint32Array(used.length);
	for (let rank = 0; rank < kept.length; rank += 1)
		renumbered[kept[rank].id] = rank;

	const next = idsFor(kept.length, ids.length);
	for (let row = 0; row < ids.length; row += 1)
		next[row] = renumbered[ids[row]];

	const values = kept.map(({ value }) => value);
	return jlibColumn(
		next,
		{ count: values.length, of: (id) => values[id], appended: [] },
		{
			distinct: values.length,
			hasUnresolved: values.includes(UNRESOLVED),
			allUnresolved: values.length === 1 && values[0] === UNRESOLVED,
		},
	);
}

export function rekeyedSnapshotBytes(
	held: ReplayedLibrary,
	pair: { structure: number; revision: number },
): ArrayBuffer {
	return encodedSnapshot({
		...pair,
		snapshotId: held.snapshotId,
		trackCount: held.columns.trackCount,
		columns: TRACK_EXPRESSIONS.map((name, field) => ({
			name,
			column: rekeyedColumn(held.columns.fields[field]),
		})),
		spine: {
			directory: rekeyedColumn(held.spine.directory),
			filename: rekeyedColumn(held.spine.filename),
			subsong: rekeyedColumn(held.spine.subsong),
		},
	});
}
