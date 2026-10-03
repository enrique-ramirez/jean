import {
	movePlaylistRows,
	removePlaylistRows,
	sortPlaylistRows,
} from "@/shared/api/playlists";
import type { Phrase } from "@/shared/i18n/en";

export type RowEdit =
	| { kind: "move"; positions: number[]; to: number; order: Int32Array }
	| { kind: "remove"; positions: number[]; order: Int32Array }
	| { kind: "sort"; pattern: string; ordering: string };

export type Refusal = "moved" | "locked" | "other";

type RefusalPhrase = Extract<
	Phrase,
	`playlist.move${string}` | `playlist.remove${string}`
>;

const REORDER_REFUSALS: Record<Refusal, RefusalPhrase> = {
	moved: "playlist.moveRefusedMoved",
	locked: "playlist.moveRefusedLocked",
	other: "playlist.moveFailed",
};

export const REFUSAL_PHRASES: Record<
	RowEdit["kind"],
	Record<Refusal, RefusalPhrase>
> = {
	move: REORDER_REFUSALS,
	sort: REORDER_REFUSALS,
	remove: {
		moved: "playlist.removeRefusedMoved",
		locked: "playlist.moveRefusedLocked",
		other: "playlist.removeFailed",
	},
};

export async function sendRowEdit(
	origin: string,
	playlistId: string,
	structure: string,
	edit: RowEdit,
) {
	if (edit.kind === "sort")
		return sortPlaylistRows(origin, playlistId, {
			structure,
			pattern: edit.pattern,
		});

	const result =
		edit.kind === "move"
			? await movePlaylistRows(origin, playlistId, {
					structure,
					ordinals: edit.positions,
					to: edit.to,
				})
			: await removePlaylistRows(origin, playlistId, {
					structure,
					ordinals: edit.positions,
				});
	return result.ok
		? { ...result, value: { ...result.value, order: edit.order } }
		: result;
}
