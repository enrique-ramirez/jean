import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { removePlaylistRows, runsOf } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { AddedRows, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

const causeOf = (
	status: unknown,
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

			let added: AddedRows;
			try {
				added = await source.addTo(target.id, itemIndices);
			} catch (error) {
				const status = error instanceof Error ? error.cause : undefined;
				pushToast({
					tone: "error",
					message: translate(causeOf(status, target), {
						playlist: target.title,
					}),
				});
				return;
			}

			const runs = runsOf(added.positions);

			const undo = async () => {
				if (!origin || !token) {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
					return;
				}

				try {
					await removePlaylistRows(origin, token, target.id, {
						structure: added.structure,
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
