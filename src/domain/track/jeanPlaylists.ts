import type { PlaylistInfo } from "@/shared/api/types";

// beefweb has no hidden or app-owned playlist and it cannot be faked, so
// ownership is declared in the title: anything beginning `#Jean` is Jean's
// plumbing, anything else is the user's music and is never reinterpreted.
const PREFIX = "#Jean";

// ---- the library -----------------------------------------------------------

// Matched exactly. Resolving anything loosely titled "Library" once adopted a
// handful of production-music cues as somebody's entire collection.
export const LIBRARY_TITLE = `${PREFIX} Library`;

const isLibraryPlaylist = (playlist: PlaylistInfo | null | undefined) =>
	playlist?.title === LIBRARY_TITLE;

export const findLibraryPlaylist = (playlists: PlaylistInfo[]) =>
	playlists.find(isLibraryPlaylist) ?? null;

// A suggestion for the setup screen to offer renaming, never a way to resolve
// the library: a near miss is the guess this design removes.
export const looksLikeLibrary = (playlist: PlaylistInfo | null | undefined) => {
	const title = playlist?.title?.trim().toLowerCase();
	return title === "library" || title === LIBRARY_TITLE.toLowerCase();
};

// ---- the scratch -----------------------------------------------------------

// The trailing `]` is what keeps a scratch title from ever matching the
// library playlist.
const SCRATCH_PREFIX = `${PREFIX} [`;
const SCRATCH_SUFFIX = "]";

// Which kind of view filled it, not just what it was called: `Most played` is
// both the name of a shelf and a plausible thing to type at the search field,
// and the two produce different sets.
export const SCRATCH_KIND = {
	search: "search",
	shelf: "shelf",
	all: "all music",
} as const;

export type ScratchKind = (typeof SCRATCH_KIND)[keyof typeof SCRATCH_KIND];

export interface ScratchContents {
	kind: string;
	label: string;
}

// Named here rather than in the view, because the sidebar, the status bar and
// the view itself all have to call it the same thing.
export const ALL_MUSIC = "All music";

export const scratchName = (held: ScratchContents | null | undefined) =>
	held?.kind === SCRATCH_KIND.all ? ALL_MUSIC : held?.label || null;

export const scratchTitle = (kind: string, label?: string | null) =>
	`${SCRATCH_PREFIX}${label ? `${kind}: ${label}` : kind}${SCRATCH_SUFFIX}`;

export const isScratchPlaylist = (
	playlist: PlaylistInfo | null | undefined,
): playlist is PlaylistInfo =>
	// The suggested rewrite guards only the first of the two reads.
	// biome-ignore lint/complexity/useOptionalChain: guards both reads, see above
	playlist != null &&
	playlist.title.startsWith(SCRATCH_PREFIX) &&
	playlist.title.endsWith(SCRATCH_SUFFIX);

// Split on the *first* separator, so a query containing a colon round-trips.
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

// Only a search can be taken back into the field; a shelf is restored by
// opening its route.
export function queryOfScratchPlaylist(
	playlist: PlaylistInfo | null | undefined,
) {
	const held = scratchContentsOf(playlist);
	return held && held.kind === SCRATCH_KIND.search ? held.label : null;
}

// ---- the namespace ---------------------------------------------------------

const isJeanPlaylist = (playlist: PlaylistInfo | null | undefined) =>
	Boolean(playlist?.title?.startsWith(PREFIX));

export const withoutJeanPlaylists = (playlists: PlaylistInfo[]) =>
	playlists.filter((entry) => !isJeanPlaylist(entry));
