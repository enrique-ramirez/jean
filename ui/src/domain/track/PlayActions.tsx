import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import type { TrackBrowserHandle } from "./listTypes";

export function PlayActions({
	browserRef,
	trackCount,
	canPlaySets = true,
	children,
}: {
	browserRef: RefObject<TrackBrowserHandle | null>;
	trackCount: number;
	canPlaySets?: boolean;
	children?: ReactNode;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const canControlPlayback = useCanControlPlayback();
	const order = usePlaybackOrder();
	const isEmpty = trackCount === 0;

	const play = (position: number) => browserRef.current?.play(position);

	const shufflePlay = () => {
		order.enableShuffle();
		play(Math.floor(Math.random() * trackCount));
	};

	const canShuffleHere = canPlaySets && !isEmpty && order.canShuffle;

	useKeymap(
		SCOPE.playlist,
		{ playAll: () => play(0) },
		{ enabled: canPlaySets && !isEmpty && canControlPlayback },
	);
	useKeymap(
		SCOPE.playlist,
		{ shufflePlay },
		{ enabled: canShuffleHere && canControlPlayback },
	);

	const playLabel = t("player.play");
	const shuffleLabel = t("player.shuffle");

	return (
		<>
			{canPlaySets ? (
				<Button
					variant="primary"
					icon={PlayIcon}
					onClick={canControlPlayback ? () => play(0) : undefined}
					disabled={canControlPlayback && isEmpty}
					aria-disabled={canControlPlayback ? undefined : "true"}
					aria-label={
						canControlPlayback
							? undefined
							: say("player.controlOffName", { control: say("player.play") })
					}
				>
					{playLabel}
				</Button>
			) : null}

			{canPlaySets ? (
				<Button
					icon={Shuffle}
					disabled={canControlPlayback && (isEmpty || !order.canShuffle)}
					aria-disabled={canControlPlayback ? undefined : "true"}
					aria-label={
						canControlPlayback
							? undefined
							: t("player.controlOffName", { control: shuffleLabel })
					}
					onClick={canControlPlayback ? shufflePlay : undefined}
				>
					{shuffleLabel}
				</Button>
			) : null}

			{children}
		</>
	);
}
