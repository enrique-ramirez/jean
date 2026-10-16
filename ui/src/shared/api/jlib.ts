import type { components } from "./fooJeanSchema";

type Header = components["schemas"]["LibraryHeader"];
type WireColumn = components["schemas"]["LibraryColumn"];
type WireDict = NonNullable<WireColumn["dict"]>;
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
	readonly isLoaded: boolean;
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
	readonly snapshotId: string;
	readonly trackCount: number;
	readonly columns: ReadonlyMap<string, JlibColumn>;
	readonly spine: JlibSpine;
}

export interface JlibDelta {
	readonly kind: "delta";
	readonly structure: number;
	readonly revision: number;
	readonly snapshotId: string;
	readonly since: number;
	readonly trackCount: number;
	readonly columns: ReadonlyMap<string, JlibPatch>;
	readonly spine: readonly string[];
}

export const SPINE_NAMES = ["directory", "filename", "subsong"] as const;

export type SpineName = (typeof SPINE_NAMES)[number];

export interface SpliceRows {
	readonly removed: Ids;
	readonly inserted: Ids;
}

export interface JlibSplice extends SpliceRows {
	readonly kind: "splice";
	readonly structure: number;
	readonly revision: number;
	readonly snapshotId: string;
	readonly since: number;
	readonly sinceStructure: number;
	readonly trackCount: number;
	readonly columns: ReadonlyMap<string, JlibPatch>;
	readonly spine: ReadonlyMap<SpineName, JlibPatch>;
}

export type Jlib = JlibSnapshot | JlibDelta | JlibSplice;

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
	return {
		isLoaded: true,
		ids,
		dict,
		...facts,
		value,
		at: (row) => value(ids[row]),
	};
};

const NO_IDS = new Uint8Array(0);

const NO_ENTRIES: JlibDictionary = { count: 0, of: () => "", appended: [] };

export const unloadedColumn = (facts: ColumnFacts): JlibColumn => ({
	isLoaded: false,
	ids: NO_IDS,
	dict: NO_ENTRIES,
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
	const { ids, dict } = column;
	if (!ids || !dict) refuse(`${what} is not carried`);
	sectionFits(ids, blobBytes, `${what} ids`);
	return jlibColumn(
		sectionOf(buffer, blobAt, ids),
		dictionaryOf(buffer, blobAt, dict, blobBytes, what),
		factsOf(column),
	);
};

const appendedOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	dict: WireDict,
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
	const { ordinals, ids, dict } = column;
	if (!ordinals) refuse(`${what} carries no ordinals`);
	if (!ids || !dict) refuse(`${what} is not carried`);
	sectionFits(ordinals, blobBytes, `${what} ordinals`);
	sectionFits(ids, blobBytes, `${what} ids`);
	if (ordinals.count !== ids.count)
		refuse(`${what} has ${ordinals.count} ordinals for ${ids.count} ids`);
	if (dict.base === undefined) refuse(`${what} carries no dictionary base`);

	return {
		ordinals: sectionOf(buffer, blobAt, ordinals),
		ids: sectionOf(buffer, blobAt, ids),
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
	if (
		header.kind !== "snapshot" &&
		header.kind !== "delta" &&
		header.kind !== "splice"
	)
		refuse(`kind is ${String(header.kind)}`);

	return { header, blobAt };
};

const spineOf = (
	buffer: ArrayBuffer,
	blobAt: number,
	header: Header,
	blobBytes: number,
): JlibSpine => {
	const bone = (name: keyof Header["spine"]) => {
		const column = header.spine[name];
		if (!column) refuse(`the spine carries no ${name}`);
		if (header.spineCarried === false) return unloadedColumn(factsOf(column));
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
	const { kind, structure, revision, snapshotId, trackCount } = header;

	if (kind === "splice") {
		const { removed, inserted } = header;
		if (!removed || !inserted) refuse("a splice with no removed or inserted");
		sectionFits(removed, blobBytes, "removed");
		sectionFits(inserted, blobBytes, "inserted");

		return {
			kind,
			structure,
			revision,
			snapshotId,
			since: header.since ?? refuse("a splice with no since"),
			sinceStructure:
				header.sinceStructure ?? refuse("a splice with no sinceStructure"),
			trackCount,
			removed: sectionOf(buffer, blobAt, removed),
			inserted: sectionOf(buffer, blobAt, inserted),
			columns: new Map(
				names.map((name, at) => [
					name,
					patchOf(buffer, blobAt, header.columns[at], blobBytes, name),
				]),
			),
			spine: new Map(
				SPINE_NAMES.flatMap((name) => {
					const column = header.spine[name];
					return column
						? [
								[
									name,
									patchOf(buffer, blobAt, column, blobBytes, name),
								] as const,
							]
						: [];
				}),
			),
		};
	}

	if (kind === "delta")
		return {
			kind,
			structure,
			revision,
			snapshotId,
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

	const carried = header.carried ? new Set(header.carried) : null;

	return {
		kind,
		structure,
		revision,
		snapshotId,
		trackCount,
		columns: new Map(
			names.map((name, at) => [
				name,
				carried && !carried.has(name)
					? unloadedColumn(factsOf(header.columns[at]))
					: columnOf(buffer, blobAt, header.columns[at], blobBytes, name),
			]),
		),
		spine: spineOf(buffer, blobAt, header, blobBytes),
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

function copySpliced(held: Ids, into: Ids, { removed, inserted }: SpliceRows) {
	let from = 0;
	let to = 0;
	let drop = 0;
	let put = 0;
	while (to < into.length) {
		if (put < inserted.length && inserted[put] === to) {
			put += 1;
			to += 1;
		} else if (drop < removed.length && removed[drop] === from) {
			drop += 1;
			from += 1;
		} else {
			const untilDrop = drop < removed.length ? removed[drop] - from : Infinity;
			const untilPut = put < inserted.length ? inserted[put] - to : Infinity;
			const run = Math.min(
				untilDrop,
				untilPut,
				into.length - to,
				held.length - from,
			);
			if (run <= 0) return false;
			(into as Uint32Array).set(
				held.subarray(from, from + run) as Uint32Array,
				to,
			);
			from += run;
			to += run;
		}
	}
	return from + (removed.length - drop) === held.length;
}

function appendedTo(dict: JlibDictionary, patch: JlibPatch): JlibDictionary {
	return {
		count: dict.count,
		of: dict.of,
		appended:
			patch.appended.length === 0
				? dict.appended
				: [...dict.appended, ...patch.appended],
	};
}

const factsOfPatch = (patch: JlibPatch): ColumnFacts => ({
	distinct: patch.distinct,
	hasUnresolved: patch.hasUnresolved,
	allUnresolved: patch.allUnresolved,
});

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

	return jlibColumn(ids, appendedTo(held.dict, patch), factsOfPatch(patch));
}

export function splicedColumn(
	held: JlibColumn,
	patch: JlibPatch | undefined,
	rows: SpliceRows,
): JlibColumn | null {
	if (!patch && rows.inserted.length > 0) return null;
	if (patch && patch.base !== held.distinct) return null;

	const length = held.ids.length - rows.removed.length + rows.inserted.length;
	const ids = idsOfWidth(
		Math.max(
			held.ids.BYTES_PER_ELEMENT,
			widthFor(Math.max(0, (patch?.distinct ?? held.distinct) - 1)),
		),
		length,
	);
	if (!copySpliced(held.ids, ids, rows)) return null;
	if (!patch)
		return jlibColumn(ids, held.dict, {
			distinct: held.distinct,
			hasUnresolved: held.hasUnresolved,
			allUnresolved: held.allUnresolved,
		});

	for (let at = 0; at < patch.ordinals.length; at += 1) {
		const ordinal = patch.ordinals[at];
		if (ordinal >= length) return null;
		ids[ordinal] = patch.ids[at];
	}

	return jlibColumn(ids, appendedTo(held.dict, patch), factsOfPatch(patch));
}
