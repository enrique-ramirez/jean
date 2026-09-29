import type { PlaylistInfo } from "@/shared/api/types";
import type { Translate } from "@/shared/i18n/locale";

const PREFIX = "#Jean";

const SCRATCH_PREFIX = `${PREFIX} [`;
const SCRATCH_SUFFIX = "]";

export const SCRATCH_KIND = {
	search: "search",
	shelf: "shelf",
	genre: "genre",
	album: "album",
	artist: "artist",
	all: "all music",
} as const;

export type ScratchKind = (typeof SCRATCH_KIND)[keyof typeof SCRATCH_KIND];

const SCRATCH_KINDS: ReadonlySet<string> = new Set(Object.values(SCRATCH_KIND));

const isScratchKind = (kind: string): kind is ScratchKind =>
	SCRATCH_KINDS.has(kind);

export interface ScratchContents {
	kind: ScratchKind;
	label: string;
}

export const scratchName = (
	held: ScratchContents | null | undefined,
	t: Translate,
) =>
	held?.kind === SCRATCH_KIND.all ? t("library.allMusic") : held?.label || null;

export const scratchTitle = (kind: ScratchKind, label?: string | null) =>
	`${SCRATCH_PREFIX}${label ? `${kind}: ${label}` : kind}${SCRATCH_SUFFIX}`;

export const isScratchPlaylist = (
	playlist: PlaylistInfo | null | undefined,
): playlist is PlaylistInfo => playlist != null && playlist.role === "scratch";

export function scratchContentsOf(
	playlist: PlaylistInfo | null | undefined,
): ScratchContents | null {
	const title = playlist?.title;
	if (!title?.startsWith(SCRATCH_PREFIX) || !title.endsWith(SCRATCH_SUFFIX))
		return null;
	const body = title.slice(SCRATCH_PREFIX.length, -SCRATCH_SUFFIX.length);
	const at = body.indexOf(": ");
	const kind = at === -1 ? body : body.slice(0, at);
	if (!isScratchKind(kind)) return null;
	return { kind, label: at === -1 ? "" : body.slice(at + 2) };
}

export function queryOfScratchPlaylist(
	playlist: PlaylistInfo | null | undefined,
) {
	const held = scratchContentsOf(playlist);
	return held && held.kind === SCRATCH_KIND.search ? held.label : null;
}

export const withoutScratchPlaylist = (playlists: PlaylistInfo[]) =>
	playlists.filter((entry) => entry.role !== "scratch");
