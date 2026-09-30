import { movePlaylistRows, sortPlaylistRows } from "@/shared/api/playlists";
import type { Phrase } from "@/shared/i18n/en";

export type ReorderEdit =
	| { kind: "move"; positions: number[]; to: number; order: Int32Array }
	| { kind: "sort"; pattern: string; ordering: string };

export const REFUSAL_PHRASES: Record<
	"moved" | "locked" | "other",
	Extract<Phrase, `playlist.move${string}`>
> = {
	moved: "playlist.moveRefusedMoved",
	locked: "playlist.moveRefusedLocked",
	other: "playlist.moveFailed",
};

export async function sendReorderEdit(
	origin: string,
	playlistId: string,
	structure: string,
	edit: ReorderEdit,
) {
	if (edit.kind === "sort")
		return sortPlaylistRows(origin, playlistId, {
			structure,
			pattern: edit.pattern,
		});

	const result = await movePlaylistRows(origin, playlistId, {
		structure,
		ordinals: edit.positions,
		to: edit.to,
	});
	return result.ok
		? { ...result, value: { ...result.value, order: edit.order } }
		: result;
}
