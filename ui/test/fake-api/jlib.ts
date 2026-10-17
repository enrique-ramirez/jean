// The binary library format, from the encoding side. `contract/openapi.yaml` is the shape and
// `../../src/shared/api/jlib.ts` reads it back.

const MAGIC = "JLIB";
const BLOB_AT = 8;

const ENCODER = new TextEncoder();

const UNRESOLVED = "?";

/**
 * Append-only within a structure generation, which is what lets a delta carry the entries added since
 * a revision and nothing the client already holds. A value that stops being used leaves its entry
 * behind until the next rebuild throws the whole dictionary away.
 */
export interface Dictionary {
	readonly values: string[];
	id: (value: string) => number;
}

export function dictionary(): Dictionary {
	const known = new Map<string, number>();
	const values: string[] = [];

	return {
		values,
		id: (value) => {
			let id = known.get(value);
			if (id === undefined) {
				id = values.length;
				values.push(value);
				known.set(value, id);
			}
			return id;
		},
	};
}

// UTF-8 byte order, which is code point order: UTF-16 order differs only where a surrogate meets a
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

export function sortedDictionary(values: readonly string[]): Dictionary {
	const made = dictionary();
	for (const value of [...new Set(values)].sort(compareUtf8)) made.id(value);
	return made;
}

export interface Column {
	name: string | null;
	ids: number[];
	ordinals: number[] | null;
	base: number | null;
	appended: string[];
	distinct: number;
	hasUnresolved: boolean;
	allUnresolved: boolean;
}

const factsOf = (
	values: string[],
	appended: string[],
	base: number | null,
) => ({
	base,
	appended,
	distinct: values.length,
	hasUnresolved: values.includes(UNRESOLVED),
	allUnresolved: values.length === 1 && values[0] === UNRESOLVED,
});

/** One id per row, and the whole dictionary. */
export const wholeColumn = (
	name: string | null,
	dict: Dictionary,
	values: string[],
): Column => ({
	name,
	ids: values.map(dict.id),
	ordinals: null,
	...factsOf(dict.values, dict.values, null),
});

/** One id per changed ordinal, and only the dictionary entries added since the client's revision. */
export const changedColumn = (
	name: string,
	dict: Dictionary,
	base: number,
	changes: { ordinal: number; value: string }[],
): Column => ({
	name,
	ids: changes.map((change) => dict.id(change.value)),
	ordinals: changes.map((change) => change.ordinal),
	...factsOf(dict.values, dict.values.slice(base), base),
});

export interface Spine {
	directory?: Column;
	filename?: Column;
	subsong?: Column;
}

export const NO_SNAPSHOT = "0".repeat(16);

export interface Body {
	kind: "snapshot" | "delta" | "splice";
	structure: number;
	revision: number;
	since?: number;
	sinceStructure?: number;
	removed?: number[];
	inserted?: number[];
	snapshotId?: string;
	trackCount: number;
	columns: Column[];
	spine: Spine;
	carried?: readonly string[];
	spineCarried?: boolean;
}

const widthFor = (largest: number) =>
	largest <= 0xff ? 1 : largest <= 0xffff ? 2 : 4;

const alignedTo4 = (at: number) => (at + 3) & ~3;

interface Section {
	offset: number;
	count: number;
	width: number;
}

interface Placed {
	column: Column;
	text: Uint8Array[];
	ids: Section;
	ordinals: Section | null;
	textAt: { offset: number; length: number };
	endsAt: Section;
	ends: number[];
}

function place(
	column: Column,
	at: number,
	trackCount: number,
): { placed: Placed; end: number } {
	const text = column.appended.map((value) => ENCODER.encode(value));
	const ends: number[] = [];
	let textBytes = 0;
	for (const bytes of text) {
		textBytes += bytes.length;
		ends.push(textBytes);
	}

	const ids = {
		offset: at,
		count: column.ids.length,
		width: widthFor(Math.max(0, column.distinct - 1)),
	};

	const textAt = {
		offset: alignedTo4(ids.offset + ids.count * ids.width),
		length: textBytes,
	};
	const endsAt = {
		offset: alignedTo4(textAt.offset + textBytes),
		count: ends.length,
		width: widthFor(textBytes),
	};
	const afterEnds = endsAt.offset + endsAt.count * endsAt.width;

	// Ordinals index rows rather than dictionary entries, so their width comes from a different number
	// than the ids' does.
	const ordinals = column.ordinals
		? {
				offset: alignedTo4(afterEnds),
				count: column.ordinals.length,
				width: widthFor(Math.max(0, trackCount - 1)),
			}
		: null;

	return {
		placed: { column, text, ids, ordinals, textAt, endsAt, ends },
		end: ordinals
			? ordinals.offset + ordinals.count * ordinals.width
			: afterEnds,
	};
}

const headerColumnOf = (column: Column, laid: Placed | null) => ({
	...(column.name === null ? null : { name: column.name }),
	...(laid
		? {
				ids: laid.ids,
				...(laid.ordinals ? { ordinals: laid.ordinals } : null),
				dict: {
					text: laid.textAt,
					ends: laid.endsAt,
					...(column.base === null ? null : { base: column.base }),
				},
			}
		: null),
	distinct: column.distinct,
	hasUnresolved: column.hasUnresolved,
	allUnresolved: column.allUnresolved,
});

function writeIntegers(
	view: DataView,
	at: number,
	values: number[],
	width: number,
) {
	for (let index = 0; index < values.length; index += 1) {
		const offset = at + index * width;
		if (width === 1) view.setUint8(offset, values[index]);
		else if (width === 2) view.setUint16(offset, values[index], true);
		else view.setUint32(offset, values[index], true);
	}
}

const SPINE = ["directory", "filename", "subsong"] as const;

function placeRows(body: Body) {
	const removed = body.removed ?? [];
	const inserted = body.inserted ?? [];
	const oldCount = body.trackCount - inserted.length + removed.length;
	const removedAt = {
		offset: 0,
		count: removed.length,
		width: widthFor(Math.max(0, oldCount - 1)),
	};
	const insertedAt = {
		offset: alignedTo4(removedAt.count * removedAt.width),
		count: inserted.length,
		width: widthFor(Math.max(0, body.trackCount - 1)),
	};
	return {
		removed,
		inserted,
		removedAt,
		insertedAt,
		end: insertedAt.offset + insertedAt.count * insertedAt.width,
	};
}

export function encodeJlib(body: Body): Uint8Array<ArrayBuffer> {
	const bones = SPINE.filter((name) => body.spine[name]);
	const spineCarried = body.spineCarried ?? true;
	const carries = (column: Column) =>
		body.carried === undefined || body.carried.includes(column.name as string);
	const order = [
		...bones.map((name) => ({
			column: body.spine[name] as Column,
			carried: spineCarried,
		})),
		...body.columns.map((column) => ({ column, carried: carries(column) })),
	];

	const placed: (Placed | null)[] = [];

	const rows = body.kind === "splice" ? placeRows(body) : null;
	let at = rows?.end ?? 0;

	for (const { column, carried } of order) {
		if (!carried) {
			placed.push(null);
			continue;
		}
		const laid = place(column, alignedTo4(at), body.trackCount);
		placed.push(laid.placed);
		at = laid.end;
	}
	const blobBytes = at;

	const describe = (index: number) =>
		headerColumnOf(order[index].column, placed[index]);
	const spine = Object.fromEntries(
		bones.map((name, index) => [name, describe(index)]),
	);

	const header = {
		kind: body.kind,
		structure: body.structure,
		revision: body.revision,
		...(body.since === undefined ? null : { since: body.since }),
		...(rows
			? {
					sinceStructure: body.sinceStructure,
					removed: rows.removedAt,
					inserted: rows.insertedAt,
				}
			: null),
		snapshotId: body.snapshotId ?? NO_SNAPSHOT,
		trackCount: body.trackCount,
		columns: body.columns.map((_, index) => describe(bones.length + index)),
		spine,
		...(body.kind === "snapshot"
			? {
					carried: body.columns
						.filter(carries)
						.map((column) => column.name as string),
					spineCarried,
				}
			: null),
	};

	const json = ENCODER.encode(JSON.stringify(header));
	const headerBytes = alignedTo4(BLOB_AT + json.length) - BLOB_AT;
	const blobAt = BLOB_AT + headerBytes;

	const out = new Uint8Array(blobAt + blobBytes);
	const view = new DataView(out.buffer);

	out.set(ENCODER.encode(MAGIC), 0);
	view.setUint32(4, headerBytes, true);
	out.set(json, BLOB_AT);
	out.fill(0x20, BLOB_AT + json.length, blobAt);

	if (rows) {
		writeIntegers(
			view,
			blobAt + rows.removedAt.offset,
			rows.removed,
			rows.removedAt.width,
		);
		writeIntegers(
			view,
			blobAt + rows.insertedAt.offset,
			rows.inserted,
			rows.insertedAt.width,
		);
	}

	for (const entry of placed) {
		if (entry === null) continue;
		writeIntegers(
			view,
			blobAt + entry.ids.offset,
			entry.column.ids,
			entry.ids.width,
		);
		if (entry.ordinals)
			writeIntegers(
				view,
				blobAt + entry.ordinals.offset,
				entry.column.ordinals as number[],
				entry.ordinals.width,
			);
		let textAt = blobAt + entry.textAt.offset;
		for (const bytes of entry.text) {
			out.set(bytes, textAt);
			textAt += bytes.length;
		}
		writeIntegers(
			view,
			blobAt + entry.endsAt.offset,
			entry.ends,
			entry.endsAt.width,
		);
	}

	return out;
}

// The validator `snapshotId` names, as *The validator* in `contract/openapi.yaml` defines it: the
// sum modulo 2^64 of an FNV-1a 64 term per cell, so a changed cell costs a subtraction and an
// addition.

export type Fold = [number, number];

export const emptyFold = (): Fold => [0, 0];

export interface FoldedColumn {
	prefix: 0x01 | 0x02;
	name: string;
}

export const declaredColumn = (name: string): FoldedColumn => ({
	prefix: 0x01,
	name,
});
export const spineColumn = (name: string): FoldedColumn => ({
	prefix: 0x02,
	name,
});

const BASIS_HIGH = 0xcbf29ce4;
const BASIS_LOW = 0x84222325;
const FNV_PRIME_LOW = 0x1b3;
const TWO_POW_32 = 4294967296;
const UNRESOLVED_BYTE = 0xff;
const UNRESOLVED_VALUE = "?";

let high = 0;
let low = 0;

// The prime is 2^40 + 0x1b3, so the product is the low half times 0x1b3 with its carry, plus the
// low half shifted into the high word by 8.
const feed = (byte: number) => {
	const xored = (low ^ byte) >>> 0;
	const product = xored * FNV_PRIME_LOW;
	high =
		(high * FNV_PRIME_LOW + Math.floor(product / TWO_POW_32) + (xored << 8)) >>>
		0;
	low = product >>> 0;
};

const feedText = (text: string) => {
	for (let at = 0; at < text.length; at += 1) {
		let code = text.charCodeAt(at);
		if (code < 0x80) feed(code);
		else if (code < 0x800) {
			feed(0xc0 | (code >> 6));
			feed(0x80 | (code & 0x3f));
		} else {
			if (code >= 0xd800 && code < 0xdc00 && at + 1 < text.length) {
				const next = text.charCodeAt(at + 1);
				if (next >= 0xdc00 && next < 0xe000) {
					code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
					at += 1;
				}
			}
			if (code >= 0x10000) {
				feed(0xf0 | (code >> 18));
				feed(0x80 | ((code >> 12) & 0x3f));
				feed(0x80 | ((code >> 6) & 0x3f));
				feed(0x80 | (code & 0x3f));
			} else {
				feed(0xe0 | (code >> 12));
				feed(0x80 | ((code >> 6) & 0x3f));
				feed(0x80 | (code & 0x3f));
			}
		}
	}
};

const begin = () => {
	high = BASIS_HIGH;
	low = BASIS_LOW;
};

const startColumn = ({ prefix, name }: FoldedColumn) => {
	begin();
	feed(prefix);
	feedText(name);
	feed(0x00);
	return [high, low] as const;
};

const finishCell = (
	started: readonly [number, number],
	ordinal: number,
	value: string,
) => {
	high = started[0];
	low = started[1];
	feedText(String(ordinal));
	feed(0x00);
	if (value === UNRESOLVED_VALUE) feed(UNRESOLVED_BYTE);
	else feedText(value);
};

const mulHigh = (a: number, b: number) => {
	const a0 = a & 0xffff;
	const a1 = a >>> 16;
	const b0 = b & 0xffff;
	const b1 = b >>> 16;
	const middle =
		((a0 * b0) >>> 16) + ((a1 * b0) & 0xffff) + ((a0 * b1) & 0xffff);
	return (
		(a1 * b1 + ((a1 * b0) >>> 16) + ((a0 * b1) >>> 16) + (middle >>> 16)) >>> 0
	);
};

// SplitMix64's finaliser over `[high, low]`, which keeps terms that differ in one bit of a last byte
// from cancelling in the sum.
const SPLITMIX = [
	{ shift: 30, high: 0xbf58476d, low: 0x1ce4e5b9 },
	{ shift: 27, high: 0x94d049bb, low: 0x133111eb },
] as const;

const mixed = (): [number, number] => {
	let h = high;
	let l = low;
	for (const { shift, high: ch, low: cl } of SPLITMIX) {
		l = (l ^ ((l >>> shift) | (h << (32 - shift)))) >>> 0;
		h = (h ^ (h >>> shift)) >>> 0;
		const product = mulHigh(l, cl);
		h = (product + Math.imul(h, cl) + Math.imul(l, ch)) >>> 0;
		l = Math.imul(l, cl) >>> 0;
	}
	l = (l ^ ((l >>> 31) | (h << 1))) >>> 0;
	h = (h ^ (h >>> 31)) >>> 0;
	return [h, l];
};

const add = (into: Fold, sign: 1 | -1) => {
	const [termHigh, termLow] = mixed();
	const sum = into[1] + sign * termLow;
	into[1] = sum >>> 0;
	into[0] = (into[0] + sign * termHigh + Math.floor(sum / TWO_POW_32)) >>> 0;
};

export function foldColumn(
	into: Fold,
	column: FoldedColumn,
	values: readonly string[],
	ids: ArrayLike<number>,
) {
	const started = startColumn(column);
	for (let ordinal = 0; ordinal < ids.length; ordinal += 1) {
		finishCell(started, ordinal, values[ids[ordinal]]);
		add(into, 1);
	}
}

export function foldCell(
	into: Fold,
	column: FoldedColumn,
	ordinal: number,
	value: string,
	sign: 1 | -1,
) {
	finishCell(startColumn(column), ordinal, value);
	add(into, sign);
}

export function snapshotIdOf(fold: Fold, trackCount: number) {
	begin();
	feed(0x03);
	feedText(String(trackCount));
	const total: Fold = [fold[0], fold[1]];
	add(total, 1);
	return total.map((half) => half.toString(16).padStart(8, "0")).join("");
}

const MASK_64 = (1n << 64n) - 1n;
const SPLITMIX_GAMMA = 0x9e3779b97f4a7c15n;

// SplitMix64 as `foo_jean` draws it.
function* splitMixDraws(seed: bigint): Generator<bigint, never, undefined> {
	let state = seed & MASK_64;
	for (;;) {
		state = (state + SPLITMIX_GAMMA) & MASK_64;
		let z = ((state ^ (state >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
		z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
		yield z ^ (z >> 31n);
	}
}

export function shuffledTail<T>(
	items: readonly T[],
	seed: bigint,
	keep: number,
): T[] {
	const shuffled = [...items];
	const draws = splitMixDraws(seed);
	for (
		let i = shuffled.length - 1;
		i >= Math.max(1, shuffled.length - keep);
		i -= 1
	) {
		const j = Number(draws.next().value % BigInt(i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled.slice(Math.max(0, shuffled.length - keep));
}
