import type { PlaylistInfo } from "@/shared/api/types";

// beefweb has no hidden or app-owned playlist, so ownership is declared in the title: anything
// beginning `#Jean` is Jean's plumbing, anything else is the user's music.
const PREFIX = "#Jean";

export const LIBRARY_TITLE = `${PREFIX} Library`;

const isLibraryPlaylist = (playlist: PlaylistInfo | null | undefined) =>
	playlist?.title === LIBRARY_TITLE;

export const findLibraryPlaylist = (playlists: PlaylistInfo[]) =>
	playlists.find(isLibraryPlaylist) ?? null;

export const looksLikeLibrary = (playlist: PlaylistInfo | null | undefined) => {
	const title = playlist?.title?.trim().toLowerCase();
	return title === "library" || title === LIBRARY_TITLE.toLowerCase();
};

const SCRATCH_PREFIX = `${PREFIX} [`;
const SCRATCH_SUFFIX = "]";

export const SCRATCH_KIND = {
	search: "search",
	shelf: "shelf",
	genre: "genre",
	all: "all music",
} as const;

export interface ScratchContents {
	kind: string;
	label: string;
}

export const ALL_MUSIC = "All music";

export const scratchName = (held: ScratchContents | null | undefined) =>
	held?.kind === SCRATCH_KIND.all ? ALL_MUSIC : held?.label || null;

export const scratchTitle = (kind: string, label?: string | null) =>
	`${SCRATCH_PREFIX}${label ? `${kind}: ${label}` : kind}${SCRATCH_SUFFIX}`;

export const isScratchPlaylist = (
	playlist: PlaylistInfo | null | undefined,
): playlist is PlaylistInfo =>
	// biome-ignore lint/complexity/useOptionalChain: the explicit null check is what narrows for the type predicate
	playlist != null &&
	playlist.title.startsWith(SCRATCH_PREFIX) &&
	playlist.title.endsWith(SCRATCH_SUFFIX);

export function scratchContentsOf(
	playlist: PlaylistInfo | null | undefined,
): ScratchContents | null {
	if (!isScratchPlaylist(playlist)) return null;
	const body = playlist.title.slice(
		SCRATCH_PREFIX.length,
		-SCRATCH_SUFFIX.length,
	);
	const at = body.indexOf(": ");
	return at === -1
		? { kind: body, label: "" }
		: { kind: body.slice(0, at), label: body.slice(at + 2) };
}

export function queryOfScratchPlaylist(
	playlist: PlaylistInfo | null | undefined,
) {
	const held = scratchContentsOf(playlist);
	return held && held.kind === SCRATCH_KIND.search ? held.label : null;
}

// Where library rows go so the queue has a (playlist, index) to address them by. Append-only and
// emptied rather than deleted: deleting a playlist the play queue points into crashes the player.
export const QUEUE_TITLE = `${PREFIX} Queue`;

export const findQueuePlaylist = (playlists: PlaylistInfo[]) =>
	playlists.find((entry) => entry.title === QUEUE_TITLE) ?? null;

const isJeanPlaylist = (playlist: PlaylistInfo | null | undefined) =>
	Boolean(playlist?.title?.startsWith(PREFIX));

export const withoutJeanPlaylists = (playlists: PlaylistInfo[]) =>
	playlists.filter((entry) => !isJeanPlaylist(entry));
