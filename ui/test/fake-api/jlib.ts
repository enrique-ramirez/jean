// The binary library format, from the encoding side. `contract/openapi.yaml` is the shape and
// `../../src/shared/api/jlib.ts` reads it back.

import { CHUNK, mapped, runToEnd, type Sweep, sorted } from "./yielding.ts";

const MAGIC = "JLIB";
const BLOB_AT = 8;

const ENCODER = new TextEncoder();

export const UNRESOLVED = "?";

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

export function* sortedDictionarySweep(
	values: readonly string[],
): Sweep<Dictionary> {
	const distinct = new Set<string>();
	for (let at = 0; at < values.length; at += 1) {
		distinct.add(values[at]);
		if (at % CHUNK === CHUNK - 1) yield;
	}
	const ordered = yield* sorted([...distinct], compareUtf8);
	const made = dictionary();
	for (let at = 0; at < ordered.length; at += 1) {
		made.id(ordered[at]);
		if (at % CHUNK === CHUNK - 1) yield;
	}
	return made;
}

export const sortedDictionary = (values: readonly string[]): Dictionary =>
	runToEnd(sortedDictionarySweep(values));

export interface Column {
	name: string | null;
	ids: number[];
	appended: string[];
	distinct: number;
	hasUnresolved: boolean;
	allUnresolved: boolean;
}

const factsOf = (values: string[]) => ({
	appended: values,
	distinct: values.length,
	hasUnresolved: values.includes(UNRESOLVED),
	allUnresolved: values.length === 1 && values[0] === UNRESOLVED,
});

/** One id per row, and the whole dictionary. */
export function* wholeColumnSweep(
	name: string | null,
	dict: Dictionary,
	values: string[],
): Sweep<Column> {
	const ids = yield* mapped(values, (value) => dict.id(value));
	return { name, ids, ...factsOf(dict.values) };
}

export const wholeColumn = (
	name: string | null,
	dict: Dictionary,
	values: string[],
): Column => runToEnd(wholeColumnSweep(name, dict, values));

export const windowOfValues = (
	name: string | null,
	values: readonly string[],
	facts: Pick<Column, "distinct" | "hasUnresolved" | "allUnresolved">,
): Column => {
	const distinct = [...new Set(values)].sort(compareUtf8);
	const rank = new Map(distinct.map((value, at) => [value, at]));
	return {
		name,
		ids: values.map((value) => rank.get(value) as number),
		appended: distinct,
		...facts,
	};
};

export interface Spine {
	directory?: Column;
	filename?: Column;
	subsong?: Column;
}

export interface Body {
	kind: "delta" | "rows";
	structure: number;
	revision: number;
	trackCount: number;
	rows?: number;
	columns: Column[];
	spine: Spine;
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
	textAt: { offset: number; length: number };
	endsAt: Section;
	ends: number[];
}

function place(column: Column, at: number): { placed: Placed; end: number } {
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
		width: widthFor(Math.max(0, column.appended.length - 1)),
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

	return {
		placed: { column, text, ids, textAt, endsAt, ends },
		end: endsAt.offset + endsAt.count * endsAt.width,
	};
}

const headerColumnOf = (column: Column, laid: Placed) => ({
	...(column.name === null ? null : { name: column.name }),
	ids: laid.ids,
	dict: { text: laid.textAt, ends: laid.endsAt },
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

export function encodeJlib(body: Body): Uint8Array<ArrayBuffer> {
	const bones = SPINE.filter((name) => body.spine[name]);
	const order = [
		...bones.map((name) => body.spine[name] as Column),
		...body.columns,
	];

	const placed: Placed[] = [];
	let at = 0;

	for (const column of order) {
		const laid = place(column, alignedTo4(at));
		placed.push(laid.placed);
		at = laid.end;
	}
	const blobBytes = at;

	const describe = (index: number) =>
		headerColumnOf(order[index], placed[index]);
	const spine = Object.fromEntries(
		bones.map((name, index) => [name, describe(index)]),
	);

	const header = {
		kind: body.kind,
		structure: body.structure,
		revision: body.revision,
		...(body.kind === "rows" ? { rows: body.rows } : null),
		trackCount: body.trackCount,
		columns: body.columns.map((_, index) => describe(bones.length + index)),
		spine,
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

	for (const entry of placed) {
		writeIntegers(
			view,
			blobAt + entry.ids.offset,
			entry.column.ids,
			entry.ids.width,
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
