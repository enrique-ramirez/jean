import type { FooJeanDiscovery } from "@/shared/api/discovery";
import type { StreamMark } from "@/shared/api/stream";
import { clamp } from "@/shared/lib/math";

import { canUseMse } from "./mseSupport";

// A browser's `canPlayType` answers `''`, `'maybe'` or `'probably'`, only `''` is definite, and it can
// be wrong either way. Bare `audio/ogg` can answer for Vorbis alone, so the codec is named.
const MIME: Record<string, string[]> = {
	opus: ['audio/ogg; codecs="opus"'],
	aac: ["audio/aac", "audio/aacp"],
};

let probe: HTMLAudioElement | null = null;

export const playsNatively = (format: string) => {
	probe ??= document.createElement("audio");
	const types = MIME[format];
	if (!types) return false;
	return types.some((type) => probe?.canPlayType(type) !== "");
};

// Safari takes WebM/Opus through Media Source Extensions while refusing Opus in an element, and plays
// no Opus at all before 18.4.
const isPlayable = (format: string) =>
	playsNatively(format) || (format === "opus" && canUseMse());

export const playableFormats = (offered: readonly string[] | undefined) =>
	(offered ?? []).filter(isPlayable);

export interface ListenTarget {
	origin: string;
	formats: string[];
	session: string | null;
}

export interface Listener {
	canListen: boolean;
	formats: string[];
	target: ListenTarget | null;
}

const NO_LISTENER: Listener = {
	canListen: false,
	formats: [],
	target: null,
};

// `canStream` absent means false: an older foo_jean does not carry the field.
export function resolveListener({ state, origin }: FooJeanDiscovery): Listener {
	if (state.kind !== "ready" || !origin) return NO_LISTENER;
	if (!state.capabilities.canStream) return NO_LISTENER;

	const formats = playableFormats(state.capabilities.streamFormats);
	if (formats.length === 0) return NO_LISTENER;

	return {
		canListen: true,
		formats,
		target: { origin, formats, session: null },
	};
}

export const anchorOf = (streamTimeAtConnect: number, bufferedStart: number) =>
	streamTimeAtConnect - bufferedStart;

export interface StreamReading {
	streamTime: number;
	readAt: number;
}

export const streamTimeAt = (reading: StreamReading, at: number) =>
	reading.streamTime + (at - reading.readAt) / 1000;

// Wall time since connecting minus audio played, rather than a measured buffer depth: no browser
// reports the bytes still in the socket.
export const lagSeconds = (
	reading: StreamReading,
	anchor: number,
	currentTime: number,
	now: number,
) => streamTimeAt(reading, now) - (anchor + currentTime);

// A browser starts `currentTime` at zero or at the stream's granule position, and `buffered.start(0)`
// is whichever it chose.
export const bufferedStart = (audio: HTMLAudioElement) =>
	audio.buffered.length > 0 ? audio.buffered.start(0) : null;

export const bufferedAhead = (audio: HTMLAudioElement) => {
	const ranges = audio.buffered;
	return ranges.length > 0
		? ranges.end(ranges.length - 1) - audio.currentTime
		: 0;
};

// `foo_jean` publishes the same display path on a stream mark and on the poll's `player.path`. A join
// that fails shows nothing: every correction silently turns off.
export const samePlayerPath = (
	left: string | null | undefined,
	right: string | null | undefined,
) =>
	Boolean(left) &&
	Boolean(right) &&
	left?.replaceAll("\\", "/").toLowerCase() ===
		right?.replaceAll("\\", "/").toLowerCase();

export function audibleMark(
	anchor: number | null,
	marks: readonly StreamMark[],
	currentTime: number,
): StreamMark | null {
	if (anchor === null) return null;
	const audible = anchor + currentTime;
	return marks.findLast((entry) => entry.at <= audible) ?? null;
}

export function audiblePosition(
	anchor: number | null,
	marks: readonly StreamMark[],
	currentTime: number,
	path: string | null | undefined,
	duration: number,
): number | null {
	if (anchor === null) return null;

	const mark = audibleMark(anchor, marks, currentTime);
	if (!mark || !samePlayerPath(mark.path, path)) return null;

	const position = mark.position + (anchor + currentTime - mark.at);
	return clamp(position, 0, duration > 0 ? duration : position);
}

export const DEVICE_VOLUME_FLOOR_DB = -60;

export const DEVICE_VOLUME_STEP_DB = 2;

export const amplitudeOf = (db: number) =>
	db <= DEVICE_VOLUME_FLOOR_DB ? 0 : clamp(10 ** (db / 20), 0, 1);
