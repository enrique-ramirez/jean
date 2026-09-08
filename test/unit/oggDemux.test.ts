import assert from "node:assert/strict";
import test from "node:test";

import { OggDemuxer } from "../../src/domain/player/oggDemux.ts";

function page(packets: Uint8Array[]): Uint8Array {
	const lacing: number[] = [];
	for (const packet of packets) {
		let left = packet.length;
		while (left >= 255) {
			lacing.push(255);
			left -= 255;
		}
		lacing.push(left);
	}

	const header = new Uint8Array(27 + lacing.length);
	header.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
	header[26] = lacing.length;
	header.set(lacing, 27);

	let length = 0;
	for (const packet of packets) length += packet.length;

	const out = new Uint8Array(header.length + length);
	out.set(header);
	let at = header.length;
	for (const packet of packets) {
		out.set(packet, at);
		at += packet.length;
	}
	return out;
}

const packet = (toc: number, length: number) =>
	Uint8Array.from({ length }, (_, i) => (i === 0 ? toc : i & 0xff));

const HEAD = packet(0, 19);
const TAGS = packet(0, 24);

test("the first two packets are held back as the headers", () => {
	const demuxer = new OggDemuxer();

	const packets = demuxer.push(page([HEAD, TAGS, packet(0x80, 40)]));

	assert.equal(demuxer.headers.length, 2);
	assert.equal(demuxer.headers[0].length, 19);
	assert.equal(demuxer.headers[1].length, 24);
	assert.equal(packets.length, 1);
	assert.equal(packets[0].data.length, 40);
});

test("a packet split across two pages is rejoined, not delivered twice", () => {
	const demuxer = new OggDemuxer();
	demuxer.push(page([HEAD, TAGS]));

	const long = packet(0x80, 300);
	const first = page([long.subarray(0, 255)]);
	const second = page([long.subarray(255)]);

	first[26] = 1;
	first[27] = 255;

	const fromFirst = demuxer.push(first);
	assert.equal(
		fromFirst.length,
		0,
		"an unterminated packet must not be emitted",
	);

	const fromSecond = demuxer.push(second);
	assert.equal(fromSecond.length, 1);
	assert.equal(fromSecond[0].data.length, 300);
});

test("a page arriving in pieces is held until it is whole", () => {
	const demuxer = new OggDemuxer();
	const whole = page([HEAD, TAGS, packet(0x80, 60)]);

	let delivered = 0;
	for (const byte of whole)
		delivered += demuxer.push(Uint8Array.of(byte)).length;

	assert.equal(delivered, 1);
});

test("bytes before the capture pattern are skipped rather than misread", () => {
	const demuxer = new OggDemuxer();
	const junk = Uint8Array.from([0x4f, 0x67, 0x67, 0x00, 0xff, 0x01]);
	const whole = page([HEAD, TAGS, packet(0x80, 40)]);

	const together = new Uint8Array(junk.length + whole.length);
	together.set(junk);
	together.set(whole, junk.length);

	assert.equal(demuxer.push(together).length, 1);
});

test("duration comes from the packet's own table of contents", () => {
	const cases: [number, number][] = [
		[1 << 3, 20],
		[(0 << 3) | 0, 10],
		[(3 << 3) | 0, 60],
		[(16 << 3) | 0, 2.5],
		[(19 << 3) | 0, 20],
	];

	for (const [toc, expected] of cases) {
		const demuxer = new OggDemuxer();
		demuxer.push(page([HEAD, TAGS]));
		const [only] = demuxer.push(page([packet(toc, 30)]));
		assert.equal(only.duration, expected, `config ${toc >> 3}`);
	}
});

test("a two-frame packet is worth two frames", () => {
	const demuxer = new OggDemuxer();
	demuxer.push(page([HEAD, TAGS]));

	const [only] = demuxer.push(page([packet((1 << 3) | 1, 30)]));

	assert.equal(only.duration, 40);
});
