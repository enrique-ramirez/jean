import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlaylists";
import {
	isScratchPlaylist,
	type ScratchKind,
	scratchTitle,
} from "@/domain/track/jeanPlaylists";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { orThrow } from "@/shared/api/client";
import { createPlaylist } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useStoredState } from "@/shared/hooks/useStoredState";

const SCRATCH_LANDED_KEY = "jean.scratchLanded";

// The last fill this device watched land, and the `structure` it left the scratch at. Every client
// shares the one scratch, so any fill after it, from anywhere, moves the structure and retires it.
interface Landed {
	title: string;
	count: number;
	structure: string;
}

const landedOn = (playlist: PlaylistInfo | null, landed: Landed | null) =>
	playlist && landed?.structure === playlist.structure ? landed : null;

export function useLandedScratch(playlist: PlaylistInfo | null) {
	const [landed] = useStoredState<Landed | null>(SCRATCH_LANDED_KEY, null);
	return landedOn(playlist, landed);
}

// Preferred over the playlist's own title everywhere it is read; domain/library/CLAUDE.md has why.
export const titledAsLanded = (
	playlist: PlaylistInfo,
	landed: Landed | null,
): PlaylistInfo => (landed ? { ...playlist, title: landed.title } : playlist);

// Module-scope rather than a ref: Home, a view and the now-playing menu each call this hook
// separately, and a fill started from one must still be able to abandon a fill started from another.
let sequence = 0;

export function useScratchPlaylist({
	playlists,
	canEdit,
}: {
	playlists: PlaylistInfo[];
	canEdit: boolean;
}) {
	const [stored, setLanded] = useStoredState<Landed | null>(
		SCRATCH_LANDED_KEY,
		null,
	);
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const { origin } = discovery;

	const playlist = useMemo(
		() => playlists.find(isScratchPlaylist) ?? null,
		[playlists],
	);

	const landed = landedOn(playlist, stored);

	const holdsView = useCallback(
		(kind: ScratchKind, label: string | null, count: number) =>
			playlist !== null &&
			landed?.title === scratchTitle(kind, label) &&
			playlist.itemCount === count,
		[playlist, landed],
	);

	const ensure = useCallback(
		async ({
			kind,
			label,
			refs,
			source,
		}: {
			kind: ScratchKind;
			label: string | null;
			refs: Refs;
			source: Extract<LibrarySource, { kind: "library" }>;
		}): Promise<string | null> => {
			if (!canEdit || refs.length === 0) return null;
			if (holdsView(kind, label, refs.length))
				return (playlist as PlaylistInfo).id;

			// The latest call wins rather than queueing behind an earlier one: the component applies
			// fills in the order they arrive regardless of which response this waits for, so there is
			// nothing to gain by waiting for an older view's fill before starting a newer one. A call
			// superseded before its own fill lands resolves to null, so a caller awaiting it plays
			// nothing rather than a stale view.
			sequence += 1;
			const mine = sequence;
			const title = scratchTitle(kind, label);
			const filled = await source.fill(title, refs);
			if (sequence !== mine) return null;

			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			const id =
				filled?.id ??
				queryClient
					.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY)
					?.find((entry) => entry.title === title)?.id ??
				null;

			if (filled)
				setLanded({ title, count: refs.length, structure: filled.structure });
			return id;
		},
		[canEdit, holdsView, playlist, setLanded, queryClient],
	);

	// The playlist's own polled `itemCount` is the fallback once `landed` is retired, which a fill
	// from another device does.
	const adopt = useCallback(
		async (title: string) => {
			if (!playlist || !origin) return null;
			const count = landed?.count ?? playlist.itemCount;
			const created = await createPlaylist(origin, {
				title,
				...(count > 0 ? { source: playlist.id, runs: [[0, count]] } : {}),
			});
			return orThrow(created).id;
		},
		[playlist, origin, landed],
	);

	return { playlist, holdsView, ensure, adopt };
}
