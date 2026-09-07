import { Mic2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { audibleAt } from "@/domain/player/position";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { scrollParentOf } from "@/shared/lib/scrollParent";
import styles from "./Lyrics.module.css";
import { activeLineAt, type Lyrics as ParsedLyrics } from "./lyricsFormat";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const scrollerOf = (node: Element | null) =>
	scrollParentOf(node, node?.closest("[data-now-playing]"));

const FOCUS = 0.34;

function Following({ onResume }: { onResume: () => void }) {
	const t = useTranslate();

	return (
		<button type="button" className={styles.resume} onClick={onResume}>
			{t("lyrics.resumeFollowing")}
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
	const [active, setActive] = useState(() =>
		activeLineAt(lines, audibleAt(snapshot)),
	);
	const [isFollowing, setIsFollowing] = useState(true);
	const list = useRef<HTMLDivElement | null>(null);
	const rows = useRef<(HTMLButtonElement | null)[]>([]);

	useEffect(() => {
		let frame = requestAnimationFrame(function tick() {
			setActive(activeLineAt(lines, audibleAt(snapshot)));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [lines, snapshot]);

	// Scrolling programmatically fires the same `scroll` event a finger does, so the guard is a flag rather than
	// anything read off the event.
	const isAutoScrolling = useRef(false);

	const hasPlaced = useRef(false);

	useLayoutEffect(() => {
		const element = rows.current[active];
		const container = scrollerOf(list.current);
		if (!isFollowing || !element || !container) return;

		isAutoScrolling.current = true;
		// Measured against the scroller: `offsetTop` is relative to the nearest positioned ancestor, which on the
		// gatefold is not the scroller.
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

		// `scrollend` is not everywhere yet, so the flag is time-boxed instead.
		const timer = setTimeout(() => {
			isAutoScrolling.current = false;
		}, 700);
		return () => clearTimeout(timer);
	}, [active, isFollowing]);

	useEffect(() => {
		const container = scrollerOf(list.current);
		if (!container) return undefined;
		const onScroll = () => {
			if (!isAutoScrolling.current) setIsFollowing(false);
		};
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => container.removeEventListener("scroll", onScroll);
	}, []);

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
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
}) {
	const t = useTranslate();
	const { isPending } = useNowPlayingTrack();

	if (isPending) return <p className={styles.notice}>{t("lyrics.reading")}</p>;

	if (lyrics.kind === "none")
		return (
			<div className={styles.empty}>
				<Mic2 size={28} strokeWidth={1.5} aria-hidden="true" />
				<p>{t("lyrics.none")}</p>
			</div>
		);

	if (lyrics.kind === "plain")
		return (
			<div className={styles.scroller}>
				<p className={styles.unsynced}>{t("lyrics.unsynced")}</p>
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
