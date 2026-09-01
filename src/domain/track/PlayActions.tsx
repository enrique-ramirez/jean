import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { usePlaybackOrder } from "@/domain/player/usePlayer";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import type { TrackBrowserHandle } from "./listTypes";

// The two buttons at the head of any list of tracks, and the rule that makes
// them mean different things: Play starts at the beginning, Shuffle starts
// anywhere and turns the mode on.
//
// Shuffle here is the *action*, not the mode -- the mode lives in the status
// bar, where global player state belongs. Next to Play this reads as "play
// these, shuffled", so that is all it does: `POST /player/play/{plref}/{index}`
// makes that playlist the active one and the mode draws its next track from it.
// The mode does the shuffling; this only opens the door for it.
//
// Neither button touches the mode the other way round: a Play that quietly
// turned shuffle off would be reaching across the app to do it.
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
					onClick={() => {
						order.enableShuffle();
						play(Math.floor(Math.random() * trackCount));
					}}
				>
					Shuffle
				</Button>
			) : null}

			{children}
		</>
	);
}
