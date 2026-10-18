import { FileSearchCorner, Mic2, PencilLine } from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { audibleAt } from "@/domain/player/position";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import type { PlayerSnapshot } from "@/shared/api/types";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { scrollParentOf } from "@/shared/lib/scrollParent";
import { Button } from "@/shared/ui/Button";
import styles from "./Lyrics.module.css";
import { activeLineAt, type Lyrics as ParsedLyrics } from "./lyricsFormat";
import { useNowPlayingLyric } from "./useNowPlayingLyric";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const scrollerOf = (node: Element | null) =>
	scrollParentOf(node, node?.closest("[data-now-playing]"));

const FOCUS = 0.34;

const SCROLLEND_FALLBACK_MS = 700;

function Following({
	variant,
	onResume,
}: {
	variant: PanelVariant;
	onResume: () => void;
}) {
	const t = useTranslate();

	return (
		<div className={styles.resumeDock} data-variant={variant}>
			<button type="button" className={styles.resume} onClick={onResume}>
				{t("lyrics.resumeFollowing")}
			</button>
		</div>
	);
}

export interface LineSelection {
	selected: number | null;
	onToggle: (index: number) => void;
	trailing: (index: number) => ReactNode;
}

export type PanelVariant = "gatefold" | "screen";

export function Synced({
	lines,
	snapshot,
	onSeek,
	selection,
	lyricKey,
	isHeard = true,
	variant = "screen",
}: {
	lines: { at: number; text: string }[];
	snapshot: PlayerSnapshot | null | undefined;
	onSeek?: (at: number) => void;
	selection?: LineSelection;
	lyricKey?: string | number;
	isHeard?: boolean;
	variant?: PanelVariant;
}) {
	const t = useTranslate();
	const seek = useCanControlPlayback() ? onSeek : undefined;
	const [active, setActive] = useState(() =>
		isHeard ? activeLineAt(lines, audibleAt(snapshot)) : -1,
	);
	const lyric = lyricKey ?? lines;
	const [followedLyric, setFollowedLyric] = useState(lyric);
	const [isFollowing, setIsFollowing] = useState(true);
	if (followedLyric !== lyric) {
		setFollowedLyric(lyric);
		setIsFollowing(true);
	}
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: a fresh lyric re-arms the first, unanimated placement, it is not read here
	useLayoutEffect(() => {
		hasPlaced.current = false;
	}, [lyric]);

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
		}, SCROLLEND_FALLBACK_MS);
		return () => clearTimeout(timer);
	}, [active, isFollowing]);

	useEffect(() => {
		const container = scrollerOf(list.current);
		if (!container) return undefined;
		const onScroll = () => {
			if (!isAutoScrolling.current) setIsFollowing(false);
		};
		const onScrollEnd = () => {
			isAutoScrolling.current = false;
		};
		container.addEventListener("scroll", onScroll, { passive: true });
		container.addEventListener("scrollend", onScrollEnd);
		return () => {
			container.removeEventListener("scroll", onScroll);
			container.removeEventListener("scrollend", onScrollEnd);
		};
	}, []);

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

			{isFollowing ? null : (
				<Following variant={variant} onResume={() => setIsFollowing(true)} />
			)}
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
	isIconOnly = false,
	onSearch,
	onEdit,
}: {
	variant: "primary" | "default" | "ghost";
	isIconOnly?: boolean;
	onSearch?: () => void;
	onEdit?: () => void;
}) {
	const t = useTranslate();
	const search = t("lyrics.search");
	const edit = t("lyrics.edit");
	const className = classNames(styles.action, isIconOnly && styles.iconAction);

	return (
		<>
			<Button
				variant={variant}
				icon={FileSearchCorner}
				className={className}
				aria-label={isIconOnly ? search : undefined}
				onClick={onSearch}
			>
				{isIconOnly ? null : search}
			</Button>
			<Button
				variant={variant === "primary" ? "default" : variant}
				icon={PencilLine}
				className={className}
				aria-label={isIconOnly ? edit : undefined}
				onClick={onEdit}
			>
				{isIconOnly ? null : edit}
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
	variant = "screen",
}: {
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	onSearch?: () => void;
	onEdit?: () => void;
	variant?: PanelVariant;
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

	return (
		<Synced
			lines={lyrics.lines}
			snapshot={snapshot}
			onSeek={onSeek}
			variant={variant}
		/>
	);
}
