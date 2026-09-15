import { formatTime } from "@/domain/player/position";
import { useAudibleVolume } from "@/domain/player/useListener";
import {
	useAudiblePlayer,
	usePlaybackOrder,
	usePlayer,
	usePlayPause,
	useSeek,
	useTransport,
} from "@/domain/player/usePlayer";
import { coverKey } from "@/domain/track/fields";
import { readTrack } from "@/shared/api/beefweb";
import { isFooJeanReady, playingArtworkUrl } from "@/shared/api/fooJean";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { ListenHere, playerNameOf } from "./ListenHere";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import { ShuffleToggle } from "./ShuffleToggle";
import styles from "./StatusBar.module.css";
import { Volume, VolumePopover } from "./Volume";

function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const t = useTranslate();
	const [showRemaining, setShowRemaining] = useStoredState(
		"jean.timeRemaining",
		false,
	);
	const elapsed = useElapsedSeconds(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	const isCountingDown = showRemaining && duration > 0;

	return (
		<button
			type="button"
			className={styles.times}
			title={t(showRemaining ? "player.showElapsed" : "player.showRemaining")}
			onClick={() => setShowRemaining((current) => !current)}
		>
			<span className="tabular">
				{isCountingDown
					? `-${formatTime(Math.max(0, duration - elapsed))}`
					: formatTime(elapsed)}
			</span>
			<span className={styles.separator}>/</span>
			<span className="tabular">{formatTime(duration)}</span>
		</button>
	);
}

export function StatusBar({
	isQueueOpen,
	onToggleQueue,
	onOpenNowPlaying,
	onRevealNowPlaying,
}: {
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	onOpenNowPlaying: () => void;
	onRevealNowPlaying: () => void;
}) {
	const t = useTranslate();
	const { isPending, isError, error } = usePlayer();
	const snapshot = useAudiblePlayer();
	const { discovery } = useFooJean();
	const isCompactViewport = useIsCompactViewport();
	// iOS exposes no level to set, so the fader is dropped rather than drawn dead.
	const {
		isHere,
		volume: shownVolume,
		setValue: changeVolume,
		toggleMute,
		hasFader,
	} = useAudibleVolume();

	const swipeUp = useSwipe({ onUp: onRevealNowPlaying });

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const order = usePlaybackOrder();

	if (isPending || isError || !snapshot) {
		return (
			<footer className={styles.statusbar}>
				<p className={styles.notice}>
					{isError
						? t("player.unreachable", { message: error.message })
						: t("player.connecting")}
				</p>
			</footer>
		);
	}

	const { player } = snapshot;
	const track = readTrack(player);
	const item = player.activeItem;
	const isPlaying = player.playbackState === "playing";
	const hasTrack = Boolean(item && item.index >= 0);
	const artwork = playingArtworkUrl(
		isFooJeanReady(discovery) ? discovery.origin : null,
	);

	return (
		<footer className={styles.statusbar}>
			<SeekBar
				snapshot={snapshot}
				onSeek={(position) => seek.mutate(position)}
			/>

			<div className={styles.row} {...swipeUp}>
				<button
					type="button"
					className={styles.now}
					aria-label={t("player.showCurrentTrack")}
					onClick={onOpenNowPlaying}
				>
					<Artwork
						key={hasTrack ? `${item.playlistId}:${item.index}` : "idle"}
						src={track ? artwork : null}
						identity={
							track ? coverKey(track.artist, track.title, "track") : undefined
						}
						size={44}
						className={styles.art}
					/>

					<div className={styles.names}>
						<span className={styles.title}>
							{track?.title ?? t("player.nothingPlaying")}
						</span>
						<span className={styles.artist}>{track?.artist ?? "—"}</span>
					</div>
				</button>

				<div className={styles.transport}>
					{isCompactViewport ? null : (
						<>
							<ShuffleToggle order={order} className={styles.order} size={16} />

							<button
								type="button"
								className={styles.skip}
								aria-label={t("shortcut.previousTrack")}
								onClick={() => transport.previous.mutate()}
							>
								<SkipBackIcon size={18} />
							</button>
						</>
					)}

					{isCompactViewport ? (
						<>
							<ListenHere playerName={playerNameOf(player.info)} />
							{hasFader ? (
								<VolumePopover
									volume={shownVolume}
									onChange={changeVolume}
									label={t(isHere ? "player.volumeHere" : "player.volume")}
								/>
							) : null}
						</>
					) : null}

					<PlayToggle
						isPlaying={isPlaying}
						onToggle={() => playPause.mutate()}
					/>

					{isCompactViewport ? null : (
						<>
							<button
								type="button"
								className={styles.skip}
								aria-label={t("shortcut.nextTrack")}
								onClick={() => transport.next.mutate()}
							>
								<SkipForwardIcon size={18} />
							</button>

							<QueueButton isOpen={isQueueOpen} onToggle={onToggleQueue} />
						</>
					)}
				</div>

				{isCompactViewport ? null : (
					<div className={styles.trailing}>
						<Times snapshot={snapshot} />
						<ListenHere playerName={playerNameOf(player.info)} />
						{hasFader ? (
							<Volume
								volume={shownVolume}
								onChange={changeVolume}
								onToggleMute={toggleMute}
								label={t(isHere ? "player.volumeHere" : "player.volume")}
							/>
						) : null}
					</div>
				)}
			</div>
		</footer>
	);
}
