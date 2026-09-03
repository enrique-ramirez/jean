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

// The tab whose content *is* the artwork exists only on the compact layout. On
// the gatefold the cover is in the left column and never leaves, so an "art"
// tab there would be a button that does nothing.
type Tab = "art" | "lyrics" | "details" | "artist";

const TABS: { id: Tab; label: string; compactOnly?: boolean }[] = [
	{ id: "art", label: "Playing", compactOnly: true },
	{ id: "lyrics", label: "Lyrics" },
	{ id: "details", label: "Details" },
	{ id: "artist", label: "Artist" },
];

// Times are their own leaf, exactly as in the status bar: the animation frame
// loop repaints two spans rather than the whole screen -- which here would mean
// re-rendering the lyrics on every frame.
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

// The playing track has no row anywhere, so this cannot go through `rate()`
// like a list row does -- there is nothing to patch optimistically. The
// now-playing query is that row's stand-in, and `setRating` patches it.
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

	// Read-only where the scale is somebody else's -- a `100` rescaled to five
	// stars is a 4% rating drawn as full marks, and nothing on screen would say
	// it had happened. Same rule as the row control, asked per track.
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

// Long enough to read as a movement, short enough not to be in the way. Must
// match the animations in the stylesheet -- the exit is what this is timing.
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
	// Kept mounted for the length of the exit, and unmounted the rest of the
	// time. Not merely hidden: the lyric panel runs an animation-frame loop, and
	// one ticking behind an invisible element for a whole session costs something
	// and shows nothing.
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

	// Where each panel was left. Keyed on the track as well as the tab, so a new
	// song's lyrics open at the top rather than at the last one's offset.
	const panelRef = useRef<HTMLDivElement | null>(null);

	const tabs = useMemo(
		() => TABS.filter((tab) => isCompactViewport || !tab.compactOnly),
		[isCompactViewport],
	);

	const [tab, setTab] = useState<Tab>(() =>
		isCompactViewport ? "art" : "lyrics",
	);

	// Lyrics with everything else taken away. State rather than a route: it is a
	// mode of one tab, it should not survive a reload of `#/playing`, and giving
	// it a hash would mean a Back button that lands on a screen the reader did
	// not necessarily come from. It resets by unmounting -- dismissing the screen
	// unmounts this component, which is exactly when it should be forgotten.
	const [isLyricsFull, setIsLyricsFull] = useState(false);

	// Three quarters of the measured library has no lyric tag at all, so opening
	// on Lyrics would land on an empty panel most of the time. The gatefold falls
	// through to Details instead; the compact layout has the artwork to fall back
	// to and does not need to.
	//
	// Keyed on the path rather than on `details`, which is null for a moment on
	// every track change: depending on the object would run this twice per track
	// and the second run would overwrite a tab chosen in between.
	// Parsed here rather than in the panel, because two decisions outside it turn
	// on the answer: which tab opens, and whether this panel restores a
	// remembered scroll offset or is placed by the follow.
	//
	// `readValue`, not truthiness: `?` is what an unresolved field answers and it
	// is a perfectly truthy string.
	const lyrics = useMemo(
		() => parseLyrics(readValue(details?.row[NOW_PLAYING_FIELD.lyrics])),
		[details],
	);
	const hasLyrics = lyrics.kind !== "none";
	const settledPath = details?.path ?? null;

	// Off for a *synced* lyric, and this was a real bug rather than a nicety:
	// restoring an offset writes `scrollTop`, which fires the same `scroll` event
	// a finger does, which the follow reads as "the reader has taken over" and
	// switches itself off -- measured, the lyric then sat still for the rest of
	// the song. It is also the wrong thing to restore. The song has moved on; the
	// place to be is wherever it is now, and the follow already knows.
	usePanelScroll(panelRef, `${tab}:${settledPath ?? ""}`, {
		enabled: !(tab === "lyrics" && lyrics.kind === "synced"),
	});
	// `hasLyrics` is read below but deliberately not depended on: the path
	// settling is the event, and listing it would re-run this when a rating write
	// patches the row and quietly throw away the tab the reader had chosen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the path settling fires this, hasLyrics is only read
	useEffect(() => {
		if (isCompactViewport || settledPath === null) return;
		setTab(hasLyrics ? "lyrics" : "details");
	}, [isCompactViewport, settledPath]);

	// A tab that only exists on one layout must not survive a resize into the
	// other, where nothing would draw it and the panel would be blank.
	useEffect(() => {
		if (!tabs.some((entry) => entry.id === tab))
			setTab(isCompactViewport ? "art" : "lyrics");
	}, [tabs, tab, isCompactViewport]);

	// Left and right step through the tabs rather than skipping tracks. Skipping
	// was the original plan and is worse here: the buttons for it are on screen
	// and unambiguous, while the tabs are the thing you would otherwise reach for
	// a 40px target to change.
	// Which way the panel came from, so it can slide in from that side. The
	// swipe is invisible otherwise: content that simply replaces itself gives no
	// sign that the gesture did anything, let alone that there is more of it in
	// the direction you flicked.
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

	// One gesture handler for the whole screen, both axes. `useSwipe` decides
	// whether a downward flick is a dismissal or a scroll by asking what was
	// under the finger, so this no longer has to be split across the regions
	// that happen not to scroll.
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

	// The identity block has two shapes on a phone, and only there. Under the
	// artwork it is the caption to a picture and can afford four lines; under
	// Lyrics, Details or Artist it is competing with the content for the same
	// screen, and four lines of it was costing a verse.
	//
	// What survives is the title and the artist -- what is playing, which is the
	// only reason the block is on those tabs at all. The album and the year go
	// because Details lists both two rows further down, and the stars go because
	// rating is a deliberate act you go to the Playing tab (or the ⋯ menu) for,
	// not something to keep a 44px target on screen for at all times.
	//
	// The gatefold is untouched: its identity is a sticky left column with a
	// whole leaf to itself and nothing to take space from.
	const isSlim = isCompactViewport && tab !== "art";

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
			alt={album ? `${album} cover` : ""}
			className={styles.cover}
		/>
	);

	const panel =
		// Nothing while the full-screen copy is up. Two `Lyrics` mounted at once
		// is two animation-frame loops recomputing the same active line, and the
		// hidden one still drives *its* scroller -- so the panel underneath would
		// be quietly scrolling itself for the whole song. Same rule as the screen
		// unmounting rather than hiding.
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
				// The boundary for every scroller lookup inside this screen.
				data-now-playing=""
				{...swipe}
				// Not "Now playing": `TrackRow` already labels the playing row's
				// equalizer that, and it is asked for by name to count how many rows
				// claim to be playing. A second element answering to it makes that
				// question unanswerable -- and a reader hears the same name for the row
				// marker, the jump-to-playing pill and this whole screen.
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

					{/* Where the sound is coming from. It used to be a third line in the
            status bar, which is the one place in the app with no room for it.
            "Playing from" rather than a bare "from": this is a whole statement
            about the set that is playing, and it has to survive being read on
            its own beside a name like "All music", where "from All music" reads
            as a fragment of a sentence that never arrives. */}
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
						{/* The queue's way in on a phone, now that the compact status bar is
              down to Play and volume. In the header rather than the transport
              because it is not playback -- the transport is the five controls
              that act on the sound. The desktop keeps its status-bar button and
              would only be getting a second one here. */}
						{isCompactViewport ? (
							<QueueButton isOpen={isQueueOpen} onToggle={onToggleQueue} />
						) : null}

						{/* The same actions a row offers, on the track that has no row. Built
              from the same `trackActions` the list menu is built from, so the
              two cannot drift -- and drawn by `ActionMenu`, which is the only
              menu surface in the app. */}
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
					{/* The identity column is sticky on the gatefold and fixed above the
            controls on the compact layout: on both, the thing you are aiming
            at holds still while the panel beside it changes. */}
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

							{/* A child of the tab strip, absolutely positioned *below* it, so it
							    lands in the panel's top-right corner without being in the panel.
							    That is not a detail: `.panelBody` carries the edge fade on compact,
							    so a control living inside it is drawn at 40% opacity for the first
							    30px of scroll -- and on the gatefold the strip is sticky, which this
							    inherits for free rather than scrolling away from the lyric it
							    belongs to.
							
							    It belongs to the Lyrics tab, so it appears with it. Hidden rather
							    than disabled when the tag is empty: a dimmed control on the three
							    quarters of a real library with no lyric is an affordance that never
							    once works. */}
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

						{/* Keyed on the tab so the entrance replays: without it the wrapper
              persists across a change and only its children swap, which is
              exactly the "nothing happened" the animation exists to fix. */}
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

				{/* Compact only. The desktop already carries a full transport and a seek
          bar in the status bar, which stays live behind this route -- drawing a
          second set here is the move that makes a desktop screen read as a
          stretched phone app. It is not rendered rather than hidden, so the
          `Times` animation loop is not ticking behind something invisible for
          the whole session. */}
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

							{/* The status bar's button, at the size this screen has room for
                -- the same component, so the motion cannot drift between the
                two and there is one place to change it. */}
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

			{/* A *sibling* of the screen rather than a child of it, which is the one
        structural decision here. As a child it would be inside the screen's
        own touch handlers, so every flick in full screen would also step the
        tabs underneath -- and stopping propagation on three handlers to undo
        that is a fix that only holds until someone adds a fourth. Outside,
        the screen sees nothing and there is nothing to suppress.

        `.screen` is positioned in `.body`, so this lands in the same box. */}
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
