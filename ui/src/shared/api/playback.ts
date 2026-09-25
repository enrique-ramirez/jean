import { postFooJeanCommand as post } from "./fooJean";
import type { PlaybackMode } from "./types";

export const playPause = (origin: string) =>
	post(origin, "/api/playback/play-pause");

export const ASKED_MS = 4000;
let asked: { by: number; at: number } | null = null;

export function takeSkipAsked() {
	const last = asked;
	asked = null;
	return last && Date.now() - last.at < ASKED_MS ? last.by : null;
}

const skipping = (by: number) => {
	asked = { by, at: Date.now() };
};

export const nextTrack = (origin: string) => {
	skipping(1);
	return post(origin, "/api/playback/next");
};

export const previousTrack = (origin: string) => {
	skipping(-1);
	return post(origin, "/api/playback/previous");
};

export const stop = (origin: string) => post(origin, "/api/playback/stop");

export const seekTo = (origin: string, position: number) =>
	post(origin, "/api/playback/seek", { seconds: position });

export const seekBy = (origin: string, offset: number) =>
	post(origin, "/api/playback/seek", { relativeSeconds: offset });

export const setVolume = (origin: string, volume: number) =>
	post(origin, "/api/volume", { value: volume });

export const setMuted = (origin: string, isMuted: boolean) =>
	post(origin, "/api/volume", { muted: isMuted });

export const volumeUp = (origin: string) =>
	post(origin, "/api/volume", { step: "up" });

export const volumeDown = (origin: string) =>
	post(origin, "/api/volume", { step: "down" });

export const setPlaybackOrder = (origin: string, mode: PlaybackMode) =>
	post(origin, "/api/playback/mode", { mode });
