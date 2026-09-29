import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { refusedStatusOf } from "@/shared/api/client";
import { runsOf } from "@/shared/api/fillEncoding";
import { removePlaylistRows } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { AddedRows, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

const causeOf = (
	status: number | null,
	target: PlaylistInfo,
):
	| "add.writePlaylistsOff"
	| "add.smartPlaylist"
	| "add.locked"
	| "add.failed" => {
	if (status === 403) return "add.writePlaylistsOff";
	if (status === 409)
		return target.isAutoPlaylist ? "add.smartPlaylist" : "add.locked";
	return "add.failed";
};

// A copy or a fill answers where the rows landed, so nothing here reads the target's item count
// before or after: a locked playlist is refused outright with `409`, and a `200` with an empty
// `positions` is a shape no route on a real player answers.
export function useAddTracks() {
	const queryClient = useQueryClient();
	const { discovery, recheck } = useFooJean();
	const { origin } = discovery;

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

			let added: AddedRows;
			try {
				added = await source.addTo(target.id, itemIndices);
			} catch (error) {
				const cause = causeOf(refusedStatusOf(error), target);
				pushToast({
					tone: "error",
					message: translate(cause, { playlist: target.title }),
				});
				if (cause === "add.writePlaylistsOff") recheck();
				return;
			}

			const runs = runsOf(added.positions);

			const undo = async () => {
				if (!origin) {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
					return;
				}

				const removed = await removePlaylistRows(origin, target.id, {
					structure: added.structure,
					runs,
				});
				if (!removed.ok) {
					const message =
						removed.reason === "refused" && removed.status === 409
							? translate("add.undoStale", { playlist: target.title })
							: translate("add.undoFailed");
					pushToast({ tone: "error", message });
					return;
				}
				await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			};

			pushToast({
				message: translate("add.added", { count, playlist: target.title }),
				action: { label: translate("action.undo"), run: undo },
			});
		},
		[queryClient, origin, recheck],
	);
}
