import {
	type Answer,
	askResult,
	BODYLESS_POST,
	type Call,
	PATIENT_TIMEOUT_MS,
} from "./client";
import type { PlaybackMode } from "./types";

const command = (origin: string, call: Call<Answer<unknown>>) =>
	askResult(origin, PATIENT_TIMEOUT_MS, call);

export const playPause = (origin: string) =>
	command(origin, (api, init) =>
		api.POST("/playback/play-pause", { ...init, headers: BODYLESS_POST }),
	);

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
	return command(origin, (api, init) =>
		api.POST("/playback/next", { ...init, headers: BODYLESS_POST }),
	);
};

export const previousTrack = (origin: string) => {
	skipping(-1);
	return command(origin, (api, init) =>
		api.POST("/playback/previous", { ...init, headers: BODYLESS_POST }),
	);
};

export const stop = (origin: string) =>
	command(origin, (api, init) =>
		api.POST("/playback/stop", { ...init, headers: BODYLESS_POST }),
	);

export const seekTo = (origin: string, position: number) =>
	command(origin, (api, init) =>
		api.POST("/playback/seek", { ...init, body: { seconds: position } }),
	);

export const seekBy = (origin: string, offset: number) =>
	command(origin, (api, init) =>
		api.POST("/playback/seek", { ...init, body: { relativeSeconds: offset } }),
	);

export const setVolume = (origin: string, volume: number) =>
	command(origin, (api, init) =>
		api.POST("/volume", { ...init, body: { value: volume } }),
	);

export const setMuted = (origin: string, isMuted: boolean) =>
	command(origin, (api, init) =>
		api.POST("/volume", { ...init, body: { muted: isMuted } }),
	);

export const volumeUp = (origin: string) =>
	command(origin, (api, init) =>
		api.POST("/volume", { ...init, body: { step: "up" } }),
	);

export const volumeDown = (origin: string) =>
	command(origin, (api, init) =>
		api.POST("/volume", { ...init, body: { step: "down" } }),
	);

export const setPlaybackOrder = (origin: string, mode: PlaybackMode) =>
	command(origin, (api, init) =>
		api.POST("/playback/mode", { ...init, body: { mode } }),
	);

export const setActiveOutput = (origin: string, deviceId: string) =>
	command(origin, (api, init) =>
		api.POST("/outputs/active", { ...init, body: { deviceId } }),
	);
