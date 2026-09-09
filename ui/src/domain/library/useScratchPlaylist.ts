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

export const SCRATCH_PIN_KEY = "jean.scratchPlaylist";

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
		const byId = isScratchPlaylist(pinned) ? pinned : null;
		return byId ?? playlists.find(isScratchPlaylist) ?? null;
	}, [playlists, pinnedId]);

	const held = useMemo(() => scratchContentsOf(playlist), [playlist]);

	const holdsView = useCallback(
		(kind: string, label: string | null, count: number) =>
			playlist !== null &&
			held?.kind === kind &&
			held?.label === label &&
			playlist.itemCount === count,
		[playlist, held],
	);

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

				const heldCount = source.needsHeldCount
					? ((await fetchPlaylists()).find((entry) => entry.id === target.id)
							?.itemCount ?? 0)
					: 0;
				await source.fill(target.id, refs, heldCount);

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
