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

// Jean's claim on the playlist: set while it is Jean's, dropped the moment it becomes the user's. Anything that deletes the scratch reads this rather than a title off a list that may already be a render behind.
export const SCRATCH_PIN_KEY = "jean.scratchPlaylist";

// Holds the last set chosen to play, not the thing on screen. Resolved by stored id falling back to the title, because beefweb ids are neither contiguous nor promised to outlive the player process.
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
	const queryClient = useQueryClient();

	const playlist = useMemo(() => {
		const pinned = pinnedId
			? playlists.find((entry) => entry.id === pinnedId)
			: null;
		// The pin is checked, not trusted: saving results renames this playlist into one of the user's, so a stale pin would hand that playlist back to be emptied.
		const byId = isScratchPlaylist(pinned) ? pinned : null;
		return byId ?? playlists.find(isScratchPlaylist) ?? null;
	}, [playlists, pinnedId]);

	// Read off the playlist rather than remembered here, so it survives a reload and answers the same on another device.
	const held = useMemo(() => scratchContentsOf(playlist), [playlist]);

	const holdsView = useCallback(
		(kind: string, label: string | null, count: number) =>
			playlist !== null &&
			held?.kind === kind &&
			held?.label === label &&
			playlist.itemCount === count,
		[playlist, held],
	);

	// Serialised: two quick clicks would otherwise interleave a rebuild with a refill and leave the playlist holding half of each.
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
				if (!target) target = await createPlaylist(title);
				else if (target.title !== title) await renamePlaylist(target.id, title);
				setPinnedId(target.id);

				// Read off the player, not off `target`: item changes are never pushed, so a cached `itemCount` is stale from the first write on and this is the one place that cannot survive being wrong.
				const heldCount = source.needsHeldCount
					? ((await fetchPlaylists()).find((entry) => entry.id === target.id)
							?.itemCount ?? 0)
					: 0;
				await source.fill(target.id, refs, heldCount);

				// Put the true count back, because nothing else will: `holdsView` derives from it, so otherwise the playlist is rebuilt on every play.
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

	// When the scratch already is that set, renaming it is enough: nothing is copied and playback carries on, because it stays the same playlist.
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
