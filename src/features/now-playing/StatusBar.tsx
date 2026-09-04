import { Shuffle } from "lucide-react";
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
import { artworkUrl, readTrack } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { ListenHere } from "./ListenHere";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsed } from "./SeekBar";
import styles from "./StatusBar.module.css";
import { Volume, VolumePopover } from "./Volume";

// Its own leaf so the animation frame loop repaints two spans rather than the whole bar.
function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const [showRemaining, setShowRemaining] = useStoredState(
		"jean.timeRemaining",
		false,
	);
	const elapsed = useElapsed(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	// The player reports no duration for a stream, so only the reading falls back; the preference is kept either way.
	const isCountingDown = showRemaining && duration > 0;

	return (
		<button
			type="button"
			className={styles.times}
			title={showRemaining ? "Show time elapsed" : "Show time remaining"}
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
	const { isPending, isError, error } = usePlayer();
	const snapshot = useAudiblePlayer();
	const isCompactViewport = useIsCompactViewport();
	// While the sound is on this device the player's volume sits before the capture, so a fader pointed at it would move and change nothing audible.
	// Where the platform gives no level at all, as iOS does, the control is dropped rather than drawn dead.
	const {
		isHere,
		volume: shownVolume,
		setValue: changeVolume,
		toggleMute,
		hasFader,
	} = useAudibleVolume();

	// On the row rather than the footer, so it starts below the seek bar: that strip owns the vertical axis, and a swipe beginning there is a scrub.
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
						? `Can’t reach the player — ${error.message}`
						: "Connecting to the player…"}
				</p>
			</footer>
		);
	}

	const { player } = snapshot;
	const track = readTrack(player);
	const item = player.activeItem;
	const isPlaying = player.playbackState === "playing";
	const hasTrack = Boolean(item && item.index >= 0);

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
					aria-label="Show current track"
					onClick={onOpenNowPlaying}
				>
					<Artwork
						key={hasTrack ? `${item.playlistId}:${item.index}` : "idle"}
						src={hasTrack ? artworkUrl(item.playlistId, item.index) : null}
						size={44}
						className={styles.art}
					/>

					<div className={styles.names}>
						<span className={styles.title}>
							{track?.title ?? "Nothing playing"}
						</span>
						<span className={styles.artist}>{track?.artist ?? "—"}</span>
					</div>
				</button>

				<div className={styles.transport}>
					{isCompactViewport ? null : (
						<>
							<button
								type="button"
								className={styles.order}
								aria-label="Shuffle"
								aria-pressed={order.isShuffle}
								disabled={!order.canShuffle}
								title={
									order.orderName
										? `Playback order: ${order.orderName}`
										: "Shuffle"
								}
								onClick={order.toggleShuffle}
							>
								<Shuffle size={16} strokeWidth={2} />
							</button>

							<button
								type="button"
								className={styles.skip}
								aria-label="Previous track"
								onClick={() => transport.previous.mutate()}
							>
								<SkipBackIcon size={18} />
							</button>
						</>
					)}

					{isCompactViewport ? (
						<>
							<ListenHere playerName={player.info.title ?? player.info.name} />
							{hasFader ? (
								<VolumePopover
									volume={shownVolume}
									onChange={changeVolume}
									label={isHere ? "Volume on this device" : "Volume"}
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
								aria-label="Next track"
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
						<ListenHere playerName={player.info.title ?? player.info.name} />
						{hasFader ? (
							<Volume
								volume={shownVolume}
								onChange={changeVolume}
								onToggleMute={toggleMute}
								label={isHere ? "Volume on this device" : "Volume"}
							/>
						) : null}
					</div>
				)}
			</div>
		</footer>
	);
}
