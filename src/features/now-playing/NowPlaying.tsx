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
import { readValue } from "@/domain/track/fields";
import { MAX_STARS, starsOf, toStars } from "@/domain/track/rating";
import { setRatingLayer } from "@/domain/track/ratingTarget";
import { artworkUrl } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { usePresence } from "@/shared/hooks/usePresence";
import { useSwipe } from "@/shared/hooks/useSwipe";
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
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import { ShuffleToggle } from "./ShuffleToggle";
import { INFO_EXIT_MS, TrackInfo } from "./TrackInfo";
import { TrackPanels } from "./TrackPanels";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingRating } from "./useNowPlayingRating";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { VolumePopover } from "./Volume";

// Its own leaf, so the animation-frame loop repaints two spans rather than the whole screen.
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
	const { raw, canWrite, write } = useNowPlayingRating();

	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	// `0`-`5` rate what this screen is showing, through the same call the stars make. Published even where the value is read-only, so the digits are refused here rather than falling through to the cursor row of the list behind the layer.
	useEffect(() => {
		setRatingLayer(write);
		return () => setRatingLayer(null);
	}, [write]);

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
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	/** Given only when the set being played has a route to open, which is what makes the header a link. */
	onOpenPlayingFrom?: () => void;
	onDismiss: () => void;
}) {
	// Unmounted rather than hidden once the exit finishes: the lyric panel runs an animation-frame loop.
	const isPresent = usePresence(isOpen, SLIDE_MS);
	// What the Lyrics button opens on a phone, and the only place the tabs live there.
	const [isInfoOpen, setIsInfoOpen] = useState(false);
	const isInfoPresent = usePresence(isInfoOpen, INFO_EXIT_MS);

	// Reopening the screen lands on the player: the layer over it was about the track you were looking at then.
	useEffect(() => {
		if (!isOpen) setIsInfoOpen(false);
	}, [isOpen]);

	const snapshot = useAudiblePlayer();
	const { data: live } = usePlayer();
	const { track, details } = useNowPlayingTrack();
	const from = usePlayingFrom();

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const order = usePlaybackOrder();
	// The audible fader, the one the status bar draws: pointed at the player while a stream is attached, it would move nothing anyone can hear.
	const { isHere, volume, setValue, hasFader } = useAudibleVolume();
	const menu = useNowPlayingMenu();

	const [isLyricsFull, setIsLyricsFull] = useState(false);

	const keyboardOwner = useKeyboardOwner();

	// Escape belongs to whatever is in front. The layers this screen opens take it first, the queue slides over the top of it, and a dialog that has claimed the keyboard has taken it already — capture beats all three, so the screen stands down rather than reaching over them.
	// `isOpen` first: the component is mounted whether or not the screen is up, and a listener registered while it is down eats every Escape in the app.
	const ownsEscape =
		isOpen &&
		!isInfoOpen &&
		!isLyricsFull &&
		!isQueueOpen &&
		!menu.isOpen &&
		keyboardOwner === null;
	useEscapeCapture(ownsEscape ? onDismiss : null);

	// The gatefold keeps the panels in a leaf of its own, so a resize must not leave a layer over one.
	useEffect(() => {
		if (!isCompactViewport) setIsInfoOpen(false);
	}, [isCompactViewport]);

	// `readValue` rather than truthiness: an unresolved beefweb field answers `?`, which is truthy.
	// Parsed here rather than in the panel, because the full-screen copy reads the same result and an 8.5 KB tag should not be parsed twice.
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
	const hasTrack = Boolean(item && item.index >= 0);
	const isPlaying = player?.playbackState === "playing";

	const artwork =
		hasTrack && item ? artworkUrl(item.playlistId, item.index) : null;
	const artworkKey =
		hasTrack && item ? `${item.playlistId}:${item.index}` : "idle";

	const album = readValue(details?.row[NOW_PLAYING_FIELD.album]);
	const year = readValue(details?.row[NOW_PLAYING_FIELD.year]);

	// The artwork endpoint is addressed by position, so the sleeves either side cost a lookup and no request of Jean's
	// own -- but only under Default, where the next row really is the next track. Anything else leaves them absent,
	// which the wheel draws as loading.
	const neighbours =
		order.isInOrder && hasTrack && item
			? {
					nextArtwork: artworkUrl(item.playlistId, item.index + 1),
					previousArtwork:
						item.index > 0 ? artworkUrl(item.playlistId, item.index - 1) : null,
				}
			: { nextArtwork: null, previousArtwork: null };

	// The player's own track, which is never delayed. Only the wheel's undo reads it, to tell a skip the player refused
	// from one whose sound has not arrived yet.
	const liveItem = live?.player?.activeItem;

	const wheel = useCoverWheel({
		audibleTrackKey: hasTrack ? artworkKey : null,
		playerTrackKey:
			liveItem && liveItem.index >= 0
				? `${liveItem.playlistId}:${liveItem.index}`
				: null,
		artwork,
		alt: album ? `${album} cover` : "",
		...neighbours,
		onSkip: sendSkip,
	});

	// On a phone this screen *is* the track: sideways turns the wheel to the next one, up is what is written about it.
	// The horizontal axis belongs to the wheel rather than to `useSwipe`, because it follows the finger and only it
	// knows how far round the turn got. The gatefold keeps the dismissal alone — its panels carry their own swipe.
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

	// The global sheen, on whichever of the identity's lines are waiting for a name. See `base.css`.
	const loading = wheel.isAwaiting ? " loading" : "";

	const fromLine = from?.isPlaying ? (
		<>
			<span className={styles.fromLabel}>Playing from</span>
			<b>{from.name}</b>
		</>
	) : (
		<span className={styles.fromLabel}>Now playing</span>
	);

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
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
				// The boundary every scroller lookup inside this screen resolves against.
				data-now-playing=""
				{...swipe}
				// Not "Now playing", which `TrackRow` uses for the playing row's equalizer and is queried by name.
				aria-label="Current track"
			>
				<header className={styles.head}>
					<button
						type="button"
						className={styles.dismiss}
						aria-label="Close now playing"
						onClick={onDismiss}
					>
						<ChevronDown size={20} strokeWidth={2} />
					</button>

					{/* The whole line is the way back to the set, not just the name: on a phone the label is half of what there is to aim at. A sentence where there is no route to open. */}
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
							aria-label="Track actions"
							aria-haspopup="menu"
							disabled={!hasTrack}
							onClick={menu.open}
						>
							<MoreHorizontal size={20} strokeWidth={2} />
						</button>
					</div>
				</header>

				<div className={styles.spread}>
					{/* A wheel on a phone, where sideways means the next track; the gatefold has no such gesture and keeps the plain sleeve. Neither is keyed on the track: `Artwork` swaps its own element as a cover loads. */}
					{isCompactViewport ? (
						<div className={styles.stage}>
							<CoverWheel ref={wheel.ref} slots={wheel.slots} />
						</div>
					) : null}

					<div className={styles.identity} data-awaiting={wheel.isAwaiting}>
						{isCompactViewport ? null : (
							<div className={styles.stage}>{cover}</div>
						)}

						{/* Loading, not stopped: the wheel has turned to a track the player has not named yet, and saying "Nothing playing" there would be a different and untrue thing. The text stays, invisible, to hold the line boxes open at the height they will settle at. */}
						<h1 className={`${styles.title}${loading}`}>
							{wheel.isAwaiting ? " " : (track?.title ?? "Nothing playing")}
						</h1>
						<p className={`${styles.artist}${loading}`}>
							{wheel.isAwaiting ? " " : (track?.artist ?? "—")}
						</p>
						{album && !wheel.isAwaiting ? (
							<p className={styles.album}>
								{album}
								{year ? <span className={styles.year}> · {year}</span> : null}
							</p>
						) : null}

						{/* Rate it on the left, read about it on the right: one line of things to do with the track, and the right end of it is where a thumb already is. */}
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
									Lyrics
								</button>
							) : null}
						</div>
					</div>

					{/* The gatefold's right leaf. On a phone the same panels are a layer of their own, which is what leaves this screen's horizontal axis free to mean the next track. */}
					{isCompactViewport ? null : (
						<TrackPanels
							variant="gatefold"
							lyrics={lyrics}
							snapshot={snapshot}
							onSeek={(at) => seek.mutate(at)}
							trackKey={settledPath ?? ""}
							onExpand={() => setIsLyricsFull(true)}
							isExpanded={isLyricsFull}
						/>
					)}
				</div>

				{/* Compact only; the desktop status bar carries these. Not rendered rather than hidden, so `Times` stops ticking. */}
				{!isCompactViewport ? null : (
					<div className={styles.controls}>
						<SeekBar snapshot={snapshot} onSeek={(at) => seek.mutate(at)} />
						<Times snapshot={snapshot} />

						{/* Three groups, so Play sits in the middle of the row whatever the outer two hold. */}
						<div className={styles.transport}>
							{/* What plays next: the order the player takes tracks in, and the tracks asked for by name. Both belong under a thumb, which the header is not. */}
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
									aria-label="Previous track"
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
									aria-label="Next track"
									onClick={() => wheel.skip(1)}
								>
									<SkipForwardIcon size={22} />
								</button>
							</div>

							{/* Where the sound goes, in the status bar's own order: the picker left of the fader, because where has to be answered before how loud there means anything. */}
							<div className={styles.outputs}>
								{player ? (
									<ListenHere playerName={playerNameOf(player.info)} />
								) : null}

								{hasFader ? (
									<VolumePopover
										volume={volume}
										onChange={setValue}
										label={isHere ? "Volume on this device" : "Volume"}
									/>
								) : null}
							</div>
						</div>
					</div>
				)}

				{menu.element}
			</section>

			{/* Siblings of the screen, not children: inside it, every flick in one of them would skip a track underneath. */}
			{isCompactViewport && isInfoPresent ? (
				<TrackInfo
					isOpen={isInfoOpen}
					title={track?.title ?? "Nothing playing"}
					artist={track?.artist ?? "—"}
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={(at) => seek.mutate(at)}
					trackKey={settledPath ?? ""}
					onClose={() => setIsInfoOpen(false)}
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
