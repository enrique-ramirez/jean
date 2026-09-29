import { formatTime } from "@/domain/player/position";
import { useAudibleVolume } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import {
	useAudiblePlayer,
	usePlaybackOrder,
	usePlayer,
	usePlayPause,
	usePrevious,
	useResolvedPlaylistId,
	useSeek,
	useTransport,
} from "@/domain/player/usePlayer";
import { coverKey } from "@/domain/track/fields";
import { canonicalPlayingArtworkUrl } from "@/domain/track/librarySource";
import { playingArtworkUrl } from "@/shared/api/artwork";
import { isFooJeanReady, permitsPlaybackControl } from "@/shared/api/discovery";
import { readTrack } from "@/shared/api/playerState";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { ListenHere, playerNameOf } from "./ListenHere";
import type { OutputPicker } from "./OutputDevices";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import { ShuffleToggle } from "./ShuffleToggle";
import styles from "./StatusBar.module.css";
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
	const canControlPlayback = permitsPlaybackControl(discovery);
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
	const previous = usePrevious();
	const order = usePlaybackOrder();
	const playlistId = useResolvedPlaylistId(
		snapshot?.player?.activeItem?.playlistGuid ?? null,
	);

	const origin = isFooJeanReady(discovery) ? discovery.origin : null;
	const outputsQuery = useOutputs();

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
	const track = readTrack(player);
	const item = player.activeItem;
	const isPlaying = player.playbackState === "playing";
	const hasTrack = Boolean(item && item.index >= 0);

	const album = item.album;
	const credited = item.albumArtist || item.columns[0] || null;
	const canonical = album
		? canonicalPlayingArtworkUrl(origin, album, credited || "")
		: null;

	const artwork = !track ? null : (canonical ?? playingArtworkUrl(origin));
	const identity = !track
		? undefined
		: album
			? coverKey(credited, album)
			: coverKey(track.artist, track.title, "track");

	const previousLabel = canControlPlayback
		? t("shortcut.previousTrack")
		: t("player.controlOffName", { control: t("shortcut.previousTrack") });
	const nextLabel = canControlPlayback
		? t("shortcut.nextTrack")
		: t("player.controlOffName", { control: t("shortcut.nextTrack") });

	return (
		<footer className={styles.statusbar}>
			<SeekBar
				snapshot={snapshot}
				onSeek={canControlPlayback ? (position) => seek.mutate(position) : NOOP}
				disabled={!canControlPlayback}
			/>

			<div className={styles.row} {...swipeUp}>
				<button
					type="button"
					className={styles.now}
					aria-label={t("player.showCurrentTrack")}
					onClick={onOpenNowPlaying}
				>
					<Artwork
						key={
							hasTrack && playlistId !== undefined
								? `${playlistId}:${item.index}`
								: "idle"
						}
						src={artwork}
						identity={identity}
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
							<ShuffleToggle
								order={order}
								className={styles.order}
								size={16}
								disabled={!canControlPlayback}
							/>

							<button
								type="button"
								className={styles.skip}
								aria-disabled={canControlPlayback ? undefined : "true"}
								aria-label={previousLabel}
								onClick={canControlPlayback ? () => previous() : undefined}
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
									disabled={!canControlPlayback}
									outputs={outputs}
								/>
							) : null}
						</>
					) : null}

					<PlayToggle
						isPlaying={isPlaying}
						onToggle={() => playPause.mutate()}
						disabled={!canControlPlayback}
					/>

					{isCompactViewport ? null : (
						<>
							<button
								type="button"
								className={styles.skip}
								aria-disabled={canControlPlayback ? undefined : "true"}
								aria-label={nextLabel}
								onClick={
									canControlPlayback ? () => transport.next.mutate() : undefined
								}
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
								disabled={!canControlPlayback}
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
