import type { FooJeanDiscovery, StreamMark } from "@/shared/api/fooJean";
import { clamp } from "@/shared/lib/math";

// Where the sound comes out: the player, or this browser. Nothing outside this file and the store beside it asks which; a control renders or it does not, and the reason is `canListen`.

// ---- choosing a codec --------------------------------------------------------

// Ask the platform what it will play rather than branching on the user agent.
// The codecs parameter is not optional for Ogg: bare `audio/ogg` can answer for Vorbis alone, and `audio/aac` is the string browsers answer to for ADTS.
import { canUseMse } from "./mseStream";

const MIME: Record<string, string[]> = {
	opus: ['audio/ogg; codecs="opus"'],
	aac: ["audio/aac", "audio/aacp"],
};

let probe: HTMLAudioElement | null = null;

// `canPlayType` returns `''`, `'maybe'` or `'probably'`; only `''` is a real answer, and the rest is not a ranking.
export const playsNatively = (format: string) => {
	probe ??= document.createElement("audio");
	const types = MIME[format];
	if (!types) return false;
	return types.some((type) => probe?.canPlayType(type) !== "");
};

// Ogg is not a container any browser takes, in an element or in MSE, so Safari answers `''`
// for Opus and would never be offered it. The remux reaches it anyway: the element is handed
// WebM and never sees the Ogg the component sent. So a format is reachable by either route,
// and the two are not the same question.
const isPlayable = (format: string) =>
	playsNatively(format) || (format === "opus" && canUseMse());

// The server's order is the quality order and this only excludes: a format the component does not offer is never requested, since `?format=` outside `streamFormats` is a 400.
export const playableFormats = (offered: readonly string[] | undefined) =>
	(offered ?? []).filter(isPlayable);

// ---- the seam ----------------------------------------------------------------

export interface ListenTarget {
	origin: string;
	token: string;
	// Already intersected with what this browser admits, in the server's order.
	formats: string[];
}

export interface Listener {
	kind: "none" | "agent";
	canListen: boolean;
	formats: string[];
	target: ListenTarget | null;
}

// `canListen` false and a target of null, so a caller that ignored the flag still cannot connect to anything.
export const NO_LISTENER: Listener = {
	kind: "none",
	canListen: false,
	formats: [],
	target: null,
};

// `canStream` absent means false: an older foo_jean does not carry the field.
// A component streaming only codecs this browser cannot decode resolves to none as well, so no control is offered for something that could not work.
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

// ---- the stream clock --------------------------------------------------------

// The element's first sample is the live edge and delivery is 1x, so `audible = streamTimeAtConnect + (currentTime - bufferedStart)`; the lag is never measured, it falls out of that.
// `bufferedStart` is the timebase origin rather than a depth: browsers differ over whether `currentTime` starts at zero or at the stream's granule position.
export const anchorOf = (streamTimeAtConnect: number, bufferedStart: number) =>
	streamTimeAtConnect - bufferedStart;

// Null until something has arrived, which is what says the anchor cannot be derived yet.
export const bufferedStart = (audio: HTMLAudioElement) =>
	audio.buffered.length > 0 ? audio.buffered.start(0) : null;

// One path arrives through beefweb and the other through the component, so they are compared leniently for separator and case.
export const samePlayerPath = (
	left: string | null | undefined,
	right: string | null | undefined,
) =>
	Boolean(left) &&
	Boolean(right) &&
	left?.replaceAll("\\", "/").toLowerCase() ===
		right?.replaceAll("\\", "/").toLowerCase();

// Which track the audible sample belongs to, or null when the timeline cannot say.
export function audibleMark(
	anchor: number | null,
	marks: readonly StreamMark[],
	currentTime: number,
): StreamMark | null {
	if (anchor === null) return null;
	const audible = anchor + currentTime;
	return marks.findLast((entry) => entry.at <= audible) ?? null;
}

// Where in the track the audible sample sits. Null is not a failure: it means drive the bar from beefweb as usual.
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

// ---- this device's volume ----------------------------------------------------

// The same decibel scale the player's fader uses, so one gesture is the same change in loudness whichever target the control points at. `audio.volume` is the amplitude end of this conversion.
export const DEVICE_VOLUME_FLOOR_DB = -60;

// What one press of the volume keys moves, standing in for the player's own `/volume/up` where that endpoint is inaudible. Thirty presses across the range.
export const DEVICE_VOLUME_STEP_DB = 2;

export const amplitudeOf = (db: number) =>
	db <= DEVICE_VOLUME_FLOOR_DB ? 0 : clamp(10 ** (db / 20), 0, 1);

export const decibelsOf = (amplitude: number) =>
	amplitude <= 0
		? DEVICE_VOLUME_FLOOR_DB
		: clamp(20 * Math.log10(amplitude), DEVICE_VOLUME_FLOOR_DB, 0);
