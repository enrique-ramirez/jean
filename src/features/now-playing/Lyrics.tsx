import { Mic2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { scrollParentOf } from "@/shared/lib/scrollParent";
import styles from "./Lyrics.module.css";
import { activeLineAt, type Lyrics as ParsedLyrics } from "./lyricsFormat";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

// Bounded at the now-playing layer for the same reason `useSwipe` is: unbounded,
// a short lyric that does not overflow anything inside the screen resolves to
// the track list scrolling behind it, and following would drive that instead.
const scrollerOf = (node: Element | null) =>
	scrollParentOf(node, node?.closest("[data-now-playing]"));

// How far down the panel the current line sits. A third rather than a half: the
// line being sung is the one you have already heard, and the useful half of the
// view is what is coming.
const FOCUS = 0.34;

// Scrolling by hand takes the follow off, and the pill hands it back. A timeout
// would take it back while somebody was still reading, which is the whole
// complaint about every player that does this.
function Following({ onResume }: { onResume: () => void }) {
	return (
		<button type="button" className={styles.resume} onClick={onResume}>
			Resume following
		</button>
	);
}

function Synced({
	lines,
	snapshot,
	onSeek,
}: {
	lines: { at: number; text: string }[];
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
}) {
	// Seeded from where the song already is, rather than from -1. Mounting at -1
	// meant the panel painted at the top of the lyric for a frame or two before
	// the first animation frame worked out the real line -- which is precisely
	// the "it loads at the top and then jumps" that switching tabs used to look
	// like.
	const [active, setActive] = useState(() =>
		activeLineAt(lines, audibleAt(snapshot)),
	);
	const [isFollowing, setIsFollowing] = useState(true);
	const list = useRef<HTMLDivElement | null>(null);
	const rows = useRef<(HTMLButtonElement | null)[]>([]);

	// The active *index* is the state, not the position: this recomputes on every
	// animation frame and re-rendering a few hundred lines sixty times a second
	// to move one highlight would be the most expensive thing in the app. The
	// index changes a few times a minute.
	useEffect(() => {
		let frame = requestAnimationFrame(function tick() {
			setActive(activeLineAt(lines, audibleAt(snapshot)));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [lines, snapshot]);

	// Scrolling programmatically fires the same `scroll` event a finger does, so
	// the guard is a flag the scroll handler checks rather than an attempt to
	// tell the two apart from the event.
	const isAutoScrolling = useRef(false);

	// The first placement after mounting is a jump, not a journey. Switching to
	// this tab mid-song used to restore the panel and *then* smooth-scroll from
	// there to wherever the song had got to -- a second of travel through lyrics
	// nobody was reading, every time you came back. Only movement between two
	// lines you are watching should be animated.
	const hasPlaced = useRef(false);

	// Layout, not effect: the placement has to happen before the browser paints,
	// or the frame it saves by being instant is spent showing the top of the
	// lyric instead.
	useLayoutEffect(() => {
		const element = rows.current[active];
		const container = scrollerOf(list.current);
		if (!isFollowing || !element || !container) return;

		isAutoScrolling.current = true;
		// Measured against the scroller rather than read off `offsetTop`, which is
		// relative to the nearest positioned ancestor and is not the scroller on
		// the gatefold -- there the whole screen scrolls and the lyric list is
		// several boxes inside it. That mismatch is why following worked on a
		// phone and did nothing at all on the desktop.
		const top =
			container.scrollTop +
			element.getBoundingClientRect().top -
			container.getBoundingClientRect().top -
			container.clientHeight * FOCUS +
			element.clientHeight / 2;

		container.scrollTo({
			top,
			behavior: hasPlaced.current ? "smooth" : "auto",
		});
		hasPlaced.current = true;

		// `scrollend` is not everywhere yet, so the flag is time-boxed. Same shape
		// as `useLongPress` boxing its suppression rather than waiting for an
		// event that differs by platform.
		const timer = setTimeout(() => {
			isAutoScrolling.current = false;
		}, 700);
		return () => clearTimeout(timer);
	}, [active, isFollowing]);

	// On the scroller, wherever it is: the gatefold scrolls the whole screen, so a
	// handler on the list itself would never fire and following could never be
	// given up.
	useEffect(() => {
		const container = scrollerOf(list.current);
		if (!container) return undefined;
		const onScroll = () => {
			if (!isAutoScrolling.current) setIsFollowing(false);
		};
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => container.removeEventListener("scroll", onScroll);
	}, []);

	// A new track is a new lyric, and the reader has not scrolled it yet. It is
	// also a new place to land, so the next placement jumps rather than travels.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a fresh lyric re-arms following, it is not read here
	useEffect(() => {
		hasPlaced.current = false;
		setIsFollowing(true);
	}, [lines]);

	return (
		<>
			<div ref={list} className={styles.scroller}>
				{lines.map((line, index) => (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: a refrain repeats the same text at several times, so position is the only identity
						key={index}
						type="button"
						ref={(element) => {
							rows.current[index] = element;
						}}
						className={styles.line}
						data-state={
							index === active ? "active" : index < active ? "past" : "coming"
						}
						// Seeking to a line is exact on a local file, and it is the thing a
						// streaming client mostly cannot offer. An empty line is a timed
						// gap and is still a place worth landing on.
						onClick={() => onSeek(line.at)}
					>
						{line.text || <span className={styles.gap} aria-hidden="true" />}
					</button>
				))}
			</div>

			{isFollowing ? null : <Following onResume={() => setIsFollowing(true)} />}
		</>
	);
}

export function Lyrics({
	lyrics,
	snapshot,
	onSeek,
}: {
	// Parsed by the screen rather than here: whether this is synced decides
	// which tab opens and whether the panel restores its own scroll, and both of
	// those are decided outside this component.
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
}) {
	const { isPending } = useNowPlayingTrack();

	if (isPending) return <p className={styles.notice}>Reading the tag…</p>;

	// The common case by a distance -- *measured*, 74.7% of one real library --
	// so it is drawn as a state rather than explained as a problem. The earlier
	// version named the tag and the component that writes it, which is the right
	// content for the Settings screen and far too much for something you meet
	// three times out of four while listening.
	if (lyrics.kind === "none")
		return (
			<div className={styles.empty}>
				<Mic2 size={28} strokeWidth={1.5} aria-hidden="true" />
				<p>No lyrics found</p>
			</div>
		);

	if (lyrics.kind === "plain")
		return (
			<div className={styles.scroller}>
				{/* Said rather than implied. Drawing untimed lyrics in the same frame as
            timed ones, minus the highlight, reads as sync that has broken. */}
				<p className={styles.unsynced}>Unsynced</p>
				{lyrics.lines.map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: plain text, repeats
					<p key={index} className={styles.plainLine}>
						{line || " "}
					</p>
				))}
			</div>
		);

	return <Synced lines={lyrics.lines} snapshot={snapshot} onSeek={onSeek} />;
}
