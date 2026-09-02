import { Shuffle } from "lucide-react";
import { formatTime } from "@/domain/player/position";
import {
	usePlaybackOrder,
	usePlayer,
	usePlayPause,
	useSeek,
	useTransport,
	useVolume,
} from "@/domain/player/usePlayer";
import { artworkUrl, readTrack } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsed } from "./SeekBar";
import styles from "./StatusBar.module.css";
import { Volume, VolumePopover } from "./Volume";

// Times are their own leaf so the animation frame loop repaints two spans
// rather than the whole bar.
function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const [showRemaining, setShowRemaining] = useStoredState(
		"jean.timeRemaining",
		false,
	);
	const elapsed = useElapsed(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	// A length is what a countdown counts against, and the player reports none
	// for a stream. The preference is kept either way; only the reading falls
	// back, so a track that has one goes back to counting down.
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

// One component, two shapes: full transport on desktop, compact on mobile. The
// seek bar spans the whole width above both.

export function StatusBar({
	isQueueOpen,
	onToggleQueue,
	onOpenNowPlaying,
	onRevealNowPlaying,
}: {
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	// Tapping the block toggles; a swipe up only ever opens. "Up" is a direction
	// rather than a switch -- there is nothing for it to mean when the screen is
	// already up, and on a phone the bar is not even on screen then.
	onOpenNowPlaying: () => void;
	onRevealNowPlaying: () => void;
}) {
	const { data: snapshot, isPending, isError, error } = usePlayer();
	const isCompactViewport = useIsCompactViewport();
	const { volume, setValue, setMuted } = useVolume();

	// On the row rather than the whole footer, so it starts below the seek bar:
	// that is a 4px strip at the very top which owns the vertical axis for
	// scrubbing, and a swipe beginning there is a scrub, not a request for this
	// screen.
	const swipeUp = useSwipe({ onUp: onRevealNowPlaying });

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const order = usePlaybackOrder();

	if (isPending || isError) {
		return (
			<footer className={styles.statusbar}>
				<p className={styles.notice}>
					{isPending
						? "Connecting to the player…"
						: `Can’t reach the player — ${error.message}`}
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
				{/* The whole block, not a button beside it: a 200px target instead of
            a 44px one, which on a phone is the difference between reaching for
            it and aiming at it. */}
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
					{/* Everything except Play is desktop-only now. On a phone the strip is
              one thumb-sized action and a way into the now-playing screen,
              which is where shuffle, skipping and the queue moved -- there they
              are full-sized targets rather than 32px ones wedged around Play.

              Playback order is global player state, so it belongs with the
              other global controls rather than in a view header, where sitting
              next to Play made it read as "shuffle these tracks" -- which is
              not what it does. Left of the transport, not among it: this is the
              mode the buttons to its right operate in, not a fourth button. */}
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

					{/* Left of Play on a phone, so Play stays the rightmost thing in the
              bar and therefore the closest to a right thumb. It is the player's
              volume rather than the handset's, so the hardware keys cannot
              reach it and it has to be here. */}
					{isCompactViewport ? (
						<VolumePopover volume={volume} onChange={setValue} />
					) : null}

					<PlayToggle
						isPlaying={isPlaying}
						onToggle={() => playPause.mutate()}
					/>

					{/* Right of the transport as playback order is left of it, and the
              pair balances the group around Play. Order is the rule the buttons
              follow when nothing is queued; the queue is what overrides it. */}
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
						<Volume
							volume={volume}
							onChange={setValue}
							onToggleMute={() => setMuted(!volume?.isMuted)}
						/>
					</div>
				)}
			</div>
		</footer>
	);
}
