import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { isScratchPlaylist, scratchTitle } from "@/domain/track/jeanPlaylists";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import {
	copyPlaylistRows,
	createPlaylist,
	fetchPlaylistAnnotations,
} from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useStoredState } from "@/shared/hooks/useStoredState";

export const SCRATCH_PIN_KEY = "jean.scratchPlaylist";
export const SCRATCH_LANDED_KEY = "jean.scratchPlaylistLanded";

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
	const [pinnedId, setPinnedId] = useStoredState<string | null>(
		SCRATCH_PIN_KEY,
		null,
	);
	// Preferred over the playlist's own title everywhere it is read; domain/library/CLAUDE.md has why.
	const [landedTitle, setLandedTitle] = useStoredState<string | null>(
		SCRATCH_LANDED_KEY,
		null,
	);
	const queryClient = useQueryClient();
	const { token, discovery } = useFooJean();
	const { origin, token: readyToken } = discovery;

	const playlist = useMemo(() => {
		const pinned = pinnedId
			? playlists.find((entry) => entry.id === pinnedId)
			: null;
		const byId = isScratchPlaylist(pinned) ? pinned : null;
		return byId ?? playlists.find(isScratchPlaylist) ?? null;
	}, [playlists, pinnedId]);

	const holdsView = useCallback(
		(kind: string, label: string | null, count: number) =>
			playlist !== null &&
			landedTitle === scratchTitle(kind, label) &&
			playlist.itemCount === count,
		[playlist, landedTitle],
	);

	const ensure = useCallback(
		async ({
			kind,
			label,
			refs,
			source,
		}: {
			kind: string;
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
			const landedId = await source.fill(title, refs, { token });
			if (sequence !== mine) return null;

			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			const id =
				landedId ??
				queryClient
					.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY)
					?.find((entry) => entry.title === title)?.id ??
				null;

			setPinnedId(id);
			setLandedTitle(title);
			return id;
		},
		[
			canEdit,
			holdsView,
			playlist,
			setPinnedId,
			setLandedTitle,
			queryClient,
			token,
		],
	);

	const adopt = useCallback(
		async (title: string) => {
			if (!playlist || !origin || !readyToken) return null;
			const [created, annotations] = await Promise.all([
				createPlaylist(origin, readyToken, { title }),
				fetchPlaylistAnnotations(origin, readyToken),
			]);
			const count =
				annotations?.find((entry) => entry.id === playlist.id)?.itemCount ?? 0;
			if (count > 0) {
				await copyPlaylistRows(origin, readyToken, created.id, {
					source: playlist.id,
					runs: [[0, count]],
				});
			}
			return created.id;
		},
		[playlist, origin, readyToken],
	);

	return { playlist, holdsView, ensure, adopt };
}
