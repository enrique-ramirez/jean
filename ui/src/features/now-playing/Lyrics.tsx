import { Mic2, PencilLine, Search } from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { audibleAt } from "@/domain/player/position";
import { permitsPlaybackControl } from "@/shared/api/discovery";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { scrollParentOf } from "@/shared/lib/scrollParent";
import { Button } from "@/shared/ui/Button";
import styles from "./Lyrics.module.css";
import { activeLineAt, type Lyrics as ParsedLyrics } from "./lyricsFormat";
import { useNowPlayingLyric } from "./useNowPlayingLyric";
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

export interface LineSelection {
	selected: number | null;
	onToggle: (index: number) => void;
	trailing: (index: number) => ReactNode;
}

export function Synced({
	lines,
	snapshot,
	onSeek,
	selection,
	lyricKey,
	isHeard = true,
}: {
	lines: { at: number; text: string }[];
	snapshot: PlayerSnapshot | null | undefined;
	onSeek?: (at: number) => void;
	selection?: LineSelection;
	lyricKey?: string | number;
	isHeard?: boolean;
}) {
	const t = useTranslate();
	const { discovery } = useFooJean();
	const seek = permitsPlaybackControl(discovery) ? onSeek : undefined;
	const [active, setActive] = useState(() =>
		isHeard ? activeLineAt(lines, audibleAt(snapshot)) : -1,
	);
	const [isFollowing, setIsFollowing] = useState(true);
	const list = useRef<HTMLDivElement | null>(null);
	const rows = useRef<(HTMLButtonElement | null)[]>([]);

	useEffect(() => {
		if (!isHeard) {
			setActive(-1);
			return undefined;
		}
		let frame = requestAnimationFrame(function tick() {
			setActive(activeLineAt(lines, audibleAt(snapshot)));
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}, [lines, snapshot, isHeard]);

	const isAutoScrolling = useRef(false);

	const hasPlaced = useRef(false);

	useLayoutEffect(() => {
		const element = rows.current[active];
		const container = scrollerOf(list.current);
		if (!isFollowing || !element || !container) return;

		isAutoScrolling.current = true;
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

	const lyric = lyricKey ?? lines;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a fresh lyric re-arms following, it is not read here
	useEffect(() => {
		hasPlaced.current = false;
		setIsFollowing(true);
	}, [lyric]);

	return (
		<>
			<div ref={list} className={styles.scroller}>
				{lines.map((line, index) => {
					const row = (
						<button
							type="button"
							ref={(element) => {
								rows.current[index] = element;
							}}
							className={styles.line}
							data-state={
								index === active ? "active" : index < active ? "past" : "coming"
							}
							aria-current={index === active ? "true" : undefined}
							aria-pressed={
								selection ? selection.selected === index : undefined
							}
							aria-disabled={selection || seek ? undefined : "true"}
							aria-label={
								selection || seek || !line.text
									? undefined
									: t("player.controlOffName", { control: line.text })
							}
							onClick={
								selection
									? () => selection.onToggle(index)
									: seek
										? () => seek(line.at)
										: undefined
							}
						>
							{line.text || <span className={styles.gap} aria-hidden="true" />}
						</button>
					);

					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a refrain repeats the same text at several times, so position is the only identity
						<Fragment key={index}>
							{selection ? (
								<div
									className={styles.selectable}
									data-selected={selection.selected === index}
								>
									{row}
									{selection.selected === index
										? selection.trailing(index)
										: null}
								</div>
							) : (
								row
							)}
						</Fragment>
					);
				})}
			</div>

			{isFollowing ? null : <Following onResume={() => setIsFollowing(true)} />}
		</>
	);
}

export function PlainLines({ lines }: { lines: string[] }) {
	const t = useTranslate();

	return (
		<div className={styles.scroller}>
			<p className={styles.unsynced}>{t("lyrics.unsynced")}</p>
			{lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: plain text, repeats
				<p key={index} className={styles.plainLine}>
					{line || "\u00a0"}
				</p>
			))}
		</div>
	);
}

export function LyricActions({
	variant,
	onSearch,
	onEdit,
}: {
	variant: "primary" | "default" | "ghost";
	onSearch?: () => void;
	onEdit?: () => void;
}) {
	const t = useTranslate();

	return (
		<>
			<Button
				variant={variant}
				icon={Search}
				className={styles.action}
				onClick={onSearch}
			>
				{t("lyrics.search")}
			</Button>
			<Button
				variant={variant === "primary" ? "default" : variant}
				icon={PencilLine}
				className={styles.action}
				onClick={onEdit}
			>
				{t("lyrics.edit")}
			</Button>
		</>
	);
}

export function Lyrics({
	lyrics,
	snapshot,
	onSeek,
	onSearch,
	onEdit,
}: {
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	onSearch?: () => void;
	onEdit?: () => void;
}) {
	const t = useTranslate();
	const { isPending, track, details } = useNowPlayingTrack();
	const { target } = useNowPlayingLyric();

	if (isPending) return <p className={styles.notice}>{t("lyrics.reading")}</p>;
	if (track && !details) return null;

	if (lyrics.kind === "none")
		return (
			<div className={styles.empty}>
				<Mic2 size={28} strokeWidth={1.5} aria-hidden="true" />
				<p>{t("lyrics.none")}</p>
				{target ? (
					<>
						<div className={styles.actions}>
							<LyricActions
								variant="primary"
								onSearch={onSearch}
								onEdit={onEdit}
							/>
						</div>
						<p className={styles.searchHint}>
							{target.artist === null ? (
								<Trans
									phrase="lyrics.searchHintNoArtist"
									title={<b>{target.title}</b>}
								/>
							) : (
								<Trans
									phrase="lyrics.searchHint"
									title={<b>{target.title}</b>}
									artist={<b>{target.artist}</b>}
								/>
							)}
						</p>
					</>
				) : null}
			</div>
		);

	if (lyrics.kind === "plain") return <PlainLines lines={lyrics.lines} />;

	return <Synced lines={lyrics.lines} snapshot={snapshot} onSeek={onSeek} />;
}
