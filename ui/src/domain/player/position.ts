import { readTrack } from "@/shared/api/playerState";
import type { PlayerSnapshot } from "@/shared/api/types";
import { listeningPosition } from "./listenerStore";

export function positionAt(
	snapshot: PlayerSnapshot | null | undefined,
	now: number,
) {
	const item = snapshot?.player?.activeItem;
	if (!item) return 0;
	// TypeScript narrows `snapshot` from the `!item` check above; folding this into
	// `!item?.path` loses that narrowing and `snapshot.player` below stops type-checking.
	if (!item.path) return 0;

	const base = item.position ?? 0;
	if (snapshot.player.playbackState !== "playing") return base;

	const elapsed = (now - snapshot.syncedAt) / 1000;
	return Math.min(base + elapsed, item.duration ?? base);
}

// `positionAt` stays the player's own answer, for the writes expressed in the player's clock: the
// freeze on pause, and what a relative seek offsets.
export const audibleAt = (snapshot: PlayerSnapshot | null | undefined) =>
	listeningPosition(
		readTrack(snapshot?.player)?.path,
		snapshot?.player?.activeItem?.duration ?? 0,
	) ?? positionAt(snapshot, performance.now());
