import { ChevronDown, Mic2, MoreHorizontal, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { formatTime } from "@/domain/player/position";
import { useAudibleVolume } from "@/domain/player/useListener";
import {
	useAudiblePlayer,
	usePlaybackOrder,
	usePlayPause,
	useSeek,
	useTransport,
} from "@/domain/player/usePlayer";
import { readValue } from "@/domain/track/fields";
import {
	isWritableScale,
	MAX_STARS,
	rawRatingOfValue,
	starsOf,
	toStars,
} from "@/domain/track/rating";
import { useTagWriting } from "@/domain/track/useTagWriter";
import { artworkUrl } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { usePresence } from "@/shared/hooks/usePresence";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { ListenHere } from "./ListenHere";
import { LyricsScreen } from "./LyricsScreen";
import { parseLyrics } from "./lyricsFormat";
import styles from "./NowPlaying.module.css";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsed } from "./SeekBar";
import { INFO_EXIT_MS, TrackInfo } from "./TrackInfo";
import { TrackPanels } from "./TrackPanels";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { VolumePopover } from "./Volume";

// Its own leaf, so the animation-frame loop repaints two spans rather than the whole screen.
function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const elapsed = useElapsed(snapshot);
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

// The playing track has no row to patch optimistically, so `setRating` patches the now-playing query instead.
function Rating() {
	const { canRate, rateTrack } = useTagWriting();
	const { track, details, setRating } = useNowPlayingTrack();

	const raw =
		details === null
			? null
			: rawRatingOfValue(details.row[NOW_PLAYING_FIELD.rating]);
	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	// A rating on another scale would be rescaled on write, so it is shown read-only.
	if (!canRate || !track || details === null || !isWritableScale(raw))
		return <Stars value={stars} label={label} />;

	return (
		<StarsInput
			value={stars}
			label={label}
			onRate={(next) => {
				setRating(next === null ? "" : String(next));
				rateTrack(track, track.title, next);
			}}
		/>
	);
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

	// Escape belongs to whatever is in front. The layers this screen opens take it first, and a dialog that has claimed the keyboard has taken it already — capture beats both, so the screen stands down rather than reaching over them.
	// `isOpen` first: the component is mounted whether or not the screen is up, and a listener registered while it is down eats every Escape in the app.
	const ownsEscape =
		isOpen &&
		!isInfoOpen &&
		!isLyricsFull &&
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

	const skip = (by: number) =>
		by > 0 ? transport.next.mutate() : transport.previous.mutate();

	// On a phone this screen *is* the track: sideways is the next one, up is what is written about it. The gatefold keeps the dismissal alone — its panels carry their own strip and their own swipe.
	const swipe = useSwipe(
		isCompactViewport
			? {
					onDown: onDismiss,
					onUp: () => setIsInfoOpen(true),
					onLeft: () => skip(1),
					onRight: () => skip(-1),
				}
			: { onDown: onDismiss },
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
						{isCompactViewport ? (
							<QueueButton isOpen={isQueueOpen} onToggle={onToggleQueue} />
						) : null}

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
					{/* Not keyed on the track, for the same reason `.cover` below ignores pointer events: `Artwork` swaps its own element as a cover loads. */}
					{isCompactViewport ? (
						<div className={styles.stage}>{cover}</div>
					) : null}

					<div className={styles.identity}>
						{isCompactViewport ? null : (
							<div className={styles.stage}>{cover}</div>
						)}

						<h1 className={styles.title}>
							{track?.title ?? "Nothing playing"}
						</h1>
						<p className={styles.artist}>{track?.artist ?? "—"}</p>
						{album ? (
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
								<Shuffle size={18} strokeWidth={2} />
							</button>

							<div className={styles.keys}>
								<button
									type="button"
									className={styles.skip}
									aria-label="Previous track"
									onClick={() => skip(-1)}
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
									onClick={() => skip(1)}
								>
									<SkipForwardIcon size={22} />
								</button>
							</div>

							{/* Where the sound goes, in the status bar's own order: the picker left of the fader, because where has to be answered before how loud there means anything. */}
							<div className={styles.outputs}>
								{player ? (
									<ListenHere
										playerName={player.info.title ?? player.info.name}
									/>
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
