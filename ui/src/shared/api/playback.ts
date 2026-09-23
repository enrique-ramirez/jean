import { postFooJeanCommand as post } from "./fooJean";
import type { PlaybackMode } from "./types";

export const playPause = (origin: string, token: string) =>
	post(origin, token, "/api/playback/play-pause");

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

export const nextTrack = (origin: string, token: string) => {
	skipping(1);
	return post(origin, token, "/api/playback/next");
};

export const previousTrack = (origin: string, token: string) => {
	skipping(-1);
	return post(origin, token, "/api/playback/previous");
};

export const stop = (origin: string, token: string) =>
	post(origin, token, "/api/playback/stop");

export const seekTo = (origin: string, token: string, position: number) =>
	post(origin, token, "/api/playback/seek", { seconds: position });

export const seekBy = (origin: string, token: string, offset: number) =>
	post(origin, token, "/api/playback/seek", { relativeSeconds: offset });

export const setVolume = (origin: string, token: string, volume: number) =>
	post(origin, token, "/api/volume", { value: volume });

export const setMuted = (origin: string, token: string, isMuted: boolean) =>
	post(origin, token, "/api/volume", { muted: isMuted });

export const volumeUp = (origin: string, token: string) =>
	post(origin, token, "/api/volume", { step: "up" });

export const volumeDown = (origin: string, token: string) =>
	post(origin, token, "/api/volume", { step: "down" });

export const setPlaybackOrder = (
	origin: string,
	token: string,
	mode: PlaybackMode,
) => post(origin, token, "/api/playback/mode", { mode });
