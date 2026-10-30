import { GripVertical, X } from "lucide-react";
import { type CSSProperties, memo, useMemo } from "react";
import { positionAt } from "@/domain/player/position";
import type { QueueEntry } from "@/domain/player/queue";
import { queueDropAt, queuedSeconds, startsIn } from "@/domain/player/queue";
import { whenControllable } from "@/domain/player/usePlaybackControl";
import { usePlayer } from "@/domain/player/usePlayer";
import { useQueue, useQueueActions } from "@/domain/player/useQueue";
import { coverKey } from "@/domain/track/fields";
import {
	coverPathOf,
	libraryArtworkUrl,
	playlistRowArtworkUrl,
} from "@/shared/api/artwork";
import { isFooJeanReady } from "@/shared/api/discovery";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useSortableList } from "@/shared/hooks/useSortableList";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { mergeHandlers, type PropBag } from "@/shared/lib/mergeHandlers";
import { formatTime } from "@/shared/lib/time";
import { Artwork } from "@/shared/ui/Artwork";
import { useDragState } from "@/shared/ui/dnd";
import styles from "./QueuePanel.module.css";
import { useQueueClock } from "./queueClock";

const STRETCH_FROM_SECONDS = 120;
const STRETCH_PX_PER_SECOND = 0.1;
const STRETCH_MAX_PX = 40;

const stretchOf = (seconds: number) =>
	Math.min(
		Math.max(0, (seconds - STRETCH_FROM_SECONDS) * STRETCH_PX_PER_SECOND),
		STRETCH_MAX_PX,
	);

const identityOf = (entry: QueueEntry) =>
	entry.location
		? `pos:${entry.location.playlistId}:${entry.location.index}`
		: entry.libraryPath
			? `lib:${entry.libraryPath}`
			: `meta:${entry.artist}:${entry.title}`;

interface QueueCover {
	src: string | null;
	identity: string;
}

// `identity` prefers the record `GET /api/queue` already names over `src`'s own address, since two
// rows of one album share a cover before either row's address is resolved. See
// `ui/ARCHITECTURE.md`, *Requests*, for the fallback chain `src` takes.
const coverOf = (origin: string | null, entry: QueueEntry): QueueCover => {
	if (entry.libraryPath) {
		const src = libraryArtworkUrl(
			origin,
			coverPathOf({
				cover: entry.cover,
				libraryPath: entry.libraryPath,
			}),
		);
		const identity = entry.album
			? coverKey(entry.albumArtist || entry.artist, entry.album)
			: `lib:${entry.libraryPath}`;
		return { src, identity };
	}

	if (entry.location && origin) {
		const { playlistId, index } = entry.location;
		const identity = entry.album
			? coverKey(entry.albumArtist || entry.artist, entry.album)
			: `pos:${playlistId}:${index}`;
		return {
			src: playlistRowArtworkUrl(origin, playlistId, index),
			identity,
		};
	}

	return { src: null, identity: coverKey(entry.artist, entry.title, "track") };
};

const rowKeys = (entries: QueueEntry[]) => {
	const seen = new Map<string, number>();
	return entries.map((entry) => {
		const id = identityOf(entry);
		const nth = seen.get(id) ?? 0;
		seen.set(id, nth + 1);
		return `${id}#${nth}`;
	});
};

function remainingOf(snapshot: PlayerSnapshot | null | undefined) {
	const item = snapshot?.player?.activeItem;
	if (!item?.path) return null;
	return Math.max(
		0,
		(item.duration ?? 0) - positionAt(snapshot, performance.now()),
	);
}

function Remaining({
	snapshot,
	isPlaying,
}: {
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
}) {
	const t = useTranslate();
	useQueueClock(isPlaying);

	const remaining = remainingOf(snapshot);

	return (
		<span className={styles.originLabel}>
			{remaining === null
				? t("player.nothingPlaying")
				: t("queue.leftOfTrack", { time: formatTime(remaining) })}
		</span>
	);
}

function StartsIn({
	entry,
	snapshot,
	isPlaying,
}: {
	entry: QueueEntry;
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
}) {
	const t = useTranslate();
	useQueueClock(isPlaying);

	const remaining = remainingOf(snapshot);
	if (remaining === null) return null;

	return (
		<span className={`${styles.when} tabular`}>
			{t("queue.startsIn", { time: formatTime(startsIn(entry, remaining)) })}
		</span>
	);
}

function DropZones({ at, refuses }: { at: number | null; refuses?: string }) {
	if (at === null) return null;
	return (
		<>
			<span
				className={styles.dropZone}
				data-edge="top"
				data-drop-target={queueDropAt(at)}
				data-drop-refuses={refuses}
				aria-hidden="true"
			/>
			<span
				className={styles.dropZone}
				data-edge="bottom"
				data-drop-target={queueDropAt(at + 1)}
				data-drop-refuses={refuses}
				aria-hidden="true"
			/>
		</>
	);
}

const QueueRow = memo(function QueueRow({
	entry,
	cover,
	snapshot,
	isPlaying,
	isReachable,
	canControlPlayback,
	dropAt,
	hasDropLine,
	onRemove,
	rowProps,
	handleProps,
	itemProps,
}: {
	entry: QueueEntry;
	cover: QueueCover;
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
	isReachable: boolean;
	canControlPlayback: boolean;
	dropAt: number | null;
	hasDropLine: boolean;
	onRemove: () => void;
	rowProps: PropBag;
	handleProps: PropBag;
	itemProps: PropBag;
}) {
	const t = useTranslate();
	const { style, ...merged } = mergeHandlers(itemProps, rowProps);
	const removeLabel = t("queue.removeTrack", { track: entry.title });

	return (
		<li
			className={styles.row}
			data-drop-line={hasDropLine ? "true" : undefined}
			{...merged}
			style={
				{
					...style,
					"--stretch": `${stretchOf(entry.duration)}px`,
				} as CSSProperties
			}
		>
			<DropZones
				at={dropAt}
				refuses={canControlPlayback ? undefined : t("player.controlOff")}
			/>

			<Artwork
				className={styles.tick}
				src={cover.src}
				identity={cover.identity}
				size={32}
			/>

			<span className={styles.names}>
				<span className={styles.title}>
					{entry.title || t("track.unknownTitle")}
				</span>
				<span className={styles.artist}>
					{entry.artist || t("track.unknownArtist")}
					{entry.duration > 0 ? (
						<>
							<span className={styles.dot}>·</span>
							{formatTime(entry.duration)}
						</>
					) : null}
				</span>
			</span>

			<StartsIn entry={entry} snapshot={snapshot} isPlaying={isPlaying} />

			{isReachable ? (
				<span className={styles.controls}>
					<button
						type="button"
						className={styles.grip}
						aria-disabled={canControlPlayback ? undefined : "true"}
						aria-label={
							canControlPlayback
								? t("queue.reorder", { track: entry.title })
								: t("player.controlOffName", {
										control: t("queue.reorder", { track: entry.title }),
									})
						}
						tabIndex={-1}
						data-owns-touch=""
						{...handleProps}
					>
						<GripVertical size={15} strokeWidth={2} />
					</button>
					<button
						type="button"
						className={styles.remove}
						aria-label={removeLabel}
						{...whenControllable(canControlPlayback, onRemove, removeLabel, t)}
					>
						<X size={15} strokeWidth={2.2} />
					</button>
				</span>
			) : null}
		</li>
	);
});

export function QueuePanel({
	isOpen,
	isCompactViewport,
	onDismiss,
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	onDismiss: () => void;
}) {
	const t = useTranslate();
	const { data: snapshot } = usePlayer();
	const { entries, count } = useQueue();
	const { canQueue, canControlPlayback, remove, clear, move } =
		useQueueActions();

	const { discovery } = useFooJean();
	const origin = isFooJeanReady(discovery) ? discovery.origin : null;
	const isReachable = origin !== null;

	const isPlaying = snapshot?.player?.playbackState === "playing";

	const keys = useMemo(() => rowKeys(entries), [entries]);

	const covers = useMemo(
		() => entries.map((entry) => coverOf(origin, entry)),
		[entries, origin],
	);

	const { scrollRef, itemProps, dragProps, handleProps } = useSortableList({
		keys,
		onReorder: move,
		disabled: !canQueue,
	});

	const ref = useDismissable<HTMLElement>(
		isOpen && isCompactViewport,
		onDismiss,
		{
			ignore: "[data-queue-toggle]",
			onEscape: false,
		},
	);

	const drag = useDragState();
	const isDropping = isOpen && isReachable && drag.isDragging;
	const dropRefusal = canControlPlayback ? undefined : t("player.controlOff");

	const keyboardOwner = useKeyboardOwner();

	useEscapeCapture(isOpen && keyboardOwner === null ? onDismiss : null);

	const swipe = useSwipe({ onRight: onDismiss });

	return (
		<>
			{isCompactViewport && isOpen ? (
				<button
					type="button"
					className={styles.scrim}
					aria-label={t("queue.close")}
					onClick={onDismiss}
				/>
			) : null}

			<aside
				ref={ref}
				className={styles.panel}
				data-open={isOpen}
				data-dropping={isDropping ? "true" : undefined}
				aria-label={t("queue.title")}
				{...swipe}
				inert={isOpen ? undefined : true}
			>
				<header className={styles.header}>
					<div className={styles.heading}>
						<h2 className={styles.title}>{t("queue.title")}</h2>
						<p className={styles.meta}>
							{count === 0
								? t("queue.nothingQueued")
								: t("queue.summary", {
										tracks: t("view.trackCount", { count, total: count }),
										time: formatTime(queuedSeconds(entries)),
									})}
						</p>
					</div>

					{count > 0 && isReachable ? (
						<button
							type="button"
							className={styles.clear}
							{...whenControllable(
								canControlPlayback,
								clear,
								t("action.clear"),
								t,
							)}
						>
							{t("action.clear")}
						</button>
					) : null}

					<button
						type="button"
						className={styles.close}
						aria-label={t("queue.close")}
						onClick={onDismiss}
					>
						<X size={17} strokeWidth={2} />
					</button>
				</header>

				<section
					className={styles.scroller}
					ref={scrollRef}
					data-drop-scroller=""
					data-drop-target={isDropping ? queueDropAt(count) : undefined}
					data-drop-refuses={isDropping ? dropRefusal : undefined}
				>
					<div className={styles.origin} data-live={isPlaying}>
						<span className={styles.pip} aria-hidden="true" />
						<Remaining snapshot={snapshot} isPlaying={isPlaying} />
					</div>

					{count === 0 ? (
						<div
							className={styles.empty}
							data-drop-over={
								isDropping && drag.over === queueDropAt(0) ? "true" : undefined
							}
						>
							<p className={styles.emptyLead}>{t("queue.empty")}</p>
							<p className={styles.emptyBody}>{t("queue.emptyBody")}</p>
							<p className={styles.emptyHint}>
								<span className={styles.fine}>{t("queue.hintPointer")}</span>
								<span className={styles.coarse}>{t("queue.hintTouch")}</span>
							</p>
						</div>
					) : (
						<>
							<ol className={styles.rail}>
								{entries.map((entry, index) => (
									<QueueRow
										key={keys[index]}
										entry={entry}
										cover={covers[index]}
										snapshot={snapshot}
										isPlaying={isPlaying}
										isReachable={isReachable}
										canControlPlayback={canControlPlayback}
										dropAt={isDropping ? index : null}
										hasDropLine={drag.over === queueDropAt(index)}
										onRemove={() => remove(entry.at)}
										rowProps={dragProps(index) as PropBag}
										handleProps={handleProps(index) as PropBag}
										itemProps={itemProps(index) as PropBag}
									/>
								))}
							</ol>

							{isDropping ? (
								<div
									className={styles.tail}
									data-drop-line={
										drag.over === queueDropAt(count) ? "true" : undefined
									}
									aria-hidden="true"
								/>
							) : null}
						</>
					)}
				</section>
			</aside>
		</>
	);
}
