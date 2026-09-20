import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import {
	fetchPlaylistAnnotations,
	removePlaylistRows,
	runsOf,
} from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { AddedRows, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// A copy or a fill answers where the rows landed, so nothing here reads the target's item count
// before or after: an empty `positions` on a write that still answered is what an autoplaylist
// swallowing it looks like, and needs no read to see.
export function useAddTracks() {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const { origin, token } = discovery;

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

			const refuse = (writePlaylistsOff = false) =>
				pushToast({
					tone: "error",
					message: translate(
						writePlaylistsOff ? "add.writePlaylistsOff" : "add.smartPlaylist",
						{ playlist: target.title },
					),
				});

			let added: AddedRows;
			try {
				added = await source.addTo(target.id, itemIndices);
			} catch (error) {
				refuse(error instanceof Error && error.cause === 403);
				return;
			}

			if (added.positions.length === 0) {
				refuse();
				return;
			}

			const runs = runsOf(added.positions);
			const landedStructure = added.structure;

			const undo = async () => {
				if (!origin || !token) {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
					return;
				}

				const structure =
					landedStructure ??
					(await fetchPlaylistAnnotations(origin, token))?.find(
						(entry) => entry.id === target.id,
					)?.structure;

				if (structure === undefined) {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
					return;
				}

				try {
					await removePlaylistRows(origin, token, target.id, {
						structure,
						runs,
					});
					await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				} catch (error) {
					const message =
						error instanceof Error && error.cause === 409
							? translate("add.undoStale", { playlist: target.title })
							: translate("add.undoFailed");
					pushToast({ tone: "error", message });
				}
			};

			pushToast({
				message: translate("add.added", { count, playlist: target.title }),
				action: { label: translate("action.undo"), run: undo },
			});
		},
		[queryClient, origin, token],
	);
}
