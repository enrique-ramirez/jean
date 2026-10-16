import type { ColumnFacts, Ids, JlibColumn } from "./jlib";

const MAGIC = "JLIB";
const BLOB_AT = 8;

const ENCODER = new TextEncoder();

const alignedTo4 = (at: number) => (at + 3) & ~3;

const widthFor = (largest: number) =>
	largest <= 0xff ? 1 : largest <= 0xffff ? 2 : 4;

const idsOver = (
	buffer: ArrayBuffer,
	at: number,
	count: number,
	width: number,
) =>
	width === 1
		? new Uint8Array(buffer, at, count)
		: width === 2
			? new Uint16Array(buffer, at, count)
			: new Uint32Array(buffer, at, count);

export interface EncodedSnapshot {
	structure: number;
	revision: number;
	snapshotId: string;
	trackCount: number;
	columns: readonly { name: string; column: JlibColumn }[];
	spine: Readonly<Record<"directory" | "filename" | "subsong", JlibColumn>>;
}

interface Laid {
	ids: { offset: number; count: number; width: number };
	text: { offset: number; length: number };
	ends: { offset: number; count: number; width: number };
	values: Uint8Array[];
	column: JlibColumn;
}

const factsOf = ({
	distinct,
	hasUnresolved,
	allUnresolved,
}: ColumnFacts): ColumnFacts => ({ distinct, hasUnresolved, allUnresolved });

export function encodedSnapshot(snapshot: EncodedSnapshot): ArrayBuffer {
	const entries = [
		snapshot.spine.directory,
		snapshot.spine.filename,
		snapshot.spine.subsong,
		...snapshot.columns.map(({ column }) => column),
	];

	let at = 0;
	const laid = entries.map((column): Laid => {
		const values = Array.from({ length: column.distinct }, (_, id) =>
			ENCODER.encode(column.value(id)),
		);
		const textBytes = values.reduce((sum, bytes) => sum + bytes.length, 0);

		const ids = {
			offset: alignedTo4(at),
			count: column.ids.length,
			width: widthFor(Math.max(0, column.distinct - 1)),
		};
		const text = {
			offset: alignedTo4(ids.offset + ids.count * ids.width),
			length: textBytes,
		};
		const ends = {
			offset: alignedTo4(text.offset + textBytes),
			count: values.length,
			width: widthFor(textBytes),
		};
		at = ends.offset + ends.count * ends.width;
		return { ids, text, ends, values, column };
	});
	const blobBytes = at;

	const describe = (index: number) => ({
		ids: laid[index].ids,
		dict: { text: laid[index].text, ends: laid[index].ends },
		...factsOf(laid[index].column),
	});
	const header = {
		kind: "snapshot",
		structure: snapshot.structure,
		revision: snapshot.revision,
		snapshotId: snapshot.snapshotId,
		trackCount: snapshot.trackCount,
		columns: snapshot.columns.map(({ name }, index) => ({
			name,
			...describe(3 + index),
		})),
		spine: {
			directory: describe(0),
			filename: describe(1),
			subsong: describe(2),
		},
		carried: snapshot.columns.map(({ name }) => name),
		spineCarried: true,
	};

	const json = ENCODER.encode(JSON.stringify(header));
	const headerBytes = alignedTo4(BLOB_AT + json.length) - BLOB_AT;
	const blobAt = BLOB_AT + headerBytes;

	const out = new Uint8Array(blobAt + blobBytes);
	new DataView(out.buffer).setUint32(4, headerBytes, true);
	out.set(ENCODER.encode(MAGIC), 0);
	out.set(json, BLOB_AT);
	out.fill(0x20, BLOB_AT + json.length, blobAt);

	for (const { ids, text, ends, values, column } of laid) {
		idsOver(out.buffer, blobAt + ids.offset, ids.count, ids.width).set(
			column.ids as Ids,
		);

		const endsOver = idsOver(
			out.buffer,
			blobAt + ends.offset,
			ends.count,
			ends.width,
		);
		let written = 0;
		values.forEach((bytes, id) => {
			out.set(bytes, blobAt + text.offset + written);
			written += bytes.length;
			endsOver[id] = written;
		});
	}

	return out.buffer;
}
