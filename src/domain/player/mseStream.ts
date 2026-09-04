import { OggDemuxer } from "./oggDemux";
import { initSegment, WebmMuxer } from "./webmMux";

// Feeds the element through MSE instead of handing it a URL, which is the only way the
// buffer is ours: the browser decides how much to gather before it starts, and on a stream
// delivered at 1x every second of that is a second of lag for the whole session.

const MIME = 'audio/webm; codecs="opus"';

// What to gather before starting. The browser's own threshold is seconds; this is the number
// the spike exists to find, so it is one constant and not spread around.
const START_MS = 250;

// How much played audio to keep behind the playhead. Small enough to stay cheap, large
// enough that a removal never reaches what is about to be decoded.
const KEEP_BEHIND = 10;
const TRIM_EVERY_MS = 5000;

// How much of a stream to read before concluding it is not Ogg at all. The headers are the
// first thing the component sends, so this is generous rather than marginal -- and reaching
// it is the difference between falling back at once and a watchdog's worth of silence.
const NOT_OGG_BYTES = 16 * 1024;

export const canUseMse = () =>
	typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MIME);

export interface MseStream {
	// Revoked on stop, so the caller sets it as `src` and forgets it.
	src: string;
	stop: () => void;
	// Drops everything buffered and picks the stream back up at the live edge. What a seek
	// costs without this is the whole tail of the old position, played out in full.
	flush: () => void;
}

export function openMseStream(
	url: string,
	element: HTMLAudioElement,
	{
		onReady,
		onError,
		onUnusable,
	}: {
		onReady: () => void;
		// Retryable: the connection dropped, and another one may well work.
		onError: () => void;
		// Not retryable on this path: reconnecting would meet the same stream again.
		onUnusable: () => void;
	},
): MseStream {
	const media = new MediaSource();
	const src = URL.createObjectURL(media);

	const controller = new AbortController();
	let buffer: SourceBuffer | null = null;
	const muxer = new WebmMuxer();
	const demuxer = new OggDemuxer();

	const queue: Uint8Array[] = [];
	let started = false;
	let stopped = false;
	let trimTimer: ReturnType<typeof setInterval> | null = null;
	// Set by a flush: the playhead is standing in the hole the removal left, and the next
	// audio to arrive is what it should jump to.
	let resync = false;

	// SourceBuffer takes one append at a time and throws on the second, so everything goes
	// through here and waits for `updateend`.
	function pump() {
		if (!buffer || buffer.updating) return;

		// A flush leaves the playhead somewhere no longer buffered, and the element will sit
		// there waiting for audio that was deliberately thrown away.
		//
		// Waiting for a whole target's worth before jumping, rather than for the first byte:
		// landing on a buffer of a few milliseconds empties it again immediately, which
		// Firefox reports as two or three more stalls over the seconds that follow.
		if (resync && element.buffered.length > 0) {
			const ready =
				element.buffered.end(0) - element.buffered.start(0) >= START_MS / 1000;
			if (ready) {
				resync = false;
				element.currentTime = element.buffered.start(0);
			}
		}

		if (queue.length === 0) return;
		const next = queue.shift();
		if (!next) return;
		try {
			buffer.appendBuffer(next as BufferSource);
		} catch {
			// A full buffer or a torn-down source; the trim and the reconnect both cover it.
		}
	}

	function append(data: Uint8Array) {
		queue.push(data);
		pump();
	}

	function trim() {
		if (!buffer || buffer.updating || element.currentTime <= KEEP_BEHIND)
			return;
		try {
			buffer.remove(0, element.currentTime - KEEP_BEHIND);
		} catch {
			// Racing an append; the next tick tries again.
		}
	}

	media.addEventListener("sourceopen", () => {
		if (stopped) return;
		try {
			buffer = media.addSourceBuffer(MIME);
		} catch {
			onUnusable();
			return;
		}
		buffer.mode = "sequence";
		buffer.addEventListener("updateend", pump);
		trimTimer = setInterval(trim, TRIM_EVERY_MS);
		void read();
	});

	async function read() {
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok || !response.body) {
				onError();
				return;
			}

			const reader = response.body.getReader();

			for (;;) {
				const { done, value } = await reader.read();
				if (done || stopped) break;

				const packets = demuxer.push(value);

				// The first two packets off the stream are OpusHead and OpusTags. The head is
				// the container's CodecPrivate, so nothing can be muxed until it has arrived.
				if (!started && demuxer.headers.length >= 1) {
					append(
						initSegment({
							codecPrivate: demuxer.headers[0],
							sampleRate: 48000,
							channels: 2,
						}),
					);
					started = true;
				}

				if (!started) {
					if (demuxer.seen > NOT_OGG_BYTES) {
						onUnusable();
						return;
					}
					continue;
				}

				for (const packet of packets) muxer.add(packet.data, packet.duration);

				const chunk = muxer.take();
				if (chunk) append(chunk);

				if (muxer.buffered >= START_MS) onReady();
			}
		} catch {
			if (!stopped) onError();
		}
	}

	return {
		src,
		stop() {
			stopped = true;
			controller.abort();
			if (trimTimer) clearInterval(trimTimer);
			URL.revokeObjectURL(src);
		},
		// The demuxer and the muxer deliberately survive this. OpusHead arrives once, at the
		// top of the stream, so a demuxer started again mid-stream waits for a header that is
		// never coming and the pump goes quiet for good.
		flush() {
			if (!buffer) return;
			queue.length = 0;
			try {
				if (buffer.updating) buffer.abort();
				const ranges = element.buffered;
				if (ranges.length > 0)
					buffer.remove(0, ranges.end(ranges.length - 1) + 1);
				resync = true;
			} catch {
				// Nothing buffered to drop.
			}
		},
	};
}
