import { ChevronDown, Mic2, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
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
import { usePlayingPlaylist } from "@/domain/player/usePlayingPlaylist";
import { ArtistLinks } from "@/domain/track/ArtistLinks";
import { albumHref } from "@/domain/track/albumRoute";
import { coverKey, readValue } from "@/domain/track/fields";
import { MAX_STARS, starsOf, toStars } from "@/domain/track/rating";
import { setRatingLayer } from "@/domain/track/ratingTarget";
import { artworkUrl } from "@/shared/api/beefweb";
import { isFooJeanReady, playingArtworkUrl } from "@/shared/api/fooJean";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePresence } from "@/shared/hooks/usePresence";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { CoverWheel, useCoverWheel } from "./CoverWheel";
import { ListenHere, playerNameOf } from "./ListenHere";
import { LyricsScreen } from "./LyricsScreen";
import { parseLyrics } from "./lyricsFormat";
import styles from "./NowPlaying.module.css";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { PlayToggle } from "./PlayToggle";
import type { PanelTab } from "./panelRoute";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import { ShuffleToggle } from "./ShuffleToggle";
import { INFO_EXIT_MS, TrackInfo } from "./TrackInfo";
import { TrackPanels } from "./TrackPanels";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingRating } from "./useNowPlayingRating";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { VolumePopover } from "./Volume";

function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const elapsed = useElapsedSeconds(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	return (
		<div className={styles.times}>
			<span className="tabular">{formatTime(elapsed)}</span>
			<span className="tabular">
				{duration > 0 ? `−${formatTime(Math.max(0, duration - elapsed))}` : "—"}
			</span>
		</div>
	);
}

function Rating() {
	const { raw, isLocalFile, canWrite, write } = useNowPlayingRating();

	useEffect(() => {
		setRatingLayer(write);
		return () => setRatingLayer(null);
	}, [write]);

	if (!isLocalFile) return null;

	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	if (!canWrite) return <Stars value={stars} label={label} />;

	return <StarsInput value={stars} label={label} onRate={write} />;
}

// Must match the exit animation in NowPlaying.module.css.
const SLIDE_MS = 280;

export function NowPlaying({
	isOpen,
	isCompactViewport,
	isQueueOpen,
	onToggleQueue,
	onOpenPlayingFrom,
	onDismiss,
	tab,
	onSelectTab,
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	onOpenPlayingFrom?: () => void;
	onDismiss: () => void;
	tab: PanelTab | null;
	onSelectTab: (tab: PanelTab) => void;
}) {
	const t = useTranslate();
	const isPresent = usePresence(isOpen, SLIDE_MS);
	const [isInfoOpen, setIsInfoOpen] = useState(false);
	const isInfoPresent = usePresence(isInfoOpen, INFO_EXIT_MS);

	useEffect(() => {
		if (!isOpen) setIsInfoOpen(false);
	}, [isOpen]);

	const snapshot = useAudiblePlayer();
	const { data: live } = usePlayer();
	const { track, details } = useNowPlayingTrack();
	const from = usePlayingFrom();
	const { discovery } = useFooJean();

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const order = usePlaybackOrder();
	const { isHere, volume, setValue, hasFader } = useAudibleVolume();
	const menu = useNowPlayingMenu();

	const [isLyricsFull, setIsLyricsFull] = useState(false);

	const keyboardOwner = useKeyboardOwner();

	const ownsEscape =
		isOpen &&
		!isInfoOpen &&
		!isQueueOpen &&
		!menu.isOpen &&
		keyboardOwner === null;
	useEscapeCapture(ownsEscape ? onDismiss : null);

	useEffect(() => {
		if (!isCompactViewport) setIsInfoOpen(false);
	}, [isCompactViewport]);

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
	const playlistId = usePlayingPlaylist(item?.playlistGuid ?? null);
	const hasPosition = Boolean(item && item.index >= 0);
	const isPlaying = player?.playbackState === "playing";

	const artwork = track
		? playingArtworkUrl(isFooJeanReady(discovery) ? discovery.origin : null)
		: null;
	const artworkKey =
		hasPosition && item && playlistId !== undefined
			? `${playlistId}:${item.index}`
			: null;

	// Keyed on the track rather than the album: the album arrives a request later than the cover is
	// wanted, and an identity every track briefly shared would be worse than not sharing one.
	const playingCover = track
		? coverKey(track.artist, track.title, "track")
		: null;

	const album = readValue(details?.row[NOW_PLAYING_FIELD.album]);
	const year = readValue(details?.row[NOW_PLAYING_FIELD.year]);
	const albumArtist = readValue(details?.row[NOW_PLAYING_FIELD.albumArtist]);

	const neighbours =
		order.isInOrder && hasPosition && item && playlistId
			? {
					nextArtwork: artworkUrl(playlistId, item.index + 1),
					previousArtwork:
						item.index > 0 ? artworkUrl(playlistId, item.index - 1) : null,
				}
			: { nextArtwork: null, previousArtwork: null };

	const positionalArtwork =
		hasPosition && item && playlistId
			? artworkUrl(playlistId, item.index)
			: null;

	const liveItem = live?.player?.activeItem;
	const livePlaylistId = usePlayingPlaylist(liveItem?.playlistGuid ?? null);

	const wheel = useCoverWheel({
		audibleTrackKey: artworkKey,
		audibleCover: playingCover,
		playerTrackKey:
			liveItem && liveItem.index >= 0 && livePlaylistId !== undefined
				? `${livePlaylistId}:${liveItem.index}`
				: null,
		artwork,
		positionalArtwork,
		alt: album ? `${album} cover` : "",
		...neighbours,
		onSkip: sendSkip,
	});

	const swipe = useSwipe(
		isCompactViewport
			? {
					onDown: onDismiss,
					onUp: () => setIsInfoOpen(true),
					onDrag: wheel.onDrag,
					onDragEnd: wheel.onDragEnd,
				}
			: { onDown: onDismiss },
	);

	const loading = wheel.isAwaiting ? " loading" : "";

	const fromLine = from?.isPlaying ? (
		<>
			<span className={styles.fromLabel}>{t("playlist.playingFrom")}</span>
			<b>{from.name}</b>
		</>
	) : (
		<span className={styles.fromLabel}>{t("player.nowPlaying")}</span>
	);

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
			identity={playingCover}
			alt={album ? `${album} cover` : ""}
			className={styles.cover}
		/>
	);

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

					{from?.isPlaying && onOpenPlayingFrom ? (
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
									href={albumHref(albumArtist ?? track?.artist, album)}
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
							onSeek={(at) => seek.mutate(at)}
							trackKey={settledPath ?? ""}
							onExpand={() => setIsLyricsFull(true)}
							isExpanded={isLyricsFull}
							tab={tab}
							onSelectTab={onSelectTab}
						/>
					)}
				</div>

				{!isCompactViewport ? null : (
					<div className={styles.controls}>
						<SeekBar snapshot={snapshot} onSeek={(at) => seek.mutate(at)} />
						<Times snapshot={snapshot} />

						<div className={styles.transport}>
							<div className={styles.next}>
								<ShuffleToggle
									order={order}
									className={styles.order}
									size={18}
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
									aria-label={t("shortcut.previousTrack")}
									onClick={() => wheel.skip(-1)}
								>
									<SkipBackIcon size={22} />
								</button>

								<PlayToggle
									isPlaying={isPlaying}
									onToggle={() => playPause.mutate()}
									variant="screen"
								/>

								<button
									type="button"
									className={styles.skip}
									aria-label={t("shortcut.nextTrack")}
									onClick={() => wheel.skip(1)}
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
									/>
								) : null}
							</div>
						</div>
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
					onSeek={(at) => seek.mutate(at)}
					trackKey={settledPath ?? ""}
					onClose={() => setIsInfoOpen(false)}
					tab={tab}
					onSelectTab={onSelectTab}
				/>
			) : null}

			{isLyricsFull ? (
				<LyricsScreen
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={(at) => seek.mutate(at)}
					onClose={() => setIsLyricsFull(false)}
				/>
			) : null}
		</>
	);
}
