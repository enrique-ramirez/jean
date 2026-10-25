import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { pollPlayerNow } from "@/domain/player/playerPoll";
import {
	reportPlaybackRefusal,
	usePlayerPatch,
} from "@/domain/player/playerWrite";
import { inSession } from "@/domain/player/session";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { usePlayItem } from "@/domain/player/useTransport";
import type { ScratchKind } from "@/domain/track/jeanPlaylists";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { orThrow, type Schema } from "@/shared/api/client";
import { isFooJeanReady, requireFooJean } from "@/shared/api/discovery";
import { playLibrarySet } from "@/shared/api/playback";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useScratchPlaylist } from "./useScratchPlaylist";

const usePlayInSession = () => {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();

	return usePlayerPatch(
		async (set: Schema["PlayLibrarySetRequest"]) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await playLibrarySet(origin, set));
			await pollPlayerNow(queryClient, origin);
		},
		() => ({ playbackState: "playing" }),
	);
};

export function usePlaySet({
	source,
	playlists,
}: {
	source: Extract<LibrarySource, { kind: "library" }>;
	playlists: PlaylistInfo[];
}) {
	const { discovery, recheck } = useFooJean();
	const canPlaySets = isFooJeanReady(discovery);
	const canControlPlayback = useCanControlPlayback();
	const scratch = useScratchPlaylist({
		playlists,
		canEdit: canPlaySets,
	});
	const playItem = usePlayItem();
	const playInSession = usePlayInSession();

	const play = useCallback(
		async ({
			kind,
			label,
			refs,
			position,
		}: {
			kind: ScratchKind;
			label: string | null;
			refs: Refs;
			position: number;
		}) => {
			if (!canControlPlayback) return null;
			if (inSession()) {
				if (!canPlaySets || refs.length === 0) return null;
				const set = await source.queueTargets(refs);
				if (set.kind !== "tracks") return null;
				return playInSession
					.mutateAsync({ ...set.request, index: position })
					.catch(() => null);
			}
			let id: string | null;
			try {
				id = await scratch.ensure({
					kind,
					label,
					refs,
					source: source,
				});
			} catch (error) {
				reportPlaybackRefusal(error, recheck);
				// foo_jean answers a fill it refuses or cannot attempt with a non-2xx status, most often
				// a 409 for a structure that moved under it, rather than an empty result: there is
				// nothing here to play until whatever asked for this tries again.
				return null;
			}
			// `usePlayItem`'s own mutation already reports a playback refusal through the same helper,
			// so this swallows only to keep a mutation's rejection from reaching a caller that never
			// reads it, not to answer for it a second time.
			return id
				? playItem
						.mutateAsync({ playlistId: id, index: position })
						.catch(() => null)
				: null;
		},
		[
			scratch,
			source,
			playItem.mutateAsync,
			playInSession.mutateAsync,
			recheck,
			canControlPlayback,
			canPlaySets,
		],
	);

	return { play, scratch, canPlaySets };
}
