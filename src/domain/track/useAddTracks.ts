import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { fetchPlaylists, removePlaylistItems } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { pushToast } from "@/shared/ui/toastStore";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// No duplicate check: foobar2000 playlists are ordered lists rather than sets, and identity is %path%, so there is no cheap one. Undo covers the mistake instead.
// Copying into an autoplaylist answers 204 and adds nothing, exactly as a copy into an ordinary playlist answers 204 and adds everything, and nothing in the playlist schema says which kind it is -- so reading the count back is the only way to know whether anything happened.
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

			// From the player rather than the cache: item changes are never pushed, so a cached itemCount is stale from the first edit onwards and cannot see the desktop at all.
			// The read is also what makes undo exact, since items are appended at precisely [itemCount, itemCount + count).
			const countOf = async () => {
				const playlists = await fetchPlaylists();
				queryClient.setQueryData(PLAYLISTS_KEY, playlists);
				return (
					playlists.find((entry) => entry.id === target.id)?.itemCount ?? null
				);
			};

			// The fact first and the likely reason second, because a 204 that changed nothing is all the player says.
			const refuse = () =>
				pushToast({
					tone: "error",
					message: `Nothing was added to ${target.title}. Smart playlists are built by the player and cannot be added to.`,
				});

			const before = await countOf().catch(() => null);

			try {
				await source.addTo(target.id, itemIndices);
			} catch {
				await countOf().catch(() => null);
				refuse();
				return;
			}

			const after = await countOf().catch(() => null);

			// A count that could not be read either side is not evidence of failure, so the add is reported as sent and undo is withheld: the arithmetic it depends on is what is missing.
			if (before === null || after === null) {
				pushToast({
					message: `Added ${plural(count, "track")} to ${target.title}`,
				});
				return;
			}

			if (after !== before + count) {
				refuse();
				return;
			}

			const undo = async () => {
				// From the player again: the desktop is the one writer this check exists to catch.
				const current = (await fetchPlaylists()).find(
					(entry) => entry.id === target.id,
				);

				// Those indices are only ours while nothing else has touched the playlist: if the count moved, removing that range takes somebody else's tracks.
				if (!current || current.itemCount !== after) {
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
