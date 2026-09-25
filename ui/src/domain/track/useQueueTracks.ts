import { useCallback } from "react";

import { useQueueActions } from "@/domain/player/useQueue";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

export const QUEUE_LIMIT = 1000;

export function useQueueTracks() {
	const { queue, canQueue, canControlPlayback } = useQueueActions();

	const queueTracks = useCallback(
		async ({
			source,
			itemIndices,
			at,
			drag = false,
		}: {
			source: LibrarySource;
			itemIndices: Refs;
			at?: number;
			drag?: boolean;
		}) => {
			if (!canQueue || itemIndices.length === 0) return;

			if (itemIndices.length > QUEUE_LIMIT) {
				pushToast({
					tone: "error",
					message: translate("queue.tooMany", { limit: QUEUE_LIMIT }),
				});
				return;
			}

			let built: Awaited<ReturnType<LibrarySource["queueTargets"]>>;
			try {
				built = await source.queueTargets(itemIndices);
			} catch {
				pushToast({
					tone: "error",
					message: translate("queue.noSource"),
				});
				return;
			}

			await queue(built, at, drag);
		},
		[canQueue, queue],
	);

	return { queueTracks, canQueue, canControlPlayback };
}
