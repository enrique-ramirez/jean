import { useMemo, useSyncExternalStore } from "react";

import { readTrack } from "@/shared/api/playerState";
import type { PlayerSnapshot } from "@/shared/api/types";
import { samePlayerPath } from "./listener";
import {
	beginSeek,
	listeningSnapshot,
	subscribeListening,
} from "./listenerStore";
import { positionAt } from "./position";

const DEPTH = 4;

let history: PlayerSnapshot[] = [];

export function forgetHeard(): void {
	history = [];
}

const pathOf = (snapshot: PlayerSnapshot | null | undefined) =>
	readTrack(snapshot?.player)?.path ?? null;

const positionOf = (snapshot: PlayerSnapshot) =>
	snapshot.player?.activeItem?.position ?? 0;

const JUMP = 2;

const looksLikeSeek = (last: PlayerSnapshot, next: PlayerSnapshot) =>
	Math.abs(positionOf(next) - positionAt(last, next.syncedAt)) > JUMP;

// Keyed by track rather than appended blindly: an update arrives for every volume nudge, and
// appending those would evict the track still being heard.
export function rememberSnapshot(next: PlayerSnapshot): boolean {
	if (!pathOf(next)) return false;

	const last = history[history.length - 1];
	if (last && samePlayerPath(pathOf(last), pathOf(next))) {
		history = [...history.slice(0, -1), next];
		if (looksLikeSeek(last, next)) {
			beginSeek(positionOf(next));
			return true;
		}
		return false;
	}

	history = [...history.slice(1 - DEPTH), next];
	return true;
}

export function useAudibleSnapshot(live: PlayerSnapshot | null | undefined) {
	const audiblePath = useSyncExternalStore(
		subscribeListening,
		() => listeningSnapshot().audiblePath,
	);

	return useMemo(() => {
		if (!live || !audiblePath) return live;
		if (samePlayerPath(pathOf(live), audiblePath)) return live;

		const heard = history.findLast((entry) =>
			samePlayerPath(pathOf(entry), audiblePath),
		);
		if (!heard) return live;

		// `syncedAt` travels with the item it anchors, or the position it interpolates dates the wrong
		// track.
		return {
			player: { ...live.player, activeItem: heard.player.activeItem },
			syncedAt: heard.syncedAt,
		};
	}, [live, audiblePath]);
}
