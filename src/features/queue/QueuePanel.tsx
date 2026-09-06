import { GripVertical, X } from "lucide-react";
import { type CSSProperties, memo, useMemo } from "react";

import { formatTime, positionAt } from "@/domain/player/position";
import type { QueueEntry } from "@/domain/player/queue";
import { queuedSeconds, startsIn } from "@/domain/player/queue";
import { usePlayer } from "@/domain/player/usePlayer";
import { useQueue, useQueueActions } from "@/domain/player/useQueue";
import { artworkUrl } from "@/shared/api/beefweb";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useSortableList } from "@/shared/hooks/useSortableList";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { mergeHandlers, type PropBag } from "@/shared/lib/mergeHandlers";
import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./QueuePanel.module.css";
import { useQueueClock } from "./queueClock";

// How much rail a second of music buys: ordinary songs sit at the same rhythm and only a long one pushes its neighbours down the panel.
const STRETCH_FROM_SECONDS = 120;
const STRETCH_PX_PER_SECOND = 0.1;
const STRETCH_MAX_PX = 40;

const stretchOf = (seconds: number) =>
	Math.min(
		Math.max(0, (seconds - STRETCH_FROM_SECONDS) * STRETCH_PX_PER_SECOND),
		STRETCH_MAX_PX,
	);

// Identities, never positions: these are React's keys, so a reorder would otherwise remount every row below the drop and re-request its artwork.
// The occurrence counter is what lets the same track be queued twice.
const rowKeys = (entries: QueueEntry[]) => {
	const seen = new Map<string, number>();
	return entries.map((entry) => {
		const id = `${entry.playlistId}:${entry.itemIndex}`;
		const nth = seen.get(id) ?? 0;
		seen.set(id, nth + 1);
		return `${id}#${nth}`;
	});
};

// Null when nothing is playing: the first entry then starts whenever somebody presses play, which is not a number the rows can count down to.
function remainingOf(snapshot: PlayerSnapshot | null | undefined) {
	const item = snapshot?.player?.activeItem;
	if (!item || item.index < 0) return null;
	return Math.max(
		0,
		(item.duration ?? 0) - positionAt(snapshot, performance.now()),
	);
}

// Subscribes to the clock itself rather than taking a tick from the panel body: with an empty queue there are no rows to tick, so the value would never move.
function Remaining({
	snapshot,
	isPlaying,
}: {
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
}) {
	useQueueClock(isPlaying);

	const remaining = remainingOf(snapshot);

	return (
		<span className={styles.originLabel}>
			{remaining === null
				? "Nothing playing"
				: `${formatTime(remaining)} left of this track`}
		</span>
	);
}

// Its own leaf so a second passing repaints one span per row, not the rows.
function StartsIn({
	entry,
	snapshot,
	isPlaying,
}: {
	entry: QueueEntry;
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
}) {
	useQueueClock(isPlaying);

	const remaining = remainingOf(snapshot);
	if (remaining === null) return null;

	return (
		<span className={`${styles.when} tabular`}>
			in {formatTime(startsIn(entry, remaining))}
		</span>
	);
}

const QueueRow = memo(function QueueRow({
	entry,
	snapshot,
	isPlaying,
	canQueue,
	onRemove,
	rowProps,
	handleProps,
	itemProps,
}: {
	entry: QueueEntry;
	snapshot: PlayerSnapshot | null | undefined;
	isPlaying: boolean;
	canQueue: boolean;
	onRemove: () => void;
	rowProps: PropBag;
	handleProps: PropBag;
	itemProps: PropBag;
}) {
	// Drawn rather than hidden: it still occupies a place the player honours, so a silently missing row would be an unexplained gap.
	if (entry.isOrphan) {
		return (
			<li className={styles.row} data-orphan="true" {...itemProps}>
				<span className={styles.tick} aria-hidden="true" />
				<span className={styles.names}>
					<span className={styles.title}>Track no longer in its playlist</span>
					<span className={styles.artist}>
						It will be skipped. Remove it to tidy the queue.
					</span>
				</span>
				{canQueue ? (
					<button
						type="button"
						className={styles.remove}
						aria-label="Remove from queue"
						onClick={onRemove}
					>
						<X size={15} strokeWidth={2.2} />
					</button>
				) : null}
			</li>
		);
	}

	const { style, ...merged } = mergeHandlers(itemProps, rowProps);

	return (
		<li
			className={styles.row}
			{...merged}
			// After the spread and composed rather than replacing: the sortable hook owns `transform` on this element for the length of a drag.
			style={
				{
					...style,
					"--stretch": `${stretchOf(entry.duration)}px`,
				} as CSSProperties
			}
		>
			<Artwork
				className={styles.tick}
				src={artworkUrl(entry.playlistId, entry.itemIndex)}
				size={32}
			/>

			<span className={styles.names}>
				<span className={styles.title}>{entry.title || "Unknown title"}</span>
				<span className={styles.artist}>
					{entry.artist || "Unknown artist"}
					{entry.duration > 0 ? (
						<>
							<span className={styles.dot}>·</span>
							{formatTime(entry.duration)}
						</>
					) : null}
				</span>
			</span>

			<StartsIn entry={entry} snapshot={snapshot} isPlaying={isPlaying} />

			{canQueue ? (
				<span className={styles.controls}>
					{/* Coarse pointers only; a mouse drags the row itself. */}
					<button
						type="button"
						className={styles.grip}
						aria-label={`Reorder ${entry.title}`}
						tabIndex={-1}
						// The one thing in here that takes an axis for itself; without this the sideways drift of a row dragged down the panel reads as the flick that closes it.
						data-owns-touch=""
						{...handleProps}
					>
						<GripVertical size={15} strokeWidth={2} />
					</button>
					<button
						type="button"
						className={styles.remove}
						aria-label={`Remove ${entry.title} from the queue`}
						onClick={onRemove}
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
	const { data: snapshot } = usePlayer();
	const { entries, count } = useQueue();
	const { canQueue, remove, clear, move } = useQueueActions();

	const isPlaying = snapshot?.player?.playbackState === "playing";

	const keys = useMemo(() => rowKeys(entries), [entries]);

	const { scrollRef, itemProps, dragProps, handleProps } = useSortableList({
		keys,
		onReorder: move,
		disabled: !canQueue,
	});

	// A press anywhere else puts the queue away, at every width: it is a glance at what happens next, opened around whatever you were doing. The toggle is a panel away in the status bar, so it is named rather than contained.
	// `onEscape: false` hands that key to the capture listener below rather than declining it: the hook's own is a bubbling one, which the playlist scope would have answered first.
	const ref = useDismissable<HTMLElement>(isOpen, onDismiss, {
		ignore: "[data-queue-toggle]",
		onEscape: false,
	});

	const keyboardOwner = useKeyboardOwner();

	// Escape peels one layer, and this panel is the front one whenever it is up -- it opens over the now-playing screen and over the list, and both stand down for it. It stands down in turn for a dialog that has claimed the keyboard, which is in front of everything.
	useEscapeCapture(isOpen && keyboardOwner === null ? onDismiss : null);

	// It leaves the way it arrived: the panel slides in from the right edge, so the flick that puts it back is the one aimed at that edge. The vertical axis stays the scroller's, which is what a queue long enough to scroll is doing with it.
	const swipe = useSwipe({ onRight: onDismiss });

	return (
		<>
			{isCompactViewport && isOpen ? (
				<button
					type="button"
					className={styles.scrim}
					aria-label="Close the queue"
					onClick={onDismiss}
				/>
			) : null}

			<aside
				ref={ref}
				className={styles.panel}
				data-open={isOpen}
				aria-label="Queue"
				{...swipe}
				// Closed, the grid column is zero-width but still in the tab order.
				inert={isOpen ? undefined : true}
			>
				<header className={styles.header}>
					<div className={styles.heading}>
						<h2 className={styles.title}>Queue</h2>
						<p className={styles.meta}>
							{count === 0
								? "Nothing queued"
								: `${plural(count, "track")} · ${formatTime(queuedSeconds(entries))}`}
						</p>
					</div>

					{count > 0 && canQueue ? (
						<button type="button" className={styles.clear} onClick={clear}>
							Clear
						</button>
					) : null}

					<button
						type="button"
						className={styles.close}
						aria-label="Close the queue"
						onClick={onDismiss}
					>
						<X size={17} strokeWidth={2} />
					</button>
				</header>

				{/* A section, not a div, so the hook's HTMLElement ref can land on it. */}
				<section className={styles.scroller} ref={scrollRef}>
					{/* Every countdown below is measured from the end of this track, so the rail starts here rather than at the first queued row. */}
					<div className={styles.origin} data-live={isPlaying}>
						<span className={styles.pip} aria-hidden="true" />
						<Remaining snapshot={snapshot} isPlaying={isPlaying} />
					</div>

					{count === 0 ? (
						<div className={styles.empty}>
							<p className={styles.emptyLead}>The queue is empty.</p>
							<p className={styles.emptyBody}>
								Anything you put here plays next, in order, before the playlist
								carries on.
							</p>
							<p className={styles.emptyHint}>
								<span className={styles.fine}>
									Right-click a track and choose Add to queue.
								</span>
								<span className={styles.coarse}>
									Press and hold a track, then choose Add to queue.
								</span>
							</p>
						</div>
					) : (
						<ol className={styles.rail}>
							{entries.map((entry, index) => (
								<QueueRow
									key={keys[index]}
									entry={entry}
									snapshot={snapshot}
									isPlaying={isPlaying}
									canQueue={canQueue}
									onRemove={() => remove(entry.at)}
									rowProps={dragProps(index) as PropBag}
									handleProps={handleProps(index) as PropBag}
									itemProps={itemProps(index) as PropBag}
								/>
							))}
						</ol>
					)}
				</section>
			</aside>
		</>
	);
}
