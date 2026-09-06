import type { FooJeanDiscovery, StreamMark } from "@/shared/api/fooJean";
import { clamp } from "@/shared/lib/math";

// The codecs parameter is not optional for Ogg: bare `audio/ogg` can answer for Vorbis alone.
// `audio/aac` is the string browsers answer to for ADTS.
import { canUseMse } from "./mseStream";

const MIME: Record<string, string[]> = {
	opus: ['audio/ogg; codecs="opus"'],
	aac: ["audio/aac", "audio/aacp"],
};

let probe: HTMLAudioElement | null = null;

// `canPlayType` returns `''`, `'maybe'` or `'probably'`. Only `''` is a real answer, and the other
// two are not a ranking.
export const playsNatively = (format: string) => {
	probe ??= document.createElement("audio");
	const types = MIME[format];
	if (!types) return false;
	return types.some((type) => probe?.canPlayType(type) !== "");
};

// No browser takes Ogg in an element or in MSE, so Safari answers `''` for Opus and would never be
// offered it. The remux reaches it anyway, handing the element WebM, so a format is reachable by
// either route and the two are not one question.
const isPlayable = (format: string) =>
	playsNatively(format) || (format === "opus" && canUseMse());

// `?format=` outside `streamFormats` is a 400, so this only ever excludes.
export const playableFormats = (offered: readonly string[] | undefined) =>
	(offered ?? []).filter(isPlayable);

export interface ListenTarget {
	origin: string;
	token: string;
	formats: string[];
}

export interface Listener {
	kind: "none" | "agent";
	canListen: boolean;
	formats: string[];
	target: ListenTarget | null;
}

export const NO_LISTENER: Listener = {
	kind: "none",
	canListen: false,
	formats: [],
	target: null,
};

// `canStream` absent means false: an older foo_jean does not carry the field.
export function resolveListener({
	state,
	origin,
	token,
}: FooJeanDiscovery): Listener {
	if (state.kind !== "ready" || !origin || !token) return NO_LISTENER;
	if (!state.capabilities.canStream) return NO_LISTENER;

	const formats = playableFormats(state.capabilities.streamFormats);
	if (formats.length === 0) return NO_LISTENER;

	return {
		kind: "agent",
		canListen: true,
		formats,
		target: { origin, token, formats },
	};
}

// The element's first sample is the live edge and delivery is 1x, so the lag falls out of
// `streamTimeAtConnect + (currentTime - bufferedStart)` rather than being measured.
// `bufferedStart` is the timebase origin rather than a depth: browsers differ over whether
// `currentTime` starts at zero or at the stream's granule position.
export const anchorOf = (streamTimeAtConnect: number, bufferedStart: number) =>
	streamTimeAtConnect - bufferedStart;

export const bufferedStart = (audio: HTMLAudioElement) =>
	audio.buffered.length > 0 ? audio.buffered.start(0) : null;

// One path arrives through beefweb and the other through the component, so separator and case are
// compared leniently.
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

// Null is not a failure: it means drive the bar from beefweb as usual.
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

export const decibelsOf = (amplitude: number) =>
	amplitude <= 0
		? DEVICE_VOLUME_FLOOR_DB
		: clamp(20 * Math.log10(amplitude), DEVICE_VOLUME_FLOOR_DB, 0);
