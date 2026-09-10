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

export interface Body {
	kind: "snapshot" | "delta";
	structure: number;
	revision: number;
	since?: number;
	trackCount: number;
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

	// Ordinals index rows rather than dictionary entries, so their width comes from a different number
	// than the ids' does.
	const ordinals = column.ordinals
		? {
				offset: alignedTo4(ids.offset + ids.count * ids.width),
				count: column.ordinals.length,
				width: widthFor(Math.max(0, trackCount - 1)),
			}
		: null;

	const after = ordinals
		? ordinals.offset + ordinals.count * ordinals.width
		: ids.offset + ids.count * ids.width;

	const textAt = { offset: alignedTo4(after), length: textBytes };
	const endsAt = {
		offset: alignedTo4(textAt.offset + textBytes),
		count: ends.length,
		width: widthFor(textBytes),
	};

	return {
		placed: { column, text, ids, ordinals, textAt, endsAt, ends },
		end: endsAt.offset + endsAt.count * endsAt.width,
	};
}

const headerColumnOf = ({ column, ids, ordinals, textAt, endsAt }: Placed) => ({
	...(column.name === null ? null : { name: column.name }),
	ids,
	...(ordinals ? { ordinals } : null),
	dict: {
		text: textAt,
		ends: endsAt,
		...(column.base === null ? null : { base: column.base }),
	},
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
		const laid = place(column, alignedTo4(at), body.trackCount);
		placed.push(laid.placed);
		at = laid.end;
	}
	const blobBytes = at;

	const spine = Object.fromEntries(
		bones.map((name, index) => [name, headerColumnOf(placed[index])]),
	);

	const header = {
		kind: body.kind,
		structure: body.structure,
		revision: body.revision,
		...(body.since === undefined ? null : { since: body.since }),
		trackCount: body.trackCount,
		columns: placed.slice(bones.length).map(headerColumnOf),
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
