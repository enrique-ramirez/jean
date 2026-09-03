import type { FooJeanDiscovery, StreamMark } from "@/shared/api/fooJean";
import { clamp } from "@/shared/lib/math";

// Where the sound comes out: the player, or this browser. Nothing outside this
// file and the store beside it may ask which -- a control renders or it does
// not, and the reason is `canListen`. See the root CLAUDE.md.

// ---- choosing a codec, without ever naming a browser -------------------------

// **Never branch on the user agent.** The question is not "is this Safari", it
// is "will this element play these bytes", and the platform answers that
// directly.
//
// The codecs parameter is not optional for Ogg: bare `audio/ogg` can answer for
// Vorbis alone. `audio/aac` is the string browsers actually answer to for ADTS.
const MIME: Record<string, string[]> = {
	opus: ['audio/ogg; codecs="opus"'],
	aac: ["audio/aac", "audio/aacp"],
};

let probe: HTMLAudioElement | null = null;

// `canPlayType` returns `''`, `'maybe'` or `'probably'`. **Only `''` is a real
// answer**; everything else is a candidate and none of it is a ranking, so the
// server's order survives untouched.
const isPlayable = (format: string) => {
	probe ??= document.createElement("audio");
	const types = MIME[format];
	if (!types) return false;
	return types.some((type) => probe?.canPlayType(type) !== "");
};

// **The server's order is the quality order and this only excludes.** Opus first
// means a Safari that reads Ogg Opus gets the better codec and an older one
// falls to AAC, without anybody naming a browser. A format the component does
// not offer is never requested: `?format=` outside `streamFormats` is a 400.
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

// `canListen` false and a target of null, so a caller that ignored the flag
// still cannot connect to anything.
export const NO_LISTENER: Listener = {
	kind: "none",
	canListen: false,
	formats: [],
	target: null,
};

// **`canStream` absent means false.** An older `foo_jean` does not carry the
// field, and a client that offers a control and then fails is worse than one
// that never offered it.
//
// A component that streams a codec this browser cannot decode resolves to *none*
// as well: there is nothing the button could do, so there is no button. That is
// the same rule as an empty write allowlist being indistinguishable from no
// component at all.
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

// The element's first sample is the live edge -- `BroadcastRing::subscribe` --
// and delivery is 1x, so:
//
//     audible = streamTimeAtConnect + (currentTime - bufferedStart)
//
// The lag is never measured. It falls out as wall time since connecting minus
// audio played, which is why a stall widens it without being told. `bufferedStart`
// is the timebase origin, not a depth: browsers differ over whether `currentTime`
// starts at zero or at the stream's granule position. See this folder's CLAUDE.md.
export const anchorOf = (streamTimeAtConnect: number, bufferedStart: number) =>
	streamTimeAtConnect - bufferedStart;

// Null until something has arrived, which is what says the anchor cannot be
// derived yet.
export const bufferedStart = (audio: HTMLAudioElement) =>
	audio.buffered.length > 0 ? audio.buffered.start(0) : null;

// One arrives through beefweb and the other through the component, which resolves
// it to the display path so the two agree. Compared leniently for separator and
// case, and **never against an assumed path**.
export const samePlayerPath = (
	left: string | null | undefined,
	right: string | null | undefined,
) =>
	Boolean(left) &&
	Boolean(right) &&
	left?.replaceAll("\\", "/").toLowerCase() ===
		right?.replaceAll("\\", "/").toLowerCase();

// Which track the audible sample belongs to, or null when the timeline cannot
// say. Separate from the position because the identity is wanted on its own.
export function audibleMark(
	anchor: number | null,
	marks: readonly StreamMark[],
	currentTime: number,
): StreamMark | null {
	if (anchor === null) return null;
	const audible = anchor + currentTime;
	return marks.findLast((entry) => entry.at <= audible) ?? null;
}

// Where in the *track* the audible sample sits. Null is not a failure: it means
// drive the bar from beefweb as usual.
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

// Presented on the same decibel scale the player's fader uses, so the identical
// gesture in the identical place is the identical change in loudness whichever
// of the two the control is currently pointed at. `audio.volume` is an amplitude
// multiplier, which is the other end of this conversion and not a scale to put
// in front of anyone.
export const DEVICE_VOLUME_FLOOR_DB = -60;

export const amplitudeOf = (db: number) =>
	db <= DEVICE_VOLUME_FLOOR_DB ? 0 : clamp(10 ** (db / 20), 0, 1);

export const decibelsOf = (amplitude: number) =>
	amplitude <= 0
		? DEVICE_VOLUME_FLOOR_DB
		: clamp(20 * Math.log10(amplitude), DEVICE_VOLUME_FLOOR_DB, 0);
