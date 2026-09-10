import { useEffect } from "react";

import { usePlayer } from "@/domain/player/usePlayer";
import { readTrack } from "@/shared/api/beefweb";
import { recheckComponentLibrary } from "./playlistStore";

// foo_jean re-reads a track as it stops being the active one and coalesces the rebuild after a quiet
// period, so a check fired at the instant of the change lands before the revision has moved.
const AFTER_TRACK_CHANGE_MS = 5_000;

// The other thing that moves a revision is somebody editing tags in foobar2000 itself, which nothing
// here can hear about. The interval is long because that is a deliberate act at the desktop rather
// than something happening under the user, because a tab nobody is looking at does not check at all,
// and because coming back to Jean checks straight away.
const WHILE_IDLE_MS = 5 * 60_000;

export function useLibraryFeed(origin: string | null, token: string | null) {
	const playing = readTrack(usePlayer().data?.player);
	const path = playing?.path ?? null;
	const subsong = playing?.subsong ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the track changing is what fires this, and nothing here reads it
	useEffect(() => {
		if (!origin || !token) return;

		const timer = setTimeout(
			() => void recheckComponentLibrary(origin, token),
			AFTER_TRACK_CHANGE_MS,
		);
		return () => clearTimeout(timer);
	}, [origin, token, path, subsong]);

	useEffect(() => {
		if (!origin || !token) return;

		const check = () => {
			if (document.visibilityState === "visible")
				void recheckComponentLibrary(origin, token);
		};

		const timer = setInterval(check, WHILE_IDLE_MS);
		document.addEventListener("visibilitychange", check);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", check);
		};
	}, [origin, token]);
}
