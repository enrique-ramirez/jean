import assert from "node:assert/strict";
import test from "node:test";

import { initSegment, WebmMuxer } from "../../src/domain/player/webmMux.ts";

// A reader rather than a search for known byte runs: a scan finds its pattern inside a
// payload just as happily, and would pass on output no parser could read.

interface Node {
	id: string;
	payload: Uint8Array;
	children: Node[];
}

const MASTERS = new Set([
	"1a45dfa3", // EBML
	"18538067", // Segment
	"1549a966", // Info
	"1654ae6b", // Tracks
	"ae", // TrackEntry
	"e1", // Audio
	"1f43b675", // Cluster
]);

// A VINT is a length in leading zeros, then the value. Eight bytes wide at most, which the
// reserved unknown length uses in full.
function vintLength(first: number): number {
	for (let length = 1; length <= 8; length++)
		if (first >= 0x100 >> length) return length;
	return 8;
}

function readId(bytes: Uint8Array, at: number): [string, number] {
	const length = vintLength(bytes[at]);
	let id = "";
	for (let i = 0; i < length; i++)
		id += bytes[at + i].toString(16).padStart(2, "0");
	return [id, length];
}

// Returns -1 for the reserved all-ones length, which is how a live stream opens an element
// it cannot measure.
function readSize(bytes: Uint8Array, at: number): [number, number] {
	const length = vintLength(bytes[at]);

	let value = bytes[at] & (0xff >> length);
	let unknown = value === 0xff >> length;
	for (let i = 1; i < length; i++) {
		value = value * 256 + bytes[at + i];
		if (bytes[at + i] !== 0xff) unknown = false;
	}
	return [unknown ? -1 : value, length];
}

const CLUSTER = "1f43b675";

// An unknown-size Cluster ends where the next one starts; an unknown-size Segment runs to
// the end of what there is.
function endOfUnknown(bytes: Uint8Array, from: number, to: number, id: string) {
	if (id !== CLUSTER) return to;

	// Compared byte for byte rather than through `readId`, which would read a width past the
	// end of the range for any byte that happens to start a wide VINT.
	for (let at = from; at + 4 <= to; at++)
		if (
			bytes[at] === 0x1f &&
			bytes[at + 1] === 0x43 &&
			bytes[at + 2] === 0xb6 &&
			bytes[at + 3] === 0x75
		)
			return at;
	return to;
}

function parse(bytes: Uint8Array, from = 0, to = bytes.length): Node[] {
	const out: Node[] = [];
	let at = from;

	while (at < to) {
		const [id, idLength] = readId(bytes, at);
		const [size, sizeLength] = readSize(bytes, at + idLength);
		const start = at + idLength + sizeLength;
		const end = size < 0 ? endOfUnknown(bytes, start, to, id) : start + size;

		const node: Node = {
			id,
			payload: bytes.subarray(start, end),
			children: [],
		};
		if (MASTERS.has(id)) node.children = parse(bytes, start, end);
		out.push(node);

		at = end;
	}
	return out;
}

function find(nodes: Node[], id: string): Node | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		const deeper = find(node.children, id);
		if (deeper) return deeper;
	}
	return undefined;
}

const uint = (bytes: Uint8Array) =>
	bytes.reduce((total, b) => total * 256 + b, 0);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const OPUS_HEAD = Uint8Array.from([
	0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0, 0, 0x80, 0xbb, 0, 0,
	0, 0, 0,
]);

const track = { codecPrivate: OPUS_HEAD, sampleRate: 48000, channels: 2 };

test("the init segment is a webm a parser can walk", () => {
	const nodes = parse(initSegment(track));

	assert.equal(text(find(nodes, "4282")?.payload ?? new Uint8Array()), "webm");
	assert.equal(
		uint(find(nodes, "2ad7b1")?.payload ?? new Uint8Array()),
		1_000_000,
	);
});

test("the Segment is opened with an unknown length, because a live stream has no end", () => {
	const bytes = initSegment(track);
	const at = parse(bytes).findIndex((node) => node.id === "18538067");
	assert.ok(at >= 0, "no Segment");

	// Its id ends where its size begins, and that size must be the reserved all-ones.
	const start = bytes.indexOf(0x18);
	assert.equal(readSize(bytes, start + 4)[0], -1);
});

test("the track declares Opus, and carries the head it was given", () => {
	const nodes = parse(initSegment(track));

	assert.equal(text(find(nodes, "86")?.payload ?? new Uint8Array()), "A_OPUS");
	assert.deepEqual(find(nodes, "63a2")?.payload, OPUS_HEAD);
	assert.equal(uint(find(nodes, "83")?.payload ?? new Uint8Array()), 2);
	assert.equal(uint(find(nodes, "9f")?.payload ?? new Uint8Array()), 2);
});

// Without it a decoder has no idea how much to discard after a seek, and every flush leaves
// audible damage at the join.
test("SeekPreRoll is declared", () => {
	const nodes = parse(initSegment(track));

	assert.equal(
		uint(find(nodes, "56bb")?.payload ?? new Uint8Array()),
		80_000_000,
	);
});

test("nothing added is nothing to send", () => {
	assert.equal(new WebmMuxer().take(), null);
});

test("blocks carry the running timecode, and clusters restart the offset", () => {
	const muxer = new WebmMuxer();
	// 20 ms each, so three seconds is 150 packets and spans several clusters.
	for (let i = 0; i < 150; i++) muxer.add(Uint8Array.of(0x80, i & 0xff), 20);

	const nodes = parse(muxer.take() ?? new Uint8Array());
	const clusters = nodes.filter((node) => node.id === "1f43b675");

	assert.ok(
		clusters.length >= 3,
		`expected several clusters, got ${clusters.length}`,
	);

	let previous = -1;
	for (const cluster of clusters) {
		const timecode = uint(
			find(cluster.children, "e7")?.payload ?? new Uint8Array(),
		);
		assert.ok(timecode > previous, "cluster timecodes must only go up");
		previous = timecode;

		for (const block of cluster.children.filter((node) => node.id === "a3")) {
			// Track number, then a signed 16-bit offset from the cluster's own timecode.
			assert.equal(block.payload[0], 0x81);
			const offset = new DataView(
				block.payload.buffer,
				block.payload.byteOffset + 1,
				2,
			).getInt16(0);
			assert.ok(offset >= 0, "a block must not predate its cluster");
			assert.ok(
				offset < 32_768,
				"an offset that overflows is silent corruption",
			);
		}
	}
});

test("the muxer reports how much audio it has taken", () => {
	const muxer = new WebmMuxer();
	for (let i = 0; i < 10; i++) muxer.add(Uint8Array.of(0x80), 20);

	assert.equal(muxer.buffered, 200);
});
