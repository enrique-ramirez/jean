import assert from "node:assert/strict";
import test from "node:test";

import { OggDemuxer } from "../../src/domain/player/oggDemux.ts";

// A page carrying the given packets, laced the way libogg would: 255 for every whole
// segment a packet fills, then the remainder. A packet of exactly 255 bytes therefore ends
// with a zero-length segment, which is the case that catches naive readers.
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

// A packet whose first byte is a real Opus table of contents, so duration is read rather
// than assumed. Config 16 is CELT at 2.5 ms; the low two bits are the frame count code.
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

	// 300 bytes laces as 255 + 45, and libogg would end the page mid-packet.
	const long = packet(0x80, 300);
	const first = page([long.subarray(0, 255)]);
	// The continuation carries the rest with no packet boundary before it.
	const second = page([long.subarray(255)]);

	// Built by hand rather than by `page`, which always terminates its last packet.
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
	// config 1 is SILK narrowband at 20 ms; config 16 is CELT at 2.5 ms.
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

	// Code 1 is two frames of equal size, so 20 ms of config 1 is 40 ms of audio.
	const [only] = demuxer.push(page([packet((1 << 3) | 1, 30)]));

	assert.equal(only.duration, 40);
});
