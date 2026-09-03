import { ChevronDown, Maximize2, MoreHorizontal, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { formatTime } from "@/domain/player/position";
import {
	useAudiblePlayer,
	usePlaybackOrder,
	usePlayPause,
	useSeek,
	useTransport,
	useVolume,
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
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { Artist } from "./Artist";
import { Details } from "./Details";
import { Lyrics } from "./Lyrics";
import { LyricsScreen } from "./LyricsScreen";
import { parseLyrics } from "./lyricsFormat";
import styles from "./NowPlaying.module.css";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsed } from "./SeekBar";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { usePanelScroll } from "./usePanelScroll";
import { VolumePopover } from "./Volume";

type Tab = "art" | "lyrics" | "details" | "artist";

const TABS: { id: Tab; label: string; compactOnly?: boolean }[] = [
	{ id: "art", label: "Playing", compactOnly: true },
	{ id: "lyrics", label: "Lyrics" },
	{ id: "details", label: "Details" },
	{ id: "artist", label: "Artist" },
];

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
	onDismiss,
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	onDismiss: () => void;
}) {
	// Unmounted rather than hidden once the exit finishes: the lyric panel runs an animation-frame loop.
	const [isPresent, setIsPresent] = useState(isOpen);
	useEffect(() => {
		if (isOpen) {
			setIsPresent(true);
			return undefined;
		}
		const timer = setTimeout(() => setIsPresent(false), SLIDE_MS);
		return () => clearTimeout(timer);
	}, [isOpen]);

	const snapshot = useAudiblePlayer();
	const { track, details } = useNowPlayingTrack();
	const from = usePlayingFrom();

	const playPause = usePlayPause();
	const seek = useSeek();
	const transport = useTransport();
	const order = usePlaybackOrder();
	const { volume, setValue } = useVolume();
	const menu = useNowPlayingMenu();

	const panelRef = useRef<HTMLDivElement | null>(null);

	const tabs = useMemo(
		() => TABS.filter((tab) => isCompactViewport || !tab.compactOnly),
		[isCompactViewport],
	);

	const [tab, setTab] = useState<Tab>(() =>
		isCompactViewport ? "art" : "lyrics",
	);

	const [isLyricsFull, setIsLyricsFull] = useState(false);

	// `readValue` rather than truthiness: an unresolved beefweb field answers `?`, which is truthy.
	const lyrics = useMemo(
		() => parseLyrics(readValue(details?.row[NOW_PLAYING_FIELD.lyrics])),
		[details],
	);
	const hasLyrics = lyrics.kind !== "none";
	const settledPath = details?.path ?? null;

	// Restoring an offset writes `scrollTop`, which the synced-lyric follow reads as a manual scroll and stops following.
	usePanelScroll(panelRef, `${tab}:${settledPath ?? ""}`, {
		enabled: !(tab === "lyrics" && lyrics.kind === "synced"),
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: the path settling fires this, hasLyrics is only read
	useEffect(() => {
		if (isCompactViewport || settledPath === null) return;
		setTab(hasLyrics ? "lyrics" : "details");
	}, [isCompactViewport, settledPath]);

	useEffect(() => {
		if (!tabs.some((entry) => entry.id === tab))
			setTab(isCompactViewport ? "art" : "lyrics");
	}, [tabs, tab, isCompactViewport]);

	// Which way the panel came from, so it slides in from that side.
	const [direction, setDirection] = useState(1);

	const select = (next: Tab) => {
		const from = tabs.findIndex((entry) => entry.id === tab);
		const to = tabs.findIndex((entry) => entry.id === next);
		setDirection(to > from ? 1 : -1);
		setTab(next);
	};

	const step = (by: number) => {
		const at = tabs.findIndex((entry) => entry.id === tab);
		const next = tabs[at + by];
		if (next) select(next.id);
	};

	const swipe = useSwipe({
		onDown: onDismiss,
		onLeft: () => step(1),
		onRight: () => step(-1),
	});

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

	// On a phone the identity block shares the screen with the panel, so it drops to title and artist.
	const isSlim = isCompactViewport && tab !== "art";

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
			alt={album ? `${album} cover` : ""}
			className={styles.cover}
		/>
	);

	// Nothing while the full-screen copy is up: two mounted `Lyrics` are two animation-frame loops, and the hidden one still scrolls this panel.
	const panel =
		tab === "lyrics" ? (
			isLyricsFull ? null : (
				<Lyrics
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={(at) => seek.mutate(at)}
				/>
			)
		) : tab === "details" ? (
			<Details />
		) : tab === "artist" ? (
			<Artist />
		) : (
			<div className={styles.stage}>{cover}</div>
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

					<p className={styles.from}>
						{from?.isPlaying ? (
							<>
								<span className={styles.fromLabel}>Playing from</span>
								<b>{from.name}</b>
							</>
						) : (
							<span className={styles.fromLabel}>Now playing</span>
						)}
					</p>

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
					<div className={styles.identity} data-slim={isSlim}>
						{isCompactViewport ? null : (
							<div className={styles.stage}>{cover}</div>
						)}

						<h1 className={styles.title}>
							{track?.title ?? "Nothing playing"}
						</h1>
						<p className={styles.artist}>{track?.artist ?? "—"}</p>
						{album && !isSlim ? (
							<p className={styles.album}>
								{album}
								{year ? <span className={styles.year}> · {year}</span> : null}
							</p>
						) : null}

						{isSlim ? null : (
							<div className={styles.rating}>
								<Rating />
							</div>
						)}
					</div>

					<div className={styles.panel}>
						<nav className={styles.tabs} aria-label="Track views">
							{tabs.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={styles.tab}
									aria-current={tab === entry.id}
									data-active={tab === entry.id}
									onClick={() => select(entry.id)}
								>
									{entry.label}
								</button>
							))}

							{/* Positioned over the panel but a child of the strip: `.panelBody` carries an edge fade that would dim it on scroll. */}
							{tab === "lyrics" && hasLyrics ? (
								<button
									type="button"
									className={styles.expand}
									aria-label="Full-screen lyrics"
									onClick={() => setIsLyricsFull(true)}
								>
									<Maximize2 size={16} strokeWidth={2} />
								</button>
							) : null}
						</nav>

						{/* Keyed on the tab so the entrance animation replays on every change. */}
						<div
							key={tab}
							ref={panelRef}
							className={styles.panelBody}
							data-tab={tab}
							data-direction={direction}
						>
							{panel}
						</div>
					</div>
				</div>

				{/* Compact only; the desktop status bar carries these. Not rendered rather than hidden, so `Times` stops ticking. */}
				{!isCompactViewport ? null : (
					<div className={styles.controls}>
						<SeekBar snapshot={snapshot} onSeek={(at) => seek.mutate(at)} />
						<Times snapshot={snapshot} />

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

							<button
								type="button"
								className={styles.skip}
								aria-label="Previous track"
								onClick={() => transport.previous.mutate()}
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
								onClick={() => transport.next.mutate()}
							>
								<SkipForwardIcon size={22} />
							</button>

							<VolumePopover volume={volume} onChange={setValue} />
						</div>
					</div>
				)}

				{menu.element}
			</section>

			{/* A sibling of the screen, not a child: inside it every flick would also step the tabs underneath. */}
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
