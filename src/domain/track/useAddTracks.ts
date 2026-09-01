import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { fetchPlaylists, removePlaylistItems } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { pushToast } from "@/shared/ui/toastStore";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// One request whatever the count -- indices go up, nothing else does.
//
// No duplicate check: foobar2000 playlists are ordered lists, not sets, and a
// uniqueness rule Jean invented would misrepresent the data. There is no cheap
// check either, since identity is %path%. Undo covers the mistake instead.

export function useAddTracks() {
	const queryClient = useQueryClient();

	return useCallback(
		async ({
			source,
			target,
			itemIndices,
		}: {
			source: LibrarySource;
			target: PlaylistInfo;
			itemIndices: Refs;
		}) => {
			const count = itemIndices.length;
			if (count === 0) return;

			// Read before the write, which is what makes undo exact: items are appended, so
			// the rows about to exist are precisely [itemCount, itemCount + count).
			const before =
				queryClient
					.getQueryData<PlaylistInfo[]>(PLAYLISTS_KEY)
					?.find((entry) => entry.id === target.id)?.itemCount ??
				target.itemCount;

			try {
				await source.addTo(target.id, itemIndices);
				await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			} catch {
				// Smart playlists reject every write and their metadata says nothing about it,
				// so there is no way to know before trying.
				pushToast({
					tone: "error",
					message: `${target.title} would not take those tracks. Smart playlists are built by the player and cannot be added to.`,
				});
				return;
			}

			const undo = async () => {
				// Read from the player: item changes are not pushed, so the cached itemCount
				// cannot see the desktop -- the one writer this check exists to catch.
				const current = (await fetchPlaylists()).find(
					(entry) => entry.id === target.id,
				);

				// Those indices are only ours while nothing else has touched the playlist: if
				// the count moved, removing that range takes somebody else's tracks.
				if (!current || current.itemCount !== before + count) {
					pushToast({
						tone: "error",
						message: `${target.title} has changed since then, so nothing was removed.`,
					});
					return;
				}

				try {
					await removePlaylistItems(
						target.id,
						Array.from({ length: count }, (_, offset) => before + offset),
					);
					await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				} catch {
					pushToast({ tone: "error", message: `Could not undo that.` });
				}
			};

			pushToast({
				message: `Added ${plural(count, "track")} to ${target.title}`,
				action: { label: "Undo", run: undo },
			});
		},
		[queryClient],
	);
}
