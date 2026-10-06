import type { PlaybackState } from "@/shared/api/types";

// How long `currentTime` may stand still while the element believes it is playing. A dead live
// stream fires `stalled` and `waiting`, never `error`, so nothing else notices.
const STALL_MS = 6000;
const START_MS = 25_000;
const MSE_START_MS = 5000;
const STALLS_ALLOWED = 3;
const STALL_WINDOW_MS = 30_000;

export interface Watched {
	now: number;
	currentTime: number;
	lastTime: number;
	lastAdvance: number;
	hasRendered: boolean;
	isLowLatency: boolean;
	isPaused: boolean;
	playerState: PlaybackState | null;
}

export type StallVerdict =
	| "retire low latency"
	| "advanced"
	| "wait"
	| "player silent"
	| "reconnect";

export function stallVerdict(watched: Watched): StallVerdict {
	const { now, lastAdvance, hasRendered } = watched;
	const isPlayerQuiet =
		watched.playerState !== null && watched.playerState !== "playing";

	if (watched.currentTime !== watched.lastTime) return "advanced";
	if (watched.isPaused) return "wait";

	// A stopped player and a broken stream look identical from foo_jean's stream: headers arrive and then
	// nothing. Only the player's own state can say which.
	if (isPlayerQuiet && !hasRendered) return "player silent";

	if (watched.isLowLatency && !hasRendered && now - lastAdvance > MSE_START_MS)
		return "retire low latency";
	if (now - lastAdvance < STALL_MS) return "wait";
	if (isPlayerQuiet) return "player silent";
	if (!hasRendered && now - lastAdvance < START_MS) return "wait";
	return "reconnect";
}

export function countStall(stalls: readonly number[], now: number) {
	const recent = [...stalls.filter((at) => now - at < STALL_WINDOW_MS), now];
	return { stalls: recent, isTooMany: recent.length >= STALLS_ALLOWED };
}

export const formatToTry = (
	offered: readonly string[],
	dead: ReadonlySet<string>,
) => offered.find((format) => !dead.has(format)) ?? null;
