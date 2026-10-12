import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import {
	useCanControlPlayback,
	whenControllable,
} from "@/domain/player/usePlaybackControl";
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
					disabled={canControlPlayback && isEmpty}
					{...whenControllable(
						canControlPlayback,
						() => play(0),
						say("player.play"),
						say,
					)}
				>
					{playLabel}
				</Button>
			) : null}

			{canPlaySets ? (
				<Button
					icon={Shuffle}
					disabled={canControlPlayback && (isEmpty || !order.canShuffle)}
					{...whenControllable(
						canControlPlayback,
						shufflePlay,
						shuffleLabel,
						t,
					)}
				>
					{shuffleLabel}
				</Button>
			) : null}

			{children}
		</>
	);
}
