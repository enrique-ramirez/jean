import type { PlayerSnapshot } from "../api/types";

/**
 * Playback position, interpolated forward from the last update.
 *
 * beefweb reports a position only when it sends an update, which can be minutes
 * apart. Every snapshot is therefore stamped with the moment it arrived, and the
 * live position is derived from that anchor rather than polled.
 */
export function positionAt(
	snapshot: PlayerSnapshot | null | undefined,
	now: number,
) {
	const item = snapshot?.player?.activeItem;
	if (!item || item.index < 0) return 0;

	const base = item.position ?? 0;
	if (snapshot.player.playbackState !== "playing") return base;

	const elapsed = (now - snapshot.syncedAt) / 1000;
	return Math.min(base + elapsed, item.duration ?? base);
}

export function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const pad = (value: number) => String(value).padStart(2, "0");

	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(total % 60)}`
		: `${minutes}:${pad(total % 60)}`;
}
