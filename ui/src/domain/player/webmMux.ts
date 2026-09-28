// The smallest WebM that MSE will accept. Chrome and Firefox both take
// `audio/webm; codecs="opus"`, and neither takes Ogg.

// Timecodes are milliseconds, so a cluster's own 16-bit block offsets reach half a minute.
const TIMECODE_SCALE_NS = 1_000_000;

// Opus needs 80 ms of audio decoded before the output is right and the container is where that is
// declared. A player that trusts a missing value glitches after every seek.
const SEEK_PREROLL_NS = 80_000_000;

const CLUSTER_MS = 1000;

// RFC 7845 section 5.1: OpusHead carries the pre-skip at byte 10, little-endian, counted at 48 kHz
// whatever the source rate. Matroska's Opus mapping declares the same delay as CodecDelay.
const OPUS_CLOCK_HZ = 48_000;

function codecDelayNs(head: Uint8Array): number {
	const preSkip = (head[10] ?? 0) | ((head[11] ?? 0) << 8);
	return Math.round((preSkip * 1_000_000_000) / OPUS_CLOCK_HZ);
}

const bytes = (...values: number[]) => Uint8Array.from(values);

// An EBML size is a length in unary followed by the value. Only the widths this needs.
function size(value: number): Uint8Array {
	if (value < 0x7f) return bytes(0x80 | value);
	if (value < 0x3fff) return bytes(0x40 | (value >> 8), value & 0xff);
	if (value < 0x1fffff)
		return bytes(0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff);
	return bytes(
		0x10 | (value >> 24),
		(value >> 16) & 0xff,
		(value >> 8) & 0xff,
		value & 0xff,
	);
}

function element(id: number[], payload: Uint8Array): Uint8Array {
	return join(Uint8Array.from(id), size(payload.length), payload);
}

function uint(value: number): Uint8Array {
	const out: number[] = [];
	let left = value;
	do {
		out.unshift(left & 0xff);
		left = Math.floor(left / 256);
	} while (left > 0);
	return Uint8Array.from(out);
}

function float64(value: number): Uint8Array {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setFloat64(0, value);
	return out;
}

const text = (value: string) => new TextEncoder().encode(value);

function join(...parts: Uint8Array[]): Uint8Array {
	let length = 0;
	for (const part of parts) length += part.length;

	const out = new Uint8Array(length);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

export interface WebmTrack {
	codecPrivate: Uint8Array;
	sampleRate: number;
	channels: number;
}

// Everything MSE wants before any media. The Segment is opened with the reserved unknown length: a
// live stream has no end to measure, and a length written and then outgrown is what breaks.
export function initSegment({
	codecPrivate,
	sampleRate,
	channels,
}: WebmTrack): Uint8Array {
	const header = element(
		[0x1a, 0x45, 0xdf, 0xa3],
		join(
			element([0x42, 0x86], uint(1)), // EBMLVersion
			element([0x42, 0xf7], uint(1)), // EBMLReadVersion
			element([0x42, 0xf2], uint(4)), // EBMLMaxIDLength
			element([0x42, 0xf3], uint(8)), // EBMLMaxSizeLength
			element([0x42, 0x82], text("webm")), // DocType
			element([0x42, 0x87], uint(2)), // DocTypeVersion
			element([0x42, 0x85], uint(2)), // DocTypeReadVersion
		),
	);

	const info = element(
		[0x15, 0x49, 0xa9, 0x66],
		join(
			element([0x2a, 0xd7, 0xb1], uint(TIMECODE_SCALE_NS)),
			element([0x4d, 0x80], text("jean")),
			element([0x57, 0x41], text("jean")),
		),
	);

	const audio = element(
		[0xe1],
		join(element([0xb5], float64(sampleRate)), element([0x9f], uint(channels))),
	);

	const track = element(
		[0xae],
		join(
			element([0xd7], uint(1)), // TrackNumber
			element([0x73, 0xc5], uint(1)), // TrackUID
			element([0x83], uint(2)), // TrackType: audio
			element([0x86], text("A_OPUS")), // CodecID
			element([0x63, 0xa2], codecPrivate),
			element([0x56, 0xaa], uint(codecDelayNs(codecPrivate))), // CodecDelay
			element([0x56, 0xbb], uint(SEEK_PREROLL_NS)),
			audio,
		),
	);

	const tracks = element([0x16, 0x54, 0xae, 0x6b], track);

	const segment = bytes(
		0x18,
		0x53,
		0x80,
		0x67,
		0x01,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
	);

	return join(header, segment, info, tracks);
}

export class WebmMuxer {
	private elapsed = 0;
	private clusterAt = -1;
	private parts: Uint8Array[] = [];

	get buffered(): number {
		return this.elapsed;
	}

	add(packet: Uint8Array, duration: number): void {
		if (this.clusterAt < 0 || this.elapsed - this.clusterAt >= CLUSTER_MS) {
			this.clusterAt = Math.round(this.elapsed);
			this.parts.push(
				// A cluster is opened unknown-size too, so blocks can be appended without going back to
				// write a length.
				bytes(
					0x1f,
					0x43,
					0xb6,
					0x75,
					0x01,
					0xff,
					0xff,
					0xff,
					0xff,
					0xff,
					0xff,
					0xff,
				),
				element([0xe7], uint(this.clusterAt)),
			);
		}

		const offset = new Uint8Array(2);
		new DataView(offset.buffer).setInt16(
			0,
			Math.round(this.elapsed) - this.clusterAt,
		);

		// Track 1, the offset, then keyframe: every Opus packet is one.
		const block = join(bytes(0x81), offset, bytes(0x80), packet);
		this.parts.push(element([0xa3], block));

		this.elapsed += duration;
	}

	take(): Uint8Array | null {
		if (this.parts.length === 0) return null;
		const out = join(...this.parts);
		this.parts = [];
		return out;
	}
}
