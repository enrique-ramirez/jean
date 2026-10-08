import { CornerDownLeft, RotateCcw, RotateCw } from "lucide-react";

import {
	KEY_SEEK_SECONDS,
	usePlayPause,
	useSeekBy,
} from "@/domain/player/useTransport";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { formatTime } from "@/shared/lib/time";
import { KeyCap } from "./KeyCap";
import styles from "./LyricTransport.module.css";
import { clockOfTenths } from "./lyricDraft";
import { PlayToggle } from "./PlayToggle";
import {
	type AudibleClock,
	useAudibleValue,
	wholeTenths,
} from "./useAudibleClock";

const NO_CLOCK = "–:––.–";

export function EditorClock({
	clock,
	snapshot,
	showsBar,
	notPlaying,
}: {
	clock: AudibleClock;
	snapshot: PlayerSnapshot | null | undefined;
	showsBar: boolean;
	notPlaying: string | null;
}) {
	const t = useTranslate();
	const seconds = useAudibleValue(clock, wholeTenths);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;
	const isLive = notPlaying === null;

	return (
		<div className={styles.clock}>
			<span className={styles.now} data-live={isLive}>
				{isLive ? clockOfTenths(seconds) : NO_CLOCK}
				{!isLive ? (
					showsBar ? (
						<small>{t("lyrics.notPlaying", { title: notPlaying })}</small>
					) : null
				) : duration > 0 ? (
					<small>/ {formatTime(duration)}</small>
				) : null}
			</span>
			{showsBar ? (
				<div className={styles.bar}>
					<i
						style={{
							width: `${isLive && duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0}%`,
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

export function EditorTransport({
	snapshot,
	canControlPlayback,
	notPlaying,
}: {
	snapshot: PlayerSnapshot | null | undefined;
	canControlPlayback: boolean;
	notPlaying: string | null;
}) {
	const say = useSpoken();
	const seekBy = useSeekBy();
	const playPause = usePlayPause();

	const seekButton = (
		by: number,
		phrase: "shortcut.seekBack" | "shortcut.seekForward",
		Icon: typeof RotateCcw,
	) => {
		const canSeek = canControlPlayback && notPlaying === null;
		return (
			<button
				type="button"
				className={styles.skip}
				aria-disabled={canSeek ? undefined : "true"}
				aria-label={
					!canControlPlayback
						? say("player.controlOffName", { control: say(phrase) })
						: notPlaying === null
							? say(phrase)
							: say("lyrics.inertName", {
									control: say(phrase),
									title: notPlaying,
								})
				}
				onClick={canSeek ? () => seekBy.mutate(by) : undefined}
			>
				<Icon size={30} strokeWidth={1.6} aria-hidden="true" />
				<small aria-hidden="true">{KEY_SEEK_SECONDS}</small>
			</button>
		);
	};

	return (
		<>
			{seekButton(-KEY_SEEK_SECONDS, "shortcut.seekBack", RotateCcw)}
			<PlayToggle
				isPlaying={snapshot?.player?.playbackState === "playing"}
				onToggle={() => playPause.mutate()}
				className={styles.play}
				disabled={!canControlPlayback}
			/>
			{seekButton(KEY_SEEK_SECONDS, "shortcut.seekForward", RotateCw)}
		</>
	);
}

export function StampButton({
	disabled,
	size,
	notPlaying,
	onStamp,
}: {
	disabled: boolean;
	size: "inline" | "large";
	notPlaying: string | null;
	onStamp: () => void;
}) {
	const t = useTranslate();
	const say = useSpoken();

	return (
		<button
			type="button"
			className={styles.stamp}
			data-size={size}
			disabled={disabled}
			aria-disabled={notPlaying === null ? undefined : "true"}
			aria-label={
				notPlaying === null
					? undefined
					: say("lyrics.inertName", {
							control: say("lyrics.stamp"),
							title: notPlaying,
						})
			}
			onClick={notPlaying === null ? onStamp : undefined}
		>
			<CornerDownLeft size={18} strokeWidth={2.2} aria-hidden="true" />
			{t("lyrics.stamp")}
			{size === "inline" ? <KeyCap binding="lyricStamp" /> : null}
		</button>
	);
}
