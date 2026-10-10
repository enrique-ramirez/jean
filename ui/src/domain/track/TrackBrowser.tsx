import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { mergeHandlers } from "@/shared/lib/mergeHandlers";
import { resolveColumns } from "./columns";
import { useAvailableFields } from "./fieldAvailability";
import { groupByAlbum } from "./grouping";
import type { LibrarySource } from "./librarySource";
import type {
	ActiveDirection,
	ScrollToTrackOptions,
	TrackBrowserHandle,
	TrackListHandle,
} from "./listTypes";
import { NowPlayingPill } from "./NowPlayingPill";
import type { TrackRows } from "./project";
import { setRatingTarget } from "./ratingTarget";
import styles from "./TrackBrowser.module.css";
import { TrackList } from "./TrackList";
import { TrackToolbar } from "./TrackToolbar";
import { useFollowPlayback } from "./useFollowPlayback";
import { useListPreferences } from "./useListPreferences";
import { useRowPointer } from "./useRowPointer";
import { useTrackContextMenu } from "./useTrackContextMenu";
import { useAlbumDragSource, useTrackDragSource } from "./useTrackDragSource";
import { useTrackSelection } from "./useTrackSelection";

const PAGE = 12;

export interface TrackBrowserProps {
	rows: TrackRows;
	source: LibrarySource;
	viewKey: string;
	heat: Float32Array;
	patina: Float32Array;
	activeIndex?: number;
	isPlaying: boolean;
	matches?: Set<number> | null;
	isLoading: boolean;
	loaded: number;
	total: number;
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	header?: ReactNode;
	toolbarLeading?: ReactNode;
	emptyNotice?: ReactNode;
	loadingNotice?: ReactNode;
	progressLabel?: string;
	keysEnabled?: boolean;
	canFollowPlayback?: boolean;
	onPlay: (position: number) => void;
	onOpenFinder?: () => void;
	onReorder?: (positions: number[], gap: number) => number | null;
	onNudge?: (positions: number[], delta: number) => number | null;
	onRemove?: (positions: number[]) => boolean;
	ref?: Ref<TrackBrowserHandle>;
}

export function TrackBrowser({
	ref,
	rows,
	source,
	viewKey,
	heat,
	patina,
	activeIndex = -1,
	isPlaying,
	matches = null,
	isLoading,
	loaded,
	total,
	scrollRef,
	isCompactViewport,
	header,
	toolbarLeading,
	emptyNotice,
	loadingNotice,
	progressLabel,
	keysEnabled = true,
	canFollowPlayback = false,
	onPlay,
	onOpenFinder,
	onReorder,
	onNudge,
	onRemove,
}: TrackBrowserProps) {
	const t = useTranslate();
	const listRef = useRef<TrackListHandle | null>(null);
	const canControlPlayback = useCanControlPlayback();

	const preferences = useListPreferences();
	const { layout, showHeat, showArtwork, enabledIds } = preferences;
	const [activeDirection, setActiveDirection] = useState<ActiveDirection>(null);

	const selection = useTrackSelection(rows.length, viewKey);
	const { isAvailable, hasPlayCounts } = useAvailableFields();

	const groups = useMemo(() => groupByAlbum(rows), [rows]);
	const hasDiscs = useMemo(() => groups.some((group) => group.discs), [groups]);

	const { optional, template, albumTemplate } = useMemo(
		() =>
			resolveColumns({
				enabledIds,
				showArtwork,
				isCompactViewport,
				isAvailable,
				hasDiscs,
			}),
		[enabledIds, showArtwork, isCompactViewport, isAvailable, hasDiscs],
	);

	const scrollToTrack = useCallback(
		(position: number, options?: ScrollToTrackOptions) => {
			listRef.current?.scrollToTrack(position, options);
		},
		[],
	);

	const { moveCursorTo, moveCursor } = selection;

	const play = useCallback(
		(position: number) => {
			moveCursorTo(position);
			if (!canControlPlayback) return;
			onPlay(position);
		},
		[moveCursorTo, onPlay, canControlPlayback],
	);

	const preview = useCallback(
		(position: number) => {
			moveCursorTo(position);
			scrollToTrack(position, { align: "center" });
		},
		[moveCursorTo, scrollToTrack],
	);

	useImperativeHandle(ref, () => ({ play, preview, scrollToTrack }), [
		play,
		preview,
		scrollToTrack,
	]);

	const { selectBlock, clear: clearSelection } = selection;

	const removeRows = useMemo(
		() =>
			onRemove
				? (positions: number[]) => {
						if (positions.length === 0 || !onRemove(positions)) return;
						const remaining = rows.length - positions.length;
						const first = positions.reduce((least, at) => Math.min(least, at));
						const next = Math.min(first, remaining - 1);
						if (next < 0) clearSelection();
						else selectBlock(next, next, next);
					}
				: undefined,
		[onRemove, rows.length, clearSelection, selectBlock],
	);

	const trackMenu = useTrackContextMenu({
		rows,
		source,
		selection: selection.selection,
		onSelectOnly: moveCursorTo,
		onRemove: removeRows,
	});

	const isListLayout = layout !== "album";

	const followRows = useCallback(
		(landed: number | null, count: number, cursorRank: number) => {
			if (landed === null) return;
			selectBlock(landed, landed + count - 1, landed + cursorRank);
		},
		[selectBlock],
	);

	const reorder = useMemo(
		() =>
			onReorder
				? (positions: number[], gap: number) =>
						followRows(
							onReorder(positions, gap),
							positions.length,
							positions.length - 1,
						)
				: undefined,
		[onReorder, followRows],
	);

	const trackDrag = useTrackDragSource({
		rows,
		source,
		selection: selection.selection,
		onReorder: isListLayout ? reorder : undefined,
	});

	const albumDrag = useAlbumDragSource({
		rows,
		groups,
		source,
		onReorder: isListLayout ? undefined : reorder,
	});

	const nudgeRows = useCallback(
		(delta: number) => {
			if (!onNudge) return;
			const positions = [...selection.selection].sort((a, b) => a - b);
			if (positions.length === 0) return;
			if (document.activeElement?.closest("[data-nav-row]")) return;

			pendingScroll.current = true;
			followRows(
				onNudge(positions, delta),
				positions.length,
				Math.max(positions.indexOf(selection.cursor), 0),
			);
		},
		[onNudge, selection.selection, selection.cursor, followRows],
	);

	const { selectFromPointer, rowHandlers } = useRowPointer({
		rows,
		groups,
		selection,
		trackDrag,
		play,
	});

	const onViewClick = useCallback(
		(event: ReactMouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					"[data-row], [data-album-cover], button, a, input, label",
				)
			)
				return;
			clearSelection();
		},
		[clearSelection],
	);

	// Only when the keyboard moved it: arriving chunks clamp the cursor too, and scrolling to that
	// drags the view back to the top mid-scroll.
	const pendingScroll = useRef(false);

	const keyMove = useCallback(
		(delta: number, options?: { extend?: boolean }) => {
			pendingScroll.current = true;
			moveCursor(delta, options);
		},
		[moveCursor],
	);

	const keyMoveTo = useCallback(
		(position: number) => {
			pendingScroll.current = true;
			moveCursorTo(position);
		},
		[moveCursorTo],
	);

	useEffect(() => {
		if (!pendingScroll.current) return;
		pendingScroll.current = false;
		scrollToTrack(selection.cursor, { align: "auto" });
	}, [selection.cursor, scrollToTrack]);

	useEffect(() => {
		if (selection.cursor < 0 || selection.cursor >= rows.length)
			return undefined;
		setRatingTarget({
			source,
			ref: rows.ref(selection.cursor),
			columns: rows.columns,
		});
		return () => setRatingTarget(null);
	}, [source, rows, selection.cursor]);

	useKeymap(
		SCOPE.playlist,
		{ moveRowsUp: () => nudgeRows(-1), moveRowsDown: () => nudgeRows(1) },
		{ enabled: keysEnabled && isListLayout && onNudge !== undefined },
	);

	useKeymap(
		SCOPE.playlist,
		{
			removeRows: () => {
				if (document.activeElement?.closest("[data-nav-row]")) return;
				removeRows?.([...selection.selection]);
			},
		},
		{ enabled: keysEnabled && removeRows !== undefined },
	);

	const openMenuAtCursor = () => {
		const index = selection.cursor;
		if (index < 0 || index >= rows.length) return;
		scrollToTrack(index, { align: "auto", ifNeeded: true });
		listRef.current?.whenRowMounted(index, (row) =>
			trackMenu.openForRow(index, row),
		);
	};

	useFollowPlayback({
		rowCount: rows.length,
		viewKey,
		activeIndex,
		canFollowPlayback,
		cursor: selection.cursor,
		play,
		moveCursorTo,
		scrollToTrack,
	});

	// Registered apart from the rest and deliberately not behind `keysEnabled`, which is false while
	// the finder is open -- exactly when `/` has to mean "back to the field".
	useKeymap(
		SCOPE.playlist,
		{ ...(onOpenFinder ? { openFinder: onOpenFinder } : null) },
		{ enabled: rows.length > 0 },
	);

	useKeymap(
		SCOPE.playlist,
		{
			cursorDown: () => keyMove(1),
			cursorUp: () => keyMove(-1),
			cursorPageDown: () => keyMove(PAGE),
			cursorPageUp: () => keyMove(-PAGE),
			cursorTop: () => keyMoveTo(0),
			cursorBottom: () => keyMoveTo(rows.length - 1),
			playCursor: () => play(selection.cursor),
			openRowMenu: () => {
				if (document.activeElement?.closest("[data-nav-row]")) return;
				openMenuAtCursor();
			},
			extendDown: () => keyMove(1, { extend: true }),
			extendUp: () => keyMove(-1, { extend: true }),
			selectAll: selection.selectAll,
			clearSelection: selection.clear,
			toggleLayout: preferences.toggleLayout,
			toggleHeat: preferences.toggleHeat,
		},
		{ enabled: keysEnabled && rows.length > 0 },
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the background behind the list, whose only job is to notice that a click missed every row
		// biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is Escape, declared in the keymap rather than here -- a keydown on this element would need it focusable, which is the thing it must not be
		<div className={styles.view} onClick={onViewClick}>
			{header}

			<TrackToolbar
				leading={toolbarLeading}
				preferences={preferences}
				isAvailable={isAvailable}
				hasPlayCounts={hasPlayCounts}
			/>

			{isLoading ? (
				<div
					className={styles.progress}
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={total}
					aria-valuenow={loaded}
					aria-label={progressLabel || t("track.loading")}
					style={{ transform: `scaleX(${total ? loaded / total : 0})` }}
				/>
			) : null}

			{rows.length === 0 ? (
				loadingNotice !== undefined ? (
					loadingNotice ? (
						<p className={styles.notice}>{loadingNotice}</p>
					) : null
				) : isLoading ? null : (
					<p className={styles.notice}>{emptyNotice}</p>
				)
			) : (
				<div
					className={styles.rows}
					{...mergeHandlers(
						trackMenu.triggerProps,
						trackDrag.dragProps,
						albumDrag.dragProps,
						rowHandlers,
					)}
				>
					<TrackList
						ref={listRef}
						rows={rows}
						groups={groups}
						source={source}
						scrollRef={scrollRef}
						layout={layout}
						columns={optional}
						template={template}
						albumTemplate={albumTemplate}
						showArtwork={showArtwork}
						heat={heat}
						patina={patina}
						showHeat={showHeat}
						activeIndex={activeIndex}
						isPlaying={isPlaying}
						cursor={selection.cursor}
						selection={selection.selection}
						matches={matches}
						onSelect={selectFromPointer}
						gripProps={
							isListLayout && reorder ? trackDrag.handleProps : undefined
						}
						reorderRows={reorder ? rows.length : undefined}
						onActiveDirectionChange={setActiveDirection}
						isCompactViewport={isCompactViewport}
					/>
				</div>
			)}

			{trackMenu.element}

			{activeIndex >= 0 ? (
				<NowPlayingPill
					direction={activeDirection}
					onClick={() =>
						scrollToTrack(activeIndex, { align: "center", animate: true })
					}
				/>
			) : null}
		</div>
	);
}
