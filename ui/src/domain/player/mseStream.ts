import { OggDemuxer } from "./oggDemux";
import { initSegment, WebmMuxer } from "./webmMux";

const MIME = 'audio/webm; codecs="opus"';

const START_MS = 250;

const KEEP_BEHIND = 10;
const TRIM_EVERY_MS = 5000;

// How much of a stream to read before concluding it is not Ogg at all. The component sends the
// headers first, so this is generous rather than marginal.
const NOT_OGG_BYTES = 16 * 1024;

export const canUseMse = () =>
	typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MIME);

export interface MseStream {
	src: string;
	stop: () => void;
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
		// Not retryable: reconnecting would meet the same stream again.
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
	let resync = false;

	// SourceBuffer takes one append at a time and throws on the second, so everything goes through
	// here and waits for `updateend`.
	function pump() {
		if (!buffer || buffer.updating) return;

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

				// The first two packets off the stream are OpusHead and OpusTags, and the head is the
				// container's CodecPrivate, so nothing can be muxed until it has arrived.
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
