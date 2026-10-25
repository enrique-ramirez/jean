import { useEffect } from "react";

import { deviceId } from "@/domain/player/device";
import { acknowledgeNotice, useSession } from "@/domain/player/session";
import {
	creatorOf,
	markRaised,
	raisedMark,
	type SessionCreator,
	unraisedReports,
	useSessionDocument,
} from "@/domain/player/sessionDocument";
import { usePlayer } from "@/domain/player/usePlayer";
import { nameOfTrack } from "@/domain/track/trackName";
import { libraryOrigin } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { pushToast } from "@/shared/ui/toastStore";

function endedPhrase(
	creator: SessionCreator | undefined,
	player: string,
	t: Translate,
): string {
	if (creator?.deviceId === deviceId()) return t("listen.endedOwn", { player });
	if (creator?.name) return t("listen.ended", { device: creator.name, player });
	return t("listen.endedUnknown", { player });
}

export function useSessionNotices() {
	const t = useTranslate();
	const { notice } = useSession();
	const sessionDocument = useSessionDocument();
	const { discovery } = useFooJean();
	const { data: snapshot } = usePlayer();
	const player =
		discovery.state.kind === "ready"
			? discovery.state.capabilities.playerName
			: (snapshot?.player?.info.name ?? "");
	const origin = libraryOrigin(discovery);

	useEffect(() => {
		if (!notice || !acknowledgeNotice(notice)) return;
		pushToast({
			tone: "neutral",
			message:
				notice.kind === "ended"
					? endedPhrase(creatorOf(notice.id), player, t)
					: t("listen.takenBack", { player }),
		});
	}, [notice, player, t]);

	useEffect(() => {
		if (!sessionDocument) return;
		const unraised = unraisedReports(sessionDocument, raisedMark());
		const latest = unraised.at(-1);
		if (!latest) return;
		markRaised(sessionDocument.id, latest.sequence);
		for (const report of unraised)
			if (report.kind === "undecodable")
				void nameOfTrack(origin, report).then((track) =>
					pushToast({
						tone: "error",
						message: t("listen.skipped", { track }),
					}),
				);
	}, [sessionDocument, origin, t]);
}
