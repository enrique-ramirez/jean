import { ChevronDown, Mic2, MoreHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAudibleVolume } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useAudiblePlayer, usePlayer } from "@/domain/player/usePlayer";
import { useResolvedPlaylistId } from "@/domain/player/usePlaylists";
import {
	usePlayPause,
	usePrevious,
	useSeek,
	useTransport,
} from "@/domain/player/useTransport";
import { ArtistLinks } from "@/domain/track/ArtistLinks";
import { coverKey, readValue } from "@/domain/track/fields";
import { canonicalPlayingArtworkUrl } from "@/domain/track/librarySource";
import { albumRoute, href, type PanelTab } from "@/domain/track/routes";
import { playingArtworkUrl } from "@/shared/api/artwork";
import { isFooJeanReady, permitsPlaybackControl } from "@/shared/api/discovery";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePresence } from "@/shared/hooks/usePresence";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { CoverWheel, useCoverWheel } from "./CoverWheel";
import { ListenHere, playerNameOf } from "./ListenHere";
import { type EditorOpening, LyricEditor } from "./LyricEditor";
import { LyricsScreen } from "./LyricsScreen";
import { parseLyrics } from "./lyricsFormat";
import styles from "./NowPlaying.module.css";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import type { OutputPicker } from "./OutputDevices";
import { PlaybackOrderButton } from "./PlaybackOrderButton";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { Rating } from "./Rating";
import { SeekBar } from "./SeekBar";
import { Times } from "./Times";
import { INFO_EXIT_MS, TrackInfo } from "./TrackInfo";
import { TrackPanels } from "./TrackPanels";
import { useCoverWindow } from "./useCoverWindow";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { VolumePopover } from "./Volume";

// Must match the exit animation in NowPlaying.module.css.
const SLIDE_MS = 280;

const NOOP = () => {};

export function NowPlaying({
	isOpen,
	isCompactViewport,
	isQueueOpen,
	onToggleQueue,
	playingFrom,
	onOpenPlayingFrom,
	onDismiss,
	tab,
	onSelectTab,
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	playingFrom: string | null;
	onOpenPlayingFrom?: () => void;
	onDismiss: () => void;
	tab: PanelTab | null;
	onSelectTab: (tab: PanelTab) => void;
}) {
	const t = useTranslate();
	const isPresent = usePresence(isOpen, SLIDE_MS);
	const [isInfoOpen, setIsInfoOpen] = useResettingState(false, [
		isOpen,
		isCompactViewport,
	]);
	const isInfoPresent = usePresence(isInfoOpen, INFO_EXIT_MS);

	const snapshot = useAudiblePlayer();
	const { data: live } = usePlayer();
	const { track, details } = useNowPlayingTrack();
	const { discovery } = useFooJean();
	const canControlPlayback = permitsPlaybackControl(discovery);

	const playPause = usePlayPause();
	const seek = useSeek();
	const seekTo = canControlPlayback ? (at: number) => seek.mutate(at) : NOOP;
	const transport = useTransport();
	const previous = usePrevious();
	const order = usePlaybackOrder();
	const { isHere, canMove, volume, setValue, hasFader } = useAudibleVolume();
	const menu = useNowPlayingMenu();

	const [isLyricsFull, setIsLyricsFull] = useState(false);
	const [editing, setEditing] = useResettingState<EditorOpening | null>(null, [
		isOpen,
	]);

	const keyboardOwner = useKeyboardOwner();

	const ownsEscape =
		isOpen && !isInfoOpen && !isQueueOpen && keyboardOwner === null;
	useEscapeCapture(ownsEscape ? onDismiss : null);

	const lyrics = useMemo(
		() => parseLyrics(readValue(details?.row[NOW_PLAYING_FIELD.lyrics])),
		[details],
	);
	const settledPath = details?.path ?? null;

	const sendSkip = useCallback(
		(by: number) =>
			by > 0 ? transport.next.mutate() : transport.previous.mutate(),
		[transport.next.mutate, transport.previous.mutate],
	);

	const player = snapshot?.player;
	const item = player?.activeItem;
	const playlistId = useResolvedPlaylistId(item?.playlistGuid ?? null);
	const hasPosition = Boolean(item && item.index >= 0);
	const isPlaying = player?.playbackState === "playing";

	const outputsQuery = useOutputs();
	// Absent while listening here, for the reason `StatusBar` gives: this screen's own fader is
	// already this device's, and a picker beside it would reach nothing.
	const outputs: OutputPicker | undefined =
		!isHere && outputsQuery.isAvailable
			? {
					devices: outputsQuery.devices,
					activeId: player?.outputDeviceId ?? null,
					onChoose: outputsQuery.choose,
					onOpen: outputsQuery.refetch,
				}
			: undefined;

	const isReady = isFooJeanReady(discovery);
	const origin = isReady ? discovery.origin : null;

	const artworkKey =
		hasPosition && item && playlistId !== undefined
			? `${playlistId}:${item.index}`
			: null;

	const album = readValue(details?.row[NOW_PLAYING_FIELD.album]);
	const year = readValue(details?.row[NOW_PLAYING_FIELD.year]);
	const albumArtist = readValue(details?.row[NOW_PLAYING_FIELD.albumArtist]);

	const { nextArtwork, previousArtwork, neighbourArtworkSrc } = useCoverWindow({
		isOpen,
		origin,
		playlistId,
		index: item?.index ?? null,
		isInOrder: order.isInOrder,
	});

	const playingAlbum = item?.album ?? null;
	const playingCredited = item?.albumArtist || item?.columns[0] || null;
	const centreCanonical = playingAlbum
		? canonicalPlayingArtworkUrl(origin, playingAlbum, playingCredited || "")
		: null;

	const artwork = !track
		? null
		: (centreCanonical ?? playingArtworkUrl(origin));

	const playingCover = !track
		? undefined
		: playingAlbum
			? coverKey(playingCredited, playingAlbum)
			: coverKey(track.artist, track.title, "track");

	const liveItem = live?.player?.activeItem;
	const livePlaylistId = useResolvedPlaylistId(liveItem?.playlistGuid ?? null);

	const coverName = album ? t("album.coverAlt", { album }) : "";

	const wheel = useCoverWheel({
		audibleTrackKey: artworkKey,
		audibleCover: playingCover,
		playerTrackKey:
			liveItem && liveItem.index >= 0 && livePlaylistId !== undefined
				? `${livePlaylistId}:${liveItem.index}`
				: null,
		artwork,
		neighbourArtworkSrc,
		alt: coverName,
		nextArtwork,
		previousArtwork,
		onSkip: sendSkip,
	});

	const swipe = useSwipe(
		isCompactViewport
			? {
					onDown: onDismiss,
					onUp: () => setIsInfoOpen(true),
					onDrag: canControlPlayback ? wheel.onDrag : undefined,
					onDragEnd: canControlPlayback ? wheel.onDragEnd : undefined,
				}
			: { onDown: onDismiss },
	);

	const loading = wheel.isAwaiting ? " loading" : "";

	const fromLine = playingFrom ? (
		<>
			<span className={styles.fromLabel}>{t("playlist.playingFrom")}</span>
			<b>{playingFrom}</b>
		</>
	) : (
		<span className={styles.fromLabel}>{t("player.nowPlaying")}</span>
	);

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
			identity={playingCover}
			alt={coverName}
			className={styles.cover}
		/>
	);

	const previousLabel = canControlPlayback
		? t("shortcut.previousTrack")
		: t("player.controlOffName", { control: t("shortcut.previousTrack") });
	const nextLabel = canControlPlayback
		? t("shortcut.nextTrack")
		: t("player.controlOffName", { control: t("shortcut.nextTrack") });

	if (!isPresent) return null;

	return (
		<>
			<section
				className={styles.screen}
				data-compact={isCompactViewport}
				data-leaving={!isOpen}
				data-now-playing=""
				{...swipe}
				aria-label={t("player.currentTrack")}
			>
				<header className={styles.head}>
					<button
						type="button"
						className={styles.dismiss}
						aria-label={t("player.closeNowPlaying")}
						onClick={onDismiss}
					>
						<ChevronDown size={20} strokeWidth={2} />
					</button>

					{playingFrom && onOpenPlayingFrom ? (
						<button
							type="button"
							className={styles.fromLink}
							onClick={onOpenPlayingFrom}
						>
							{fromLine}
						</button>
					) : (
						<p className={styles.from}>{fromLine}</p>
					)}

					<div className={styles.headActions}>
						<button
							type="button"
							className={styles.more}
							aria-label={t("track.actions")}
							aria-haspopup="menu"
							disabled={!track}
							onClick={menu.open}
						>
							<MoreHorizontal size={20} strokeWidth={2} />
						</button>
					</div>
				</header>

				<div className={styles.spread}>
					{isCompactViewport ? (
						<div className={styles.stage}>
							<CoverWheel ref={wheel.ref} slots={wheel.slots} />
						</div>
					) : null}

					<div className={styles.identity} data-awaiting={wheel.isAwaiting}>
						{isCompactViewport ? null : (
							<div className={styles.stage}>{cover}</div>
						)}

						<h1 className={`${styles.title}${loading}`}>
							{wheel.isAwaiting
								? " "
								: (track?.title ?? t("player.nothingPlaying"))}
						</h1>
						<p className={`${styles.artist}${loading}`}>
							{wheel.isAwaiting ? (
								" "
							) : track?.artist ? (
								<ArtistLinks credit={track.artist} />
							) : (
								"—"
							)}
						</p>
						{album && !wheel.isAwaiting ? (
							<p className={styles.album}>
								<a
									className="tag-link"
									href={href(albumRoute(albumArtist ?? track?.artist, album))}
								>
									{album}
								</a>
								{year ? <span className={styles.year}> · {year}</span> : null}
							</p>
						) : null}

						<div className={styles.rating}>
							<Rating />

							{isCompactViewport ? (
								<button
									type="button"
									className={styles.lyricsButton}
									aria-expanded={isInfoOpen}
									onClick={() => setIsInfoOpen(true)}
								>
									<Mic2 size={15} strokeWidth={2} aria-hidden="true" />
									{t("panel.lyrics")}
								</button>
							) : null}
						</div>
					</div>

					{isCompactViewport ? null : (
						<TrackPanels
							variant="gatefold"
							lyrics={lyrics}
							snapshot={snapshot}
							onSeek={seekTo}
							trackKey={settledPath ?? ""}
							onExpand={() => setIsLyricsFull(true)}
							isExpanded={isLyricsFull}
							tab={tab}
							onSelectTab={onSelectTab}
							onEdit={setEditing}
						/>
					)}
				</div>

				{!isCompactViewport ? null : (
					<div className={styles.controls}>
						<SeekBar
							snapshot={snapshot}
							onSeek={seekTo}
							disabled={!canControlPlayback}
						/>
						<Times snapshot={snapshot} />

						<div className={styles.transport}>
							<div className={styles.next}>
								<PlaybackOrderButton
									order={order}
									className={styles.order}
									size={18}
									disabled={!canControlPlayback}
									isSurfaceOpen={isOpen && !isInfoOpen}
								/>

								<QueueButton
									isOpen={isQueueOpen}
									onToggle={onToggleQueue}
									variant="screen"
								/>
							</div>

							<div className={styles.keys}>
								<button
									type="button"
									className={styles.skip}
									aria-disabled={canControlPlayback ? undefined : "true"}
									aria-label={previousLabel}
									onClick={
										canControlPlayback
											? () => previous(() => wheel.skip(-1))
											: undefined
									}
								>
									<SkipBackIcon size={22} />
								</button>

								<PlayToggle
									isPlaying={isPlaying}
									onToggle={() => playPause.mutate()}
									variant="screen"
									disabled={!canControlPlayback}
								/>

								<button
									type="button"
									className={styles.skip}
									aria-disabled={canControlPlayback ? undefined : "true"}
									aria-label={nextLabel}
									onClick={canControlPlayback ? () => wheel.skip(1) : undefined}
								>
									<SkipForwardIcon size={22} />
								</button>
							</div>

							<div className={styles.outputs}>
								{player ? (
									<ListenHere playerName={playerNameOf(player.info)} />
								) : null}

								{hasFader ? (
									<VolumePopover
										volume={volume}
										onChange={setValue}
										label={t(isHere ? "player.volumeHere" : "player.volume")}
										disabled={!canMove}
										outputs={outputs}
									/>
								) : null}
							</div>
						</div>

						{canControlPlayback ? null : (
							<p className={styles.reason}>{t("player.controlOff")}</p>
						)}
					</div>
				)}

				{menu.element}
			</section>

			{isCompactViewport && isInfoPresent ? (
				<TrackInfo
					isOpen={isInfoOpen}
					title={track?.title ?? t("player.nothingPlaying")}
					artist={track?.artist ?? "—"}
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={seekTo}
					trackKey={settledPath ?? ""}
					onClose={() => setIsInfoOpen(false)}
					tab={tab}
					onSelectTab={onSelectTab}
					onEdit={setEditing}
				/>
			) : null}

			{isLyricsFull ? (
				<LyricsScreen
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={seekTo}
					onClose={() => setIsLyricsFull(false)}
				/>
			) : null}

			{editing ? (
				<LyricEditor
					opening={editing}
					snapshot={snapshot}
					variant={isCompactViewport ? "screen" : "gatefold"}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</>
	);
}
