import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { PLAYLISTS_KEY, playlistInfoOf } from "@/domain/player/usePlayer";
import {
	fetchPlaylistAnnotations,
	removePlaylistRows,
} from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// Copying into an autoplaylist answers 204 and adds nothing, exactly as a copy into an ordinary
// playlist answers 204 and adds everything, and nothing in the playlist schema says which kind it
// is, so reading the count back is the only way to know whether anything happened.
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

			const fetchAnnotations = async () =>
				origin && token ? await fetchPlaylistAnnotations(origin, token) : null;

			const countOf = async () => {
				const annotations = await fetchAnnotations();
				if (annotations)
					queryClient.setQueryData(
						PLAYLISTS_KEY,
						annotations.map(playlistInfoOf),
					);
				return (
					annotations?.find((entry) => entry.id === target.id)?.itemCount ??
					null
				);
			};

			const refuse = (writePlaylistsOff = false) =>
				pushToast({
					tone: "error",
					message: translate(
						writePlaylistsOff ? "add.writePlaylistsOff" : "add.smartPlaylist",
						{ playlist: target.title },
					),
				});

			const before = await countOf().catch(() => null);

			try {
				await source.addTo(target.id, itemIndices);
			} catch (error) {
				await countOf().catch(() => null);
				refuse(error instanceof Error && error.cause === 403);
				return;
			}

			const after = await countOf().catch(() => null);

			if (before === null || after === null) {
				pushToast({
					message: translate("add.added", { count, playlist: target.title }),
				});
				return;
			}

			if (after !== before + count) {
				refuse();
				return;
			}

			const undo = async () => {
				if (!origin || !token) {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
					return;
				}

				const current = (await fetchAnnotations())?.find(
					(entry) => entry.id === target.id,
				);

				// Those indices are only ours while nothing else has touched the playlist: if the count
				// moved, removing that range takes somebody else's tracks.
				if (!current || current.itemCount !== after) {
					pushToast({
						tone: "error",
						message: translate("add.undoStale", { playlist: target.title }),
					});
					return;
				}

				try {
					await removePlaylistRows(origin, token, target.id, {
						structure: current.structure,
						runs: [[before, count]],
					});
					await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				} catch {
					pushToast({ tone: "error", message: translate("add.undoFailed") });
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
