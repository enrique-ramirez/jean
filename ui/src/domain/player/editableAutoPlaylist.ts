import type { AutoPlaylistRequest } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";

export const isEditableAutoPlaylist = (playlist: PlaylistInfo) =>
	playlist.isAutoPlaylist &&
	(playlist.managed == null || playlist.managed.key === "");

// `foo_jean` refuses a key on an autoplaylist it did not make, so a foreign one is saved without
// the key, sort or force-sort it does not hold, and with the plain order a new query starts from.
export const editedAutoPlaylist = (
	playlist: PlaylistInfo,
	edit: { title: string; query: string },
): AutoPlaylistRequest => ({
	query: edit.query,
	...(playlist.managed
		? {
				key: playlist.managed.key,
				sort: playlist.managed.sort,
				forceSort: playlist.managed.forceSort,
			}
		: { sort: "", forceSort: false }),
	...(edit.title === playlist.title ? null : { title: edit.title }),
});
