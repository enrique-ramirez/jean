import type { FooJeanDiscovery, StreamMark } from "@/shared/api/fooJean";
import { clamp } from "@/shared/lib/math";

import { canUseMse } from "./mseStream";

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

const isPlayable = (format: string) =>
	playsNatively(format) || (format === "opus" && canUseMse());

export const playableFormats = (offered: readonly string[] | undefined) =>
	(offered ?? []).filter(isPlayable);

export interface ListenTarget {
	origin: string;
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
export function resolveListener({ state, origin }: FooJeanDiscovery): Listener {
	if (state.kind !== "ready" || !origin) return NO_LISTENER;
	if (!state.capabilities.canStream) return NO_LISTENER;

	const formats = playableFormats(state.capabilities.streamFormats);
	if (formats.length === 0) return NO_LISTENER;

	return {
		kind: "agent",
		canListen: true,
		formats,
		target: { origin, formats },
	};
}

export const anchorOf = (streamTimeAtConnect: number, bufferedStart: number) =>
	streamTimeAtConnect - bufferedStart;

export const bufferedStart = (audio: HTMLAudioElement) =>
	audio.buffered.length > 0 ? audio.buffered.start(0) : null;

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

export const decibelsOf = (amplitude: number) =>
	amplitude <= 0
		? DEVICE_VOLUME_FLOOR_DB
		: clamp(20 * Math.log10(amplitude), DEVICE_VOLUME_FLOOR_DB, 0);
