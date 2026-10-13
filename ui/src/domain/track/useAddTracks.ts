import { useCallback } from "react";
import { refusedStatusOf } from "@/shared/api/client";
import { runsOf } from "@/shared/api/fillEncoding";
import { type Duplicates, removePlaylistRows } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { askToConfirm } from "@/shared/ui/confirmStore";
import { pushToast } from "@/shared/ui/toastStore";
import type { AddedRows, LibrarySource } from "./librarySource";
import type { Refs } from "./project";

const causeOf = (
	status: number | null,
	target: PlaylistInfo,
):
	| "add.writePlaylistsOff"
	| "add.autoPlaylist"
	| "add.locked"
	| "add.failed" => {
	if (status === 403) return "add.writePlaylistsOff";
	if (status === 409)
		return target.isAutoPlaylist ? "add.autoPlaylist" : "add.locked";
	return "add.failed";
};

async function removeLanded(
	origin: string,
	target: PlaylistInfo,
	landed: AddedRows[],
): Promise<"removed" | "add.undoStale" | "add.undoFailed"> {
	let structure = landed[landed.length - 1].structure;

	for (const added of landed.toReversed()) {
		const removed = await removePlaylistRows(origin, target.id, {
			structure,
			runs: runsOf(added.positions),
		});
		if (!removed.ok)
			return removed.reason === "refused" && removed.status === 409
				? "add.undoStale"
				: "add.undoFailed";
		structure = removed.value.structure;
	}

	return "removed";
}

function announce(
	landed: AddedRows[],
	target: PlaylistInfo,
	origin: string | null,
) {
	const count = landed.reduce((sum, added) => sum + added.positions.length, 0);
	if (count === 0) return;

	const undo = async () => {
		const outcome = origin
			? await removeLanded(origin, target, landed)
			: "add.undoFailed";
		if (outcome !== "removed") {
			pushToast({
				tone: "error",
				message: translate(outcome, { playlist: target.title }),
			});
		}
	};

	pushToast({
		message: translate("add.added", { count, playlist: target.title }),
		action: { label: translate("action.undo"), run: undo },
	});
}

const duplicateQuestion = (
	skipped: number[],
	target: PlaylistInfo,
	titleOf: (ref: number) => string,
) => ({
	title: translate("add.duplicateTitle"),
	body:
		skipped.length === 1
			? translate("add.duplicateNamed", {
					track: titleOf(skipped[0]),
					playlist: target.title,
				})
			: translate("add.duplicateCount", {
					count: skipped.length,
					playlist: target.title,
				}),
	confirm: translate("add.duplicateAdd"),
	decline: translate("add.duplicateSkip"),
});

// A copy or a fill answers where the rows landed, so nothing here reads the target's item count
// before or after: a locked playlist is refused outright with `409`.
export function useAddTracks() {
	const { discovery, recheck } = useFooJean();
	const { origin } = discovery;

	return useCallback(
		async ({
			source,
			target,
			itemIndices,
			titleOf,
		}: {
			source: LibrarySource;
			target: PlaylistInfo;
			itemIndices: Refs;
			titleOf: (ref: number) => string;
		}) => {
			if (itemIndices.length === 0) return;

			const add = async (refs: Refs, duplicates: Duplicates) => {
				try {
					return await source.addTo(target.id, refs, duplicates);
				} catch (error) {
					const cause = causeOf(refusedStatusOf(error), target);
					pushToast({
						tone: "error",
						message: translate(cause, { playlist: target.title }),
					});
					if (cause === "add.writePlaylistsOff") recheck();
					return null;
				}
			};

			const fresh = await add(itemIndices, "skip");
			if (!fresh) return;

			const { skipped } = fresh;
			const addsAgain =
				skipped.length > 0 &&
				(await askToConfirm(duplicateQuestion(skipped, target, titleOf)));
			const again = addsAgain ? await add(skipped, "add") : null;

			announce(again ? [fresh, again] : [fresh], target, origin);
		},
		[origin, recheck],
	);
}
