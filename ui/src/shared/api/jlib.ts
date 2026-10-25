import type { components } from "./fooJeanSchema";

type RowsHeader = components["schemas"]["LibraryRowsHeader"];
type WireColumn = components["schemas"]["LibraryColumn"];
type WireDict = NonNullable<WireColumn["dict"]>;
type WireSection = components["schemas"]["LibrarySection"];

const MAGIC = "JLIB";
const BLOB_AT = 8;

export type Ids = Uint8Array | Uint16Array | Uint32Array;

export interface JlibDictionary {
	readonly count: number;
	readonly of: (id: number) => string;
}

export interface JlibColumn {
	readonly isLoaded: boolean;
	readonly ids: Ids;
	readonly distinct: number;
	readonly hasUnresolved: boolean;
	readonly allUnresolved: boolean;
	readonly value: (id: number) => string;
	readonly at: (row: number) => string;
}

export interface JlibSpine {
	readonly directory: JlibColumn;
	readonly filename: JlibColumn;
	readonly subsong: JlibColumn;
}

export interface JlibRows {
	readonly structure: number;
	readonly revision: number;
	readonly trackCount: number;
	readonly rows: number;
	readonly columns: ReadonlyMap<string, JlibColumn>;
	readonly spine: JlibSpine;
}

function refuse(what: string): never {
	throw new Error(`malformed JLIB: ${what}`);
}

const ASCII = new TextDecoder("ascii");
// A value that begins with U+FEFF keeps it: a decoder drops a leading byte order mark by default.
const UTF8 = new TextDecoder("utf-8", { ignoreBOM: true });

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
	text: WireDict["text"],
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
	id < dict.count ? dict.of(id) : "";

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
	return {
		isLoaded: true,
		ids,
		...facts,
		value,
		at: (row) => value(ids[row]),
	};
};

const NO_IDS = new Uint8Array(0);

export const unloadedColumn = (facts: ColumnFacts): JlibColumn => ({
	isLoaded: false,
	ids: NO_IDS,
	...facts,
	distinct: 0,
	value: () => "",
	at: () => "",
});

const factsOf = (column: WireColumn): ColumnFacts => ({
	distinct: column.distinct,
	hasUnresolved: column.hasUnresolved,
	allUnresolved: column.allUnresolved,
});

const dictionaryOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	dict: WireDict,
	blobBytes: number,
	what: string,
): JlibDictionary => {
	sectionFits(dict.ends, blobBytes, `${what} ends`);
	const text = textOf(buffer, blobAt, dict.text, blobBytes, what);
	const ends = sectionOf(buffer, blobAt, dict.ends);

	const decoded: (string | undefined)[] = new Array(dict.ends.count);

	return {
		count: dict.ends.count,
		of: (id) =>
			(decoded[id] ??= UTF8.decode(text.subarray(...spanOf(ends, id)))),
	};
};

const columnOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	column: WireColumn,
	blobBytes: number,
	what: string,
): JlibColumn => {
	const { ids, dict } = column;
	if (!ids || !dict) refuse(`${what} is not carried`);
	sectionFits(ids, blobBytes, `${what} ids`);
	return jlibColumn(
		sectionOf(buffer, blobAt, ids),
		dictionaryOf(buffer, blobAt, dict, blobBytes, what),
		factsOf(column),
	);
};

const headerOf = (
	buffer: ArrayBuffer,
): { header: RowsHeader; blobAt: number } => {
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
	const header = JSON.parse(text) as RowsHeader;
	if (header.kind !== "rows")
		refuse(`kind is ${String(header.kind)}, not rows`);

	return { header, blobAt };
};

const namesOf = (header: RowsHeader) =>
	header.columns.map(
		(column) => column.name ?? refuse("a column with no name"),
	);

export function decodeRows(buffer: ArrayBuffer): JlibRows {
	const { header, blobAt } = headerOf(buffer);
	const blobBytes = buffer.byteLength - blobAt;
	const { structure, revision, trackCount, rows } = header;

	const rowColumn = (wire: WireColumn, what: string) => {
		const column = columnOf(buffer, blobAt, wire, blobBytes, what);
		if (column.ids.length !== rows)
			refuse(`${what} has ${column.ids.length} ids for ${rows} rows`);
		return column;
	};

	return {
		structure,
		revision,
		trackCount,
		rows,
		columns: new Map(
			namesOf(header).map((name, at) => [
				name,
				rowColumn(header.columns[at], name),
			]),
		),
		spine: {
			directory: rowColumn(header.spine.directory, "directory"),
			filename: rowColumn(header.spine.filename, "filename"),
			subsong: rowColumn(header.spine.subsong, "subsong"),
		},
	};
}
