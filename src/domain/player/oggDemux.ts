// Pulls Opus packets back out of the Ogg stream the component serves, so they can be put
// into a container MSE will take. Ogg is not one of them, in any browser.

export interface OpusPacket {
	data: Uint8Array;
	// Milliseconds this packet is worth, read from its own table of contents rather than
	// assumed: the encoder's frame size is a constant today and need not stay one.
	duration: number;
}

// RFC 6716 section 3.1. The configuration number carries the frame size, and the low two
// bits say how many frames the packet holds.
function frameMs(toc: number): number {
	const config = toc >> 3;

	// SILK, then hybrid: four sizes, then two.
	if (config < 12) return [10, 20, 40, 60][config % 4];
	if (config < 16) return [10, 20][config % 2];

	// CELT, in groups of four across the four bandwidths.
	return [2.5, 5, 10, 20][config % 4];
}

function packetMs(packet: Uint8Array): number {
	if (packet.length === 0) return 0;

	const toc = packet[0];
	const code = toc & 3;
	const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;

	return frameMs(toc) * frames;
}

const CAPTURE = 0x4f676753; // "OggS"

// Feed it whatever arrives off the socket; it keeps what it cannot use yet.
//
// A packet may span pages, which is why segments are gathered rather than emitted per page:
// a segment of exactly 255 bytes says the packet continues into the next one.
export class OggDemuxer {
	private pending = new Uint8Array(0);
	private partial: Uint8Array[] = [];

	// OpusHead and OpusTags, the two packets the container needs before any audio.
	headers: Uint8Array[] = [];

	// Bytes handed over in total. The component sends the headers before anything else, so a
	// stream that has produced none of them after a while is not the one this can read.
	seen = 0;

	push(chunk: Uint8Array): OpusPacket[] {
		this.seen += chunk.length;
		const buffer = new Uint8Array(this.pending.length + chunk.length);
		buffer.set(this.pending);
		buffer.set(chunk, this.pending.length);

		const packets: OpusPacket[] = [];
		let at = 0;

		while (at + 27 <= buffer.length) {
			const view = new DataView(buffer.buffer, buffer.byteOffset);

			if (view.getUint32(at) !== CAPTURE) {
				at += 1;
				continue;
			}

			const segments = buffer[at + 26];
			const tableEnd = at + 27 + segments;
			if (tableEnd > buffer.length) break;

			const lacing = buffer.subarray(at + 27, tableEnd);
			let bodyLength = 0;
			for (const value of lacing) bodyLength += value;

			const pageEnd = tableEnd + bodyLength;
			if (pageEnd > buffer.length) break;

			let body = tableEnd;
			for (const value of lacing) {
				this.partial.push(buffer.subarray(body, body + value));
				body += value;

				// Anything short of 255 ends the packet; a run of 255s continues it.
				if (value === 255) continue;

				const whole = concat(this.partial);
				this.partial = [];
				if (whole.length === 0) continue;

				if (this.headers.length < 2) this.headers.push(whole);
				else packets.push({ data: whole, duration: packetMs(whole) });
			}

			at = pageEnd;
		}

		this.pending = buffer.slice(at);
		return packets;
	}
}

function concat(parts: Uint8Array[]): Uint8Array {
	if (parts.length === 1) return parts[0];

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
