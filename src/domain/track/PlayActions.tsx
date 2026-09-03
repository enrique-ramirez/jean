import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { usePlaybackOrder } from "@/domain/player/usePlayer";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import type { TrackBrowserHandle } from "./listTypes";

// Shuffle here is the action, not the mode: it turns shuffle on and plays a random position, and Play never turns it back off.
export function PlayActions({
	browserRef,
	trackCount,
	canShuffle = true,
	children,
}: {
	browserRef: RefObject<TrackBrowserHandle | null>;
	trackCount: number;
	canShuffle?: boolean;
	children?: ReactNode;
}) {
	const order = usePlaybackOrder();
	const isEmpty = trackCount === 0;

	const play = (position: number) => browserRef.current?.play(position);

	const shufflePlay = () => {
		order.enableShuffle();
		play(Math.floor(Math.random() * trackCount));
	};

	const canShuffleHere = canShuffle && !isEmpty && order.canShuffle;

	useKeymap(SCOPE.playlist, { shufflePlay }, { enabled: canShuffleHere });

	return (
		<>
			<Button
				variant="primary"
				icon={PlayIcon}
				onClick={() => play(0)}
				disabled={isEmpty}
			>
				Play
			</Button>

			{canShuffle ? (
				<Button
					icon={Shuffle}
					disabled={isEmpty || !order.canShuffle}
					onClick={shufflePlay}
				>
					Shuffle
				</Button>
			) : null}

			{children}
		</>
	);
}
