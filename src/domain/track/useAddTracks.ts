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
//
// The status code is not the outcome, and on the one failure that matters it
// is not even a hint. *Measured* against foobar2000 2.25.3 / beefweb 0.11:
// copying into an autoplaylist answers `204 No Content` and adds nothing,
// exactly as a copy into an ordinary playlist answers 204 and adds everything.
// Nothing in the six-field playlist schema says which kind a playlist is, so
// there is no asking beforehand either -- which leaves reading the count back
// as the only way to know, and it is therefore load-bearing rather than
// belt-and-braces. Without it the toast claimed a copy that never happened and
// offered an undo for rows that do not exist.

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

			// Fresh truth, both times, and from the player rather than the cache:
			// item changes are never pushed, so a cached itemCount is stale from the
			// first edit onwards and cannot see the desktop at all. The read is also
			// what makes undo exact -- items are appended, so the rows about to exist
			// are precisely [itemCount, itemCount + count).
			const countOf = async () => {
				const playlists = await fetchPlaylists();
				queryClient.setQueryData(PLAYLISTS_KEY, playlists);
				return (
					playlists.find((entry) => entry.id === target.id)?.itemCount ?? null
				);
			};

			// The fact first, the likely reason second, and in that order because only
			// the fact is certain: a 204 that changed nothing is all the player says,
			// and a smart playlist is much the commonest way to get one but not the
			// only conceivable one. A message that led with the cause would be a
			// guess dressed as a diagnosis the one time it is wrong.
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

			// A count that could not be read either side is not evidence of failure,
			// so the add is reported as sent and undo is withheld -- the arithmetic
			// undo depends on is exactly what is missing.
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
				// Read from the player for the same reason as above -- the desktop is
				// the one writer this check exists to catch.
				const current = (await fetchPlaylists()).find(
					(entry) => entry.id === target.id,
				);

				// Those indices are only ours while nothing else has touched the playlist: if
				// the count moved, removing that range takes somebody else's tracks.
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
