import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { usePlaybackOrder } from "@/domain/player/usePlayer";
import { useTranslate } from "@/shared/i18n/useTranslate";
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
	const order = usePlaybackOrder();
	const isEmpty = trackCount === 0;

	const play = (position: number) => browserRef.current?.play(position);

	const shufflePlay = () => {
		order.enableShuffle();
		play(Math.floor(Math.random() * trackCount));
	};

	const canShuffleHere = canPlaySets && !isEmpty && order.canShuffle;

	useKeymap(SCOPE.playlist, { shufflePlay }, { enabled: canShuffleHere });

	return (
		<>
			{canPlaySets ? (
				<Button
					variant="primary"
					icon={PlayIcon}
					onClick={() => play(0)}
					disabled={isEmpty}
				>
					{t("player.play")}
				</Button>
			) : null}

			{canPlaySets ? (
				<Button
					icon={Shuffle}
					disabled={isEmpty || !order.canShuffle}
					onClick={shufflePlay}
				>
					{t("player.shuffle")}
				</Button>
			) : null}

			{children}
		</>
	);
}
