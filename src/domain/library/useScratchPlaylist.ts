import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import {
	isScratchPlaylist,
	scratchContentsOf,
	scratchTitle,
} from "@/domain/track/jeanPlaylists";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import {
	createPlaylist,
	fetchPlaylists,
	renamePlaylist,
} from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { useStoredState } from "@/shared/hooks/useStoredState";

// Holds the last set you chose to play, not the thing you are looking at.
// Resolved by stored id falling back to the title, because ids are neither
// contiguous nor promised to outlive the player process.
//
// `kind` and `label` arrive per call rather than per hook, because the thing
// filling it is often not the thing rendering it.
export function useScratchPlaylist({
	playlists,
	canEdit,
}: {
	playlists: PlaylistInfo[];
	canEdit: boolean;
}) {
	const [pinnedId, setPinnedId] = useStoredState<string | null>(
		"jean.scratchPlaylist",
		null,
	);
	const queryClient = useQueryClient();

	const playlist = useMemo(() => {
		const pinned = pinnedId
			? playlists.find((entry) => entry.id === pinnedId)
			: null;
		// The pin is checked, not trusted: saving results renames this playlist into the
		// user's, so a stale pin hands their playlist back to be emptied.
		const byId = isScratchPlaylist(pinned) ? pinned : null;
		return byId ?? playlists.find(isScratchPlaylist) ?? null;
	}, [playlists, pinnedId]);

	// Read off the playlist rather than remembered here, so it survives a reload and
	// answers the same on another device.
	const held = useMemo(() => scratchContentsOf(playlist), [playlist]);

	const holdsView = useCallback(
		(kind: string, label: string | null, count: number) =>
			playlist !== null &&
			held?.kind === kind &&
			held?.label === label &&
			playlist.itemCount === count,
		[playlist, held],
	);

	// Serialised: two quick clicks would otherwise interleave a rebuild with a
	// refill and leave the playlist holding half of each.
	const pending = useRef<Promise<string | null> | null>(null);

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
			source: LibrarySource;
		}): Promise<string | null> => {
			if (!canEdit || refs.length === 0) return null;
			if (holdsView(kind, label, refs.length))
				return (playlist as PlaylistInfo).id;

			const build = async () => {
				const title = scratchTitle(kind, label);
				let target = playlist as PlaylistInfo | null;
				if (!target) {
					target = await createPlaylist(title);
					setPinnedId(target.id);
				} else if (target.title !== title) {
					await renamePlaylist(target.id, title);
				}

				// Read off the player, not off `target`: item changes are never pushed, so a
				// cached `itemCount` is stale from the first write on, and this is the one place
				// that cannot survive being wrong -- trusting it emptied most of a playlist.
				const heldCount = source.needsHeldCount
					? ((await fetchPlaylists()).find((entry) => entry.id === target.id)
							?.itemCount ?? 0)
					: 0;
				await source.fill(target.id, refs, heldCount);

				// Put the true count back, because nothing else will: `holdsView` derives from
				// it, so otherwise the playlist is rebuilt on every play.
				await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				return target.id;
			};

			pending.current = (pending.current ?? Promise.resolve()).then(
				build,
				build,
			);
			return pending.current;
		},
		[canEdit, holdsView, playlist, setPinnedId, queryClient],
	);

	// When the scratch already is that set, rename it and it stops being Jean's:
	// nothing is copied and playback carries on, because it is the same playlist.
	const adopt = useCallback(
		async (title: string) => {
			if (!playlist) return null;
			await renamePlaylist(playlist.id, title);
			setPinnedId(null);
			return playlist.id;
		},
		[playlist, setPinnedId],
	);

	return { playlist, held, holdsView, ensure, adopt };
}
