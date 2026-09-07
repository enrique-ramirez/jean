import { ArrowDown, ArrowUp, Flame, LayoutList, ListMusic } from "lucide-react";
import {
	forwardRef,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { TrackColumns } from "@/shared/api/types";
import { useStoredState } from "@/shared/hooks/useStoredState";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { mergeHandlers } from "@/shared/lib/mergeHandlers";
import { Button } from "@/shared/ui/Button";
import type { IconComponent } from "@/shared/ui/icons";
import { Menu } from "@/shared/ui/Menu";
import { Segmented } from "@/shared/ui/Segmented";
import { ColumnsMenu } from "./ColumnsMenu";
import { DEFAULT_COLUMN_IDS, resolveColumns } from "./columns";
import {
	useCursorFollowsPlayback,
	usePlaybackFollowsCursor,
} from "./followSettings";
import { groupByAlbum } from "./grouping";
import { HeatLegend } from "./HeatLegend";
import { jumpAnswered, useJumpAsked } from "./jumpToPlaying";
import type { LibrarySource } from "./librarySource";
import type {
	ActiveDirection,
	ScrollToTrackOptions,
	TrackBrowserHandle,
	TrackListHandle,
} from "./listTypes";
import { type Refs, refAt } from "./project";
import { setRatingTarget } from "./ratingTarget";
import styles from "./TrackBrowser.module.css";
import { TrackList } from "./TrackList";
import { targetsFrom } from "./trackTargets";
import { useAvailableFields } from "./useAvailableFields";
import { useTrackContextMenu } from "./useTrackContextMenu";
import { useTrackDragSource } from "./useTrackDragSource";
import { useTrackSelection } from "./useTrackSelection";

type Layout = "compact" | "album";

const LAYOUTS = [
	{ value: "compact", label: "layout.list", icon: LayoutList },
	{ value: "album", label: "layout.albums", icon: ListMusic },
] as const satisfies readonly {
	value: Layout;
	label: Phrase;
	icon: IconComponent;
}[];

const PAGE = 12;

const isRepeatClick = (event: ReactMouseEvent) => event.detail > 1;

export const TrackBrowser = forwardRef(function TrackBrowser(
	{
		rows,
		indices = null,
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
		keysEnabled = true,
		canFollowPlayback = false,
		onPlay,
		onOpenFinder,
	}: {
		rows: TrackColumns[];
		indices?: Refs | null;
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
		keysEnabled?: boolean;
		canFollowPlayback?: boolean;
		onPlay: (position: number) => void;
		onOpenFinder?: () => void;
	},
	ref: Ref<TrackBrowserHandle>,
) {
	const t = useTranslate();
	const listRef = useRef<TrackListHandle | null>(null);

	const layouts = useMemo(
		() => LAYOUTS.map((option) => ({ ...option, label: t(option.label) })),
		[t],
	);

	const [layout, setLayout] = useStoredState<Layout>("jean.layout", "compact");
	const [showHeat, setShowHeat] = useStoredState("jean.heat", true);
	const [showArtwork, setShowArtwork] = useStoredState("jean.artwork", true);
	const [enabledIds, setEnabledIds] = useStoredState<string[]>(
		"jean.columns",
		DEFAULT_COLUMN_IDS,
	);
	const [cursorFollowsPlayback] = useCursorFollowsPlayback();
	const [playbackFollowsCursor] = usePlaybackFollowsCursor();
	const [isColumnsOpen, setIsColumnsOpen] = useState(false);
	const [isHeatInfoOpen, setIsHeatInfoOpen] = useState(false);
	const [heatIntroSeen, setHeatIntroSeen] = useStoredState(
		"jean.heatIntroSeen",
		false,
	);
	const [activeDirection, setActiveDirection] = useState<ActiveDirection>(null);
	const lastDirection = useRef<"up" | "down">("down");

	const selection = useTrackSelection(rows.length, viewKey);
	const { isAvailable, hasPlayCounts } = useAvailableFields(rows);

	const dismissHeatInfo = useCallback(() => {
		setIsHeatInfoOpen(false);
		setHeatIntroSeen(true);
	}, [setHeatIntroSeen]);

	useEffect(() => {
		if (heatIntroSeen || !hasPlayCounts || !showHeat) return;
		setIsHeatInfoOpen(true);
	}, [heatIntroSeen, hasPlayCounts, showHeat]);

	const groups = useMemo(() => groupByAlbum(rows, t), [rows, t]);
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
			onPlay(position);
		},
		[moveCursorTo, onPlay],
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

	const trackMenu = useTrackContextMenu({
		rows,
		indices,
		source,
		selection: selection.selection,
		onSelectOnly: moveCursorTo,
	});

	const trackDrag = useTrackDragSource({
		rows,
		indices,
		source,
		selection: selection.selection,
	});

	// Collapsing a multi-track selection on the way down would kill a drag of all of them, so the
	// collapse waits for the pointer to come up.
	const pendingCollapse = useRef<number | null>(null);

	const selectFromPointer = useCallback(
		(index: number, event: ReactPointerEvent) => {
			const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey;
			if (
				plain &&
				selection.selection.has(index) &&
				selection.selection.size > 1
			) {
				pendingCollapse.current = index;
				return;
			}
			selection.selectFromEvent(index, event);
		},
		[selection],
	);

	const resolveCollapse = useCallback(() => {
		const pending = pendingCollapse.current;
		pendingCollapse.current = null;
		if (pending !== null && !trackDrag.didDrag()) moveCursorTo(pending);
	}, [moveCursorTo, trackDrag]);

	// Recorded on the way down rather than read off the click: `click` is a PointerEvent in Chromium
	// and Safari but a plain MouseEvent in Firefox, where every desktop click would read as a tap.
	const pointerType = useRef("mouse");

	const playFromPointer = useCallback(
		(event: ReactMouseEvent) => {
			const aimed = targetsFrom(event, rows, selection.selection);
			if (aimed) play(aimed.index);
		},
		[rows, selection.selection, play],
	);

	// `click` rather than `pointerup`: the browser withholds it when the gesture turns out to be a scroll.
	const onRowsClick = useCallback(
		(event: ReactMouseEvent) => {
			if (pointerType.current === "mouse" || isRepeatClick(event)) return;
			playFromPointer(event);
		},
		[playFromPointer],
	);

	const onRowsDoubleClick = useCallback(
		(event: ReactMouseEvent) => {
			if (pointerType.current !== "mouse") return;
			playFromPointer(event);
		},
		[playFromPointer],
	);

	const clearSelection = selection.clear;
	const onViewClick = useCallback(
		(event: ReactMouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("[data-row], button, a, input, label")) return;
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

	const cursorRow = rows[selection.cursor];
	useEffect(() => {
		if (!cursorRow) return undefined;
		const ref = refAt(indices, selection.cursor);
		setRatingTarget({ source, ref, row: cursorRow });
		return () => setRatingTarget(null);
	}, [source, indices, selection.cursor, cursorRow]);

	const jumpAsked = useJumpAsked();
	useEffect(() => {
		if (!jumpAsked) return;
		if (activeIndex < 0 || activeIndex >= rows.length) return;
		jumpAnswered();
		moveCursorTo(activeIndex);
		scrollToTrack(activeIndex, { align: "center" });
	}, [jumpAsked, activeIndex, rows.length, moveCursorTo, scrollToTrack]);

	const cursorAt = useRef(selection.cursor);
	cursorAt.current = selection.cursor;

	const followedIndex = useRef(-1);
	const followedView = useRef<string | null>(null);

	useEffect(() => {
		if (!canFollowPlayback) return;
		if (activeIndex < 0 || activeIndex >= rows.length) return;

		const arrived = followedView.current !== viewKey;
		followedView.current = viewKey;
		if (!arrived && followedIndex.current === activeIndex) return;

		const wasPlaying = followedIndex.current;
		followedIndex.current = activeIndex;

		// Must run before the cursor moves below, or there is nothing left to compare. Excluding
		// `wasPlaying` stops the two follow settings looping, since with both on the cursor sits on the
		// track that just ended; excluding `arrived` stops navigation reading as a track change.
		const cursor = cursorAt.current;
		if (
			playbackFollowsCursor &&
			!arrived &&
			cursor !== activeIndex &&
			cursor !== wasPlaying &&
			cursor >= 0 &&
			cursor < rows.length
		) {
			play(cursor);
			return;
		}

		if (!cursorFollowsPlayback) return;
		moveCursorTo(activeIndex);

		scrollToTrack(activeIndex, {
			align: "center",
			animate: true,
			ifNeeded: true,
		});
	}, [
		activeIndex,
		rows.length,
		viewKey,
		canFollowPlayback,
		cursorFollowsPlayback,
		playbackFollowsCursor,
		play,
		moveCursorTo,
		scrollToTrack,
	]);

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
			jumpToPlaying: () => {
				if (activeIndex < 0) return;
				moveCursorTo(activeIndex);
				scrollToTrack(activeIndex, { align: "center", animate: true });
			},
			extendDown: () => keyMove(1, { extend: true }),
			extendUp: () => keyMove(-1, { extend: true }),
			selectAll: selection.selectAll,
			clearSelection: selection.clear,
			toggleLayout: () =>
				setLayout((current) => (current === "compact" ? "album" : "compact")),
			toggleHeat: () => setShowHeat((current) => !current),
		},
		{ enabled: keysEnabled && rows.length > 0 },
	);

	if (activeDirection) lastDirection.current = activeDirection;
	const shownDirection = activeDirection ?? lastDirection.current;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the background behind the list, whose only job is to notice that a click missed every row
		// biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is Escape, declared in the keymap rather than here -- a keydown on this element would need it focusable, which is the thing it must not be
		<div className={styles.view} onClick={onViewClick}>
			{header}

			<div className={styles.toolbar}>
				{toolbarLeading}

				<span className={styles.spacer} />

				{hasPlayCounts ? (
					<Menu
						isOpen={isHeatInfoOpen}
						onDismiss={dismissHeatInfo}
						role="dialog"
						className={styles.heatInfo}
						trigger={
							<Button
								icon={Flame}
								aria-pressed={showHeat}
								aria-label={t("heat.show")}
								title={t("heat.title")}
								onClick={() => {
									setShowHeat((current) => !current);
									if (isHeatInfoOpen) dismissHeatInfo();
								}}
							/>
						}
					>
						<HeatLegend onDismiss={dismissHeatInfo} />
					</Menu>
				) : null}

				<Segmented
					value={layout}
					onChange={setLayout}
					options={layouts}
					label={t("layout.label")}
				/>

				<ColumnsMenu
					isOpen={isColumnsOpen}
					onOpenChange={setIsColumnsOpen}
					enabledIds={enabledIds}
					isAvailable={isAvailable}
					onExplainHeat={
						hasPlayCounts
							? () => {
									setIsColumnsOpen(false);
									setIsHeatInfoOpen(true);
								}
							: undefined
					}
					showArtwork={showArtwork}
					onToggleArtwork={() => setShowArtwork((current) => !current)}
					onToggleColumn={(id: string) =>
						setEnabledIds((current) =>
							current.includes(id)
								? current.filter((entry) => entry !== id)
								: [...current, id],
						)
					}
				/>
			</div>

			{isLoading ? (
				<div
					className={styles.progress}
					style={{ transform: `scaleX(${total ? loaded / total : 0})` }}
				/>
			) : null}

			{rows.length === 0 ? (
				isLoading ? null : (
					<p className={styles.notice}>{emptyNotice}</p>
				)
			) : (
				<div
					className={styles.rows}
					{...mergeHandlers(trackMenu.triggerProps, trackDrag.dragProps, {
						onPointerDown: (event: ReactPointerEvent) => {
							pointerType.current = event.pointerType;
						},
						onPointerUp: resolveCollapse,
						onClick: onRowsClick,
						onDoubleClick: onRowsDoubleClick,
					})}
				>
					<TrackList
						ref={listRef}
						rows={rows}
						groups={groups}
						indices={indices}
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
						onActiveDirectionChange={setActiveDirection}
						isCompactViewport={isCompactViewport}
					/>
				</div>
			)}

			{trackMenu.element}

			{activeIndex >= 0 ? (
				<div className={styles.pillSlot} aria-hidden={!activeDirection}>
					<button
						type="button"
						className={styles.pill}
						data-visible={Boolean(activeDirection)}
						data-direction={shownDirection}
						tabIndex={activeDirection ? 0 : -1}
						onClick={() =>
							scrollToTrack(activeIndex, { align: "center", animate: true })
						}
					>
						{shownDirection === "up" ? (
							<ArrowUp size={14} />
						) : (
							<ArrowDown size={14} />
						)}
						Now playing
					</button>
				</div>
			) : null}
		</div>
	);
});
