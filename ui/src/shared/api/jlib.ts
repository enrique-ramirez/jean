import type { components } from "./fooJeanSchema";

type Header = components["schemas"]["LibraryHeader"];
type WireColumn = components["schemas"]["LibraryColumn"];
type WireSection = components["schemas"]["LibrarySection"];

const MAGIC = "JLIB";
const BLOB_AT = 8;

export type Ids = Uint8Array | Uint16Array | Uint32Array;

export interface JlibDictionary {
	readonly count: number;
	readonly of: (id: number) => string;
	readonly appended: readonly string[];
}

export interface JlibColumn {
	readonly ids: Ids;
	readonly dict: JlibDictionary;
	readonly distinct: number;
	readonly hasUnresolved: boolean;
	readonly allUnresolved: boolean;
	readonly value: (id: number) => string;
	readonly at: (row: number) => string;
}

export interface JlibPatch {
	readonly ordinals: Ids;
	readonly ids: Ids;
	readonly base: number;
	readonly appended: readonly string[];
	readonly distinct: number;
	readonly hasUnresolved: boolean;
	readonly allUnresolved: boolean;
}

export interface JlibSpine {
	readonly directory: JlibColumn;
	readonly filename: JlibColumn;
	readonly subsong: JlibColumn;
}

export interface JlibSnapshot {
	readonly kind: "snapshot";
	readonly structure: number;
	readonly revision: number;
	readonly trackCount: number;
	readonly columns: ReadonlyMap<string, JlibColumn>;
	readonly spine: JlibSpine;
}

export interface JlibDelta {
	readonly kind: "delta";
	readonly structure: number;
	readonly revision: number;
	readonly since: number;
	readonly trackCount: number;
	readonly columns: ReadonlyMap<string, JlibPatch>;
	readonly spine: readonly string[];
}

export type Jlib = JlibSnapshot | JlibDelta;

function refuse(what: string): never {
	throw new Error(`malformed JLIB: ${what}`);
}

const ASCII = new TextDecoder("ascii");
const UTF8 = new TextDecoder();

const sectionFits = (
	section: WireSection,
	blobBytes: number,
	what: string,
): void => {
	const { offset, count, width } = section;
	if (width !== 1 && width !== 2 && width !== 4)
		refuse(`${what} has a width of ${width}`);
	if (offset < 0 || offset % width !== 0)
		refuse(
			`${what} starts at ${offset}, which no typed array can be taken over`,
		);
	if (offset + count * width > blobBytes)
		refuse(`${what} runs past the end of the blob`);
};

const sectionOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	section: WireSection,
): Ids => {
	const at = blobAt + section.offset;
	if (section.width === 1) return new Uint8Array(buffer, at, section.count);
	if (section.width === 2) return new Uint16Array(buffer, at, section.count);
	return new Uint32Array(buffer, at, section.count);
};

const textOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	text: WireColumn["dict"]["text"],
	blobBytes: number,
	what: string,
) => {
	const { offset, length } = text;
	if (offset < 0 || offset + length > blobBytes)
		refuse(`${what} text runs past the end of the blob`);
	return new Uint8Array(buffer, blobAt + offset, length);
};

const spanOf = (ends: Ids, at: number) =>
	[at === 0 ? 0 : ends[at - 1], ends[at]] as const;

const columnValue = (dict: JlibDictionary) => (id: number) =>
	id < dict.count ? dict.of(id) : dict.appended[id - dict.count];

export interface ColumnFacts {
	readonly distinct: number;
	readonly hasUnresolved: boolean;
	readonly allUnresolved: boolean;
}

export const jlibColumn = (
	ids: Ids,
	dict: JlibDictionary,
	facts: ColumnFacts,
): JlibColumn => {
	const value = columnValue(dict);
	return { ids, dict, ...facts, value, at: (row) => value(ids[row]) };
};

const factsOf = (column: WireColumn): ColumnFacts => ({
	distinct: column.distinct,
	hasUnresolved: column.hasUnresolved,
	allUnresolved: column.allUnresolved,
});

const dictionaryOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	dict: WireColumn["dict"],
	blobBytes: number,
	what: string,
): JlibDictionary => {
	sectionFits(dict.ends, blobBytes, `${what} ends`);
	const text = textOf(buffer, blobAt, dict.text, blobBytes, what);
	const ends = sectionOf(buffer, blobAt, dict.ends);

	return {
		count: dict.ends.count,
		of: (id) => UTF8.decode(text.subarray(...spanOf(ends, id))),
		appended: [],
	};
};

const columnOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	column: WireColumn,
	blobBytes: number,
	what: string,
): JlibColumn => {
	sectionFits(column.ids, blobBytes, `${what} ids`);
	return jlibColumn(
		sectionOf(buffer, blobAt, column.ids),
		dictionaryOf(buffer, blobAt, column.dict, blobBytes, what),
		factsOf(column),
	);
};

const appendedOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	dict: WireColumn["dict"],
	blobBytes: number,
	what: string,
): string[] => {
	sectionFits(dict.ends, blobBytes, `${what} ends`);
	const text = textOf(buffer, blobAt, dict.text, blobBytes, what);
	const ends = sectionOf(buffer, blobAt, dict.ends);

	return Array.from({ length: ends.length }, (_, at) =>
		UTF8.decode(text.subarray(...spanOf(ends, at))),
	);
};

const patchOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	column: WireColumn,
	blobBytes: number,
	what: string,
): JlibPatch => {
	const { ordinals, dict } = column;
	if (!ordinals) refuse(`${what} carries no ordinals`);
	sectionFits(ordinals, blobBytes, `${what} ordinals`);
	sectionFits(column.ids, blobBytes, `${what} ids`);
	if (ordinals.count !== column.ids.count)
		refuse(
			`${what} has ${ordinals.count} ordinals for ${column.ids.count} ids`,
		);
	if (dict.base === undefined) refuse(`${what} carries no dictionary base`);

	return {
		ordinals: sectionOf(buffer, blobAt, ordinals),
		ids: sectionOf(buffer, blobAt, column.ids),
		base: dict.base,
		appended: appendedOf(buffer, blobAt, dict, blobBytes, what),
		...factsOf(column),
	};
};

const headerOf = (buffer: ArrayBuffer): { header: Header; blobAt: number } => {
	if (buffer.byteLength < BLOB_AT) refuse("shorter than its own framing");

	const framing = new DataView(buffer);
	if (ASCII.decode(new Uint8Array(buffer, 0, MAGIC.length)) !== MAGIC)
		refuse("the magic number is not JLIB");

	const headerBytes = framing.getUint32(4, true);
	const blobAt = BLOB_AT + headerBytes;
	if (blobAt > buffer.byteLength) refuse("the header runs past the end");
	if (blobAt % 4 !== 0)
		refuse(`the blob starts at ${blobAt}, which is not a multiple of four`);

	const text = UTF8.decode(new Uint8Array(buffer, BLOB_AT, headerBytes));
	const header = JSON.parse(text) as Header;
	if (header.kind !== "snapshot" && header.kind !== "delta")
		refuse(`kind is ${String(header.kind)}`);

	return { header, blobAt };
};

const spineOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	spine: Header["spine"],
	blobBytes: number,
): JlibSpine => {
	const bone = (name: keyof Header["spine"]) => {
		const column = spine[name];
		if (!column) refuse(`the spine carries no ${name}`);
		return columnOf(buffer, blobAt, column, blobBytes, name);
	};

	return {
		directory: bone("directory"),
		filename: bone("filename"),
		subsong: bone("subsong"),
	};
};

const namesOf = (header: Header) =>
	header.columns.map(
		(column) => column.name ?? refuse("a column with no name"),
	);

export function decodeJlib(buffer: ArrayBuffer): Jlib {
	const { header, blobAt } = headerOf(buffer);
	const blobBytes = buffer.byteLength - blobAt;
	const names = namesOf(header);
	const { kind, structure, revision, trackCount } = header;

	if (kind === "delta")
		return {
			kind,
			structure,
			revision,
			since: header.since ?? refuse("a delta with no since"),
			trackCount,
			columns: new Map(
				names.map((name, at) => [
					name,
					patchOf(buffer, blobAt, header.columns[at], blobBytes, name),
				]),
			),
			spine: Object.keys(header.spine),
		};

	return {
		kind,
		structure,
		revision,
		trackCount,
		columns: new Map(
			names.map((name, at) => [
				name,
				columnOf(buffer, blobAt, header.columns[at], blobBytes, name),
			]),
		),
		spine: spineOf(buffer, blobAt, header.spine, blobBytes),
	};
}

const widthFor = (largest: number) =>
	largest <= 0xff ? 1 : largest <= 0xffff ? 2 : 4;

const idsOfWidth = (width: number, length: number): Ids =>
	width === 1
		? new Uint8Array(length)
		: width === 2
			? new Uint16Array(length)
			: new Uint32Array(length);

const owned = (held: Ids, distinct: number): Ids => {
	const width = Math.max(
		held.BYTES_PER_ELEMENT,
		widthFor(Math.max(0, distinct - 1)),
	);
	const ids = idsOfWidth(width, held.length);
	ids.set(held);
	return ids;
};

export function patchColumn(
	held: JlibColumn,
	patch: JlibPatch,
): JlibColumn | null {
	if (patch.base !== held.distinct) return null;

	const ids = owned(held.ids, patch.distinct);
	for (let at = 0; at < patch.ordinals.length; at += 1) {
		const ordinal = patch.ordinals[at];
		if (ordinal >= ids.length) return null;
		ids[ordinal] = patch.ids[at];
	}

	const { dict } = held;
	return jlibColumn(
		ids,
		{
			count: dict.count,
			of: dict.of,
			appended:
				patch.appended.length === 0
					? dict.appended
					: [...dict.appended, ...patch.appended],
		},
		{
			distinct: patch.distinct,
			hasUnresolved: patch.hasUnresolved,
			allUnresolved: patch.allUnresolved,
		},
	);
}
