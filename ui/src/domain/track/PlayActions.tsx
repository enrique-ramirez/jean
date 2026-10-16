import { Shuffle } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { NO_WAIT, type Wait } from "@/domain/library/useOverdue";
import {
	useCanControlPlayback,
	whenControllable,
} from "@/domain/player/usePlaybackControl";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useDeferredPress } from "@/shared/hooks/useDeferredPress";
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
	wait = NO_WAIT,
	children,
}: {
	browserRef: RefObject<TrackBrowserHandle | null>;
	trackCount: number;
	canPlaySets?: boolean;
	wait?: Wait;
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

	const press = useDeferredPress<"play" | "shuffle">(wait.isWaiting, (kind) => {
		if (isEmpty) return;
		if (kind === "play") play(0);
		else shufflePlay();
	});
	const isUnanswered = wait.isWaiting;

	const canShuffleHere = canPlaySets && order.canShuffle;

	const isPressable = !wait.isOverdue && (isUnanswered || !isEmpty);
	useKeymap(
		SCOPE.playlist,
		{ playAll: () => press("play") },
		{ enabled: canPlaySets && isPressable && canControlPlayback },
	);
	useKeymap(
		SCOPE.playlist,
		{ shufflePlay: () => press("shuffle") },
		{ enabled: canShuffleHere && isPressable && canControlPlayback },
	);

	const playLabel = t("player.play");
	const shuffleLabel = t("player.shuffle");

	return (
		<>
			{canPlaySets ? (
				<Button
					variant="primary"
					icon={PlayIcon}
					disabled={
						canControlPlayback && (wait.isOverdue || (!isUnanswered && isEmpty))
					}
					{...whenControllable(
						canControlPlayback,
						() => press("play"),
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
					disabled={
						canControlPlayback &&
						(wait.isOverdue || (!isUnanswered && isEmpty) || !order.canShuffle)
					}
					{...whenControllable(
						canControlPlayback,
						() => press("shuffle"),
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
