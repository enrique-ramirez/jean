import { useConnection } from "@/domain/player/connection";
import { useAudibleVolume } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import {
	useCanControlPlayback,
	usePlaybackRefusal,
	whenAllowed,
} from "@/domain/player/usePlaybackControl";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useAudiblePlayer, usePlayer } from "@/domain/player/usePlayer";
import { useResolvedPlaylistId } from "@/domain/player/usePlaylists";
import {
	usePlayPause,
	usePrevious,
	useSeek,
	useTransport,
} from "@/domain/player/useTransport";
import { namedTrack } from "@/domain/track/fields";
import { usePlayingTrackDragSource } from "@/domain/track/useTrackDragSource";
import { fooJeanOrigin } from "@/shared/api/discovery";
import { playingTrack } from "@/shared/api/playerState";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { formatTime } from "@/shared/lib/time";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { ListenHere, playerNameOf } from "./ListenHere";
import type { OutputPicker } from "./OutputDevices";
import { PlaybackOrderButton } from "./PlaybackOrderButton";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import styles from "./StatusBar.module.css";
import { usePlayingCover } from "./usePlayingCover";
import { Volume, VolumePopover } from "./Volume";

const NOOP = () => {};

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
	const { isPending } = usePlayer();
	const snapshot = useAudiblePlayer();
	const { discovery } = useFooJean();
	const canControlPlayback = useCanControlPlayback();
	const refusal = usePlaybackRefusal();
	const isConnected = useConnection() === "connected";
	const isCompactViewport = useIsCompactViewport();
	// iOS exposes no level to set, so the fader is dropped rather than drawn dead.
	const {
		isHere,
		volume: shownVolume,
		setValue: changeVolume,
		toggleMute,
		hasFader,
		refusal: volumeRefusal,
	} = useAudibleVolume();

	const swipeUp = useSwipe({ onUp: onRevealNowPlaying });

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const previous = usePrevious();
	const order = usePlaybackOrder();
	const playlistId = useResolvedPlaylistId(
		snapshot?.player?.activeItem?.playlistGuid ?? null,
	);

	const origin = fooJeanOrigin(discovery);
	const outputsQuery = useOutputs();

	const track = namedTrack(playingTrack(snapshot?.player), t);
	const { identity, src: artwork } = usePlayingCover(
		track,
		snapshot?.player?.activeItem,
		origin,
	);
	const playingDrag = usePlayingTrackDragSource({
		playlistId: playlistId ?? null,
		index: snapshot?.player?.activeItem?.index ?? -1,
		title: track?.title ?? null,
	});

	if (isPending || !snapshot) {
		return (
			<footer className={styles.statusbar}>
				<p className={styles.notice}>{t("player.connecting")}</p>
			</footer>
		);
	}

	const { player } = snapshot;
	// Absent while listening here: the fader above is this device's own, and an output device
	// picker beside it would sit next to a control that no longer reaches foobar2000.
	const outputs: OutputPicker | undefined =
		!isHere && outputsQuery.isAvailable
			? {
					devices: outputsQuery.devices,
					activeId: player.outputDeviceId,
					onChoose: outputsQuery.choose,
					onOpen: outputsQuery.refetch,
				}
			: undefined;
	const item = player.activeItem;
	const isPlaying = player.playbackState === "playing";
	const hasTrack = Boolean(item && item.index >= 0);

	const previousLabel = t("shortcut.previousTrack");
	const nextLabel = t("shortcut.nextTrack");

	return (
		<footer className={styles.statusbar} data-connected={isConnected}>
			<SeekBar
				snapshot={snapshot}
				onSeek={refusal === null ? (position) => seek.mutate(position) : NOOP}
				refusal={refusal}
			/>

			<div className={styles.row} {...swipeUp}>
				<button
					type="button"
					className={styles.now}
					aria-label={t("player.showCurrentTrack")}
					onClick={() => {
						if (!playingDrag.didDrag()) onOpenNowPlaying();
					}}
					{...playingDrag.dragProps}
				>
					<Artwork
						key={
							hasTrack && playlistId !== undefined
								? `${playlistId}:${item.index}`
								: "idle"
						}
						src={artwork}
						identity={identity}
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
							<PlaybackOrderButton
								order={order}
								className={styles.order}
								size={16}
								refusal={refusal}
							/>

							<button
								type="button"
								className={styles.skip}
								aria-label={previousLabel}
								{...whenAllowed(refusal, () => previous(), previousLabel, t)}
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
									refusal={volumeRefusal}
									outputs={outputs}
								/>
							) : null}
						</>
					) : null}

					<PlayToggle
						isPlaying={isPlaying}
						onToggle={() => playPause.mutate()}
						refusal={refusal}
					/>

					{isCompactViewport ? null : (
						<>
							<button
								type="button"
								className={styles.skip}
								aria-label={nextLabel}
								{...whenAllowed(
									refusal,
									() => transport.next.mutate(),
									nextLabel,
									t,
								)}
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
								refusal={volumeRefusal}
								outputs={outputs}
							/>
						) : null}
					</div>
				)}
			</div>

			{canControlPlayback ? null : (
				<p className={styles.reason}>{t("player.controlOff")}</p>
			)}
		</footer>
	);
}
