import { useMemo, useSyncExternalStore } from "react";

import { readTrack } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { samePlayerPath } from "./listener";
import {
	beginSeek,
	listeningServerSnapshot,
	listeningSnapshot,
	refreshTimeline,
	subscribeListening,
} from "./listenerStore";
import { positionAt } from "./position";

// The snapshot describing what is *audible* here, which while a stream is
// attached is not what beefweb says is playing. Only `activeItem` is delayed;
// the player's own state stays live. See this folder's CLAUDE.md.

// Deeper than the lag can span.
const DEPTH = 4;

let history: PlayerSnapshot[] = [];

const pathOf = (snapshot: PlayerSnapshot | null | undefined) =>
	readTrack(snapshot?.player)?.path ?? null;

const positionOf = (snapshot: PlayerSnapshot) =>
	snapshot.player?.activeItem?.position ?? 0;

// Seconds the reported position may differ from the interpolated one before it
// counts as a seek rather than as slop between two clocks.
const JUMP = 2;

// Keyed by track rather than appended blindly: an update arrives for every
// volume nudge, and appending those would evict the track still being heard.
export function rememberSnapshot(next: PlayerSnapshot) {
	if (!pathOf(next)) return;

	const last = history[history.length - 1];
	if (last && samePlayerPath(pathOf(last), pathOf(next))) {
		history[history.length - 1] = next;
		// A seek lays a mark too, and nothing in the update says "seek" -- so it is
		// read off the position disagreeing with the interpolation.
		if (Math.abs(positionOf(next) - positionAt(last, next.syncedAt)) > JUMP) {
			beginSeek(positionOf(next));
			refreshTimeline();
		}
		return;
	}

	history = [...history.slice(1 - DEPTH), next];
	// A track change lays a mark this client does not hold yet.
	refreshTimeline();
}

// Returns the given snapshot **by identity** whenever nothing is listening, which
// `useElapsed` depends on.
export function useAudibleSnapshot(live: PlayerSnapshot | null | undefined) {
	// A primitive, so React bails out on the notifications that did not move the
	// sound to another track -- phase changes, every step of a volume drag.
	const audiblePath = useSyncExternalStore(
		subscribeListening,
		() => listeningSnapshot().audiblePath,
		() => listeningServerSnapshot().audiblePath,
	);

	return useMemo(() => {
		if (!live || !audiblePath) return live;
		if (samePlayerPath(pathOf(live), audiblePath)) return live;

		const heard = history.findLast((entry) =>
			samePlayerPath(pathOf(entry), audiblePath),
		);
		// Joined mid-track, or a history overrun. Early beats naming a track this
		// cannot produce.
		if (!heard) return live;

		// `syncedAt` travels with the item it anchors, or the position it
		// interpolates dates the wrong track.
		return {
			player: { ...live.player, activeItem: heard.player.activeItem },
			syncedAt: heard.syncedAt,
		};
	}, [live, audiblePath]);
}
