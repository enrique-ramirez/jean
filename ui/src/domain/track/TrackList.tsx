import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type PointerEvent as ReactPointerEvent,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useEffectEvent,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { animateScrollTo } from "@/shared/ui/animateScroll";
import {
	contentOffsetOfElement,
	isScaled,
	registerScaledScroller,
	scaledHeight,
	scaledVirtualizerOptions,
	scrollScaleOf,
	scrollShift,
	scrollTopFor,
	settleOnRow,
} from "@/shared/ui/scaledScroll";
import { ALBUM_COVER, ALBUM_COVER_COMPACT, AlbumGroup } from "./AlbumGroup";
import { isMatch } from "./finderSets";
import { type AlbumSpan, coverRefOf, discsOf, groupIndexAt } from "./grouping";
import {
	type ActiveDirection,
	ROW_HEIGHT,
	type ScrollToTrackOptions,
	type TrackListHandle,
	type TrackRenderProps,
} from "./listTypes";
import type { TrackRows } from "./project";
import styles from "./TrackList.module.css";
import { TrackRow } from "./TrackRow";
import { REORDER_DROP_TARGET } from "./trackTargets";

const COMPACT_ROW_HEIGHT = 34;
const GROUP_PADDING = 28;
const GROUP_CAPTION = 56;
const DISC_HEADING = 40;
const COMPACT_HEADER = ALBUM_COVER_COMPACT + 34;

// Read from the scroller itself rather than the virtualiser, whose offset follows the scroller one
// event late: a list mounted into a restored scroll position would otherwise report the old one first.
const visibleRows = (
	scroller: HTMLElement,
	list: HTMLElement,
	length: number,
) => {
	const margin =
		list.getBoundingClientRect().top -
		scroller.getBoundingClientRect().top +
		scroller.scrollTop;
	const top = contentOffsetOfElement(scroller, scroller.scrollTop) - margin;
	const first = Math.min(Math.max(0, Math.floor(top / ROW_HEIGHT)), length - 1);
	const end = Math.min(
		Math.max(first + 1, Math.ceil((top + scroller.clientHeight) / ROW_HEIGHT)),
		length,
	);
	return { first, end };
};

type ScrollStep = -1 | 0 | 1;

const scrollDirection = () => {
	let last = -1;
	let direction: ScrollStep = 0;
	return (first: number): ScrollStep => {
		if (last >= 0 && first !== last) direction = first > last ? 1 : -1;
		last = first;
		return direction;
	};
};

const isWhollyVisible = (row: DOMRect, view: DOMRect) =>
	row.top >= view.top && row.bottom <= view.bottom;

const ancestorsUpTo = (
	element: HTMLElement,
	stop: HTMLElement,
): HTMLElement[] =>
	element.parentElement && element.parentElement !== stop
		? [element.parentElement, ...ancestorsUpTo(element.parentElement, stop)]
		: [];

const estimateGroupHeight = (
	group: AlbumSpan,
	rows: TrackRows,
	isCompactViewport: boolean,
) => {
	const discs = discsOf(group, rows)?.length ?? 0;
	const tracks = group.count * COMPACT_ROW_HEIGHT + discs * DISC_HEADING;
	if (isCompactViewport) return COMPACT_HEADER + tracks + GROUP_PADDING;
	return Math.max(
		ALBUM_COVER + GROUP_CAPTION + GROUP_PADDING,
		tracks + GROUP_PADDING,
	);
};

export function TrackList({
	ref,
	rows,
	groups,
	source,
	scrollRef,
	layout,
	columns,
	template,
	albumTemplate,
	showArtwork,
	heat,
	patina,
	showHeat,
	activeIndex,
	isPlaying,
	cursor,
	selection,
	matches,
	onSelect,
	onActiveDirectionChange,
	gripProps,
	reorderRows,
	isCompactViewport,
}: TrackRenderProps & {
	groups: AlbumSpan[];
	scrollRef: RefObject<HTMLElement | null>;
	layout: string;
	albumTemplate: string;
	showArtwork: boolean;
	showHeat: boolean;
	onActiveDirectionChange?: (direction: ActiveDirection) => void;
	gripProps?: { onPointerDown: (event: ReactPointerEvent) => void };
	reorderRows?: number;
	ref?: Ref<TrackListHandle>;
}) {
	const isAlbumLayout = layout === "album";
	const { viewport } = rows;

	const showsDisc = useMemo(() => {
		const answers = new Map<number, boolean>();
		return (position: number) => {
			if (isAlbumLayout) return false;
			const at = groupIndexAt(groups, position);
			if (at < 0) return false;
			let answer = answers.get(at);
			if (answer === undefined) {
				answer = discsOf(groups[at], rows) !== null;
				answers.set(at, answer);
			}
			return answer;
		};
	}, [isAlbumLayout, groups, rows]);

	// To the album run's opening row first, then through the refs: the other order looks up a
	// playlist index in a table of row positions.
	const coverIndexOf = (position: number) => {
		const at =
			showArtwork && !isAlbumLayout ? groupIndexAt(groups, position) : -1;
		return at < 0 ? rows.ref(position) : coverRefOf(groups[at], rows);
	};

	// Row 0 is not at scroll offset 0: the view header and toolbar sit above it, and without telling
	// the virtualiser every scrollToIndex lands short by exactly this much. Rendering looks right
	// either way, so only the scroll arithmetic is wrong.
	const listElement = useRef<HTMLDivElement | null>(null);
	const [scrollMargin, setScrollMargin] = useState(0);

	useLayoutEffect(() => {
		const list = listElement.current;
		const scroller = scrollRef.current;
		if (!list || !scroller) return undefined;

		scroller.setAttribute("data-drop-scroller", "");

		const measure = () => {
			// Rounded, or a fractional margin leaks into every row's transform and the sub-pixel churn
			// re-renders the list for nothing.
			const next = Math.round(
				list.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top +
					scroller.scrollTop,
			);
			setScrollMargin((current) => (current === next ? current : next));
		};

		measure();

		// The whole chain up to the scroller, since `.rows` is display:contents and generates no box for
		// a ResizeObserver to watch.
		const observer = new ResizeObserver(measure);
		[scroller, ...ancestorsUpTo(list, scroller)].forEach((node) => {
			observer.observe(node);
		});
		// A sibling of the view that is added or removed above it moves the list without resizing
		// the scroller or anything the list sits in.
		const siblings = new MutationObserver(measure);
		siblings.observe(scroller, { childList: true });
		return () => {
			observer.disconnect();
			siblings.disconnect();
			scroller.removeAttribute("data-drop-scroller");
		};
	}, [scrollRef]);

	const { length } = rows;

	useEffect(() => {
		const scroller = scrollRef.current;
		const list = listElement.current;
		if (!viewport || isAlbumLayout || !scroller || !list || length === 0)
			return undefined;

		let frame = 0;
		const directionAt = scrollDirection();
		const report = () => {
			frame = 0;
			const { first, end } = visibleRows(scroller, list, length);
			viewport.watch(first, end, directionAt(first));
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(report);
		};

		report();
		scroller.addEventListener("scroll", schedule, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", schedule);
			viewport.leave();
		};
	}, [viewport, isAlbumLayout, scrollRef, length]);

	const virtualizer = useVirtualizer({
		scrollMargin,
		count: isAlbumLayout ? groups.length : rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) =>
			isAlbumLayout
				? estimateGroupHeight(groups[index], rows, isCompactViewport)
				: ROW_HEIGHT,
		overscan: isAlbumLayout ? 3 : 12,
		// Measurements are cached by item key and the default key is the index, so group 0 of one search
		// would inherit the height of group 0 of the last -- and stay wrong, since measureElement reports
		// only on mount and on resize.
		getItemKey: isAlbumLayout
			? (index) => groups[index]?.key ?? index
			: undefined,
		measureElement: isAlbumLayout
			? (element) => element.getBoundingClientRect().height
			: undefined,
		...scaledVirtualizerOptions,
	});

	useLayoutEffect(() => {
		const scroller = scrollRef.current;
		return scroller ? registerScaledScroller(scroller, virtualizer) : undefined;
	}, [scrollRef, virtualizer]);

	const cancelScroll = useRef<(() => void) | null>(null);

	const rowElement = useCallback(
		(index: number) =>
			scrollRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`) ??
			null,
		[scrollRef],
	);

	const rowAsk = useRef<{
		index: number;
		run: (row: HTMLElement) => void;
	} | null>(null);

	useImperativeHandle(
		ref,
		() => ({
			scrollToTrack(
				index: number,
				{
					animate = false,
					align = "center",
					ifNeeded = false,
				}: ScrollToTrackOptions = {},
			) {
				rowAsk.current = null;
				const target = isAlbumLayout
					? groups.findIndex((entry) => index < entry.start + entry.count)
					: index;
				if (target < 0) return;

				const element = scrollRef.current;
				if (!element) return;

				const rowRect = () =>
					rowElement(index)?.getBoundingClientRect() ?? null;

				if (ifNeeded) {
					const seen = rowRect();
					if (seen && isWhollyVisible(seen, element.getBoundingClientRect()))
						return;
				}
				cancelScroll.current?.();
				cancelScroll.current = null;

				const scale = () => scrollScaleOf(virtualizer);

				const centreOnRow = () => {
					const seen = rowRect();
					if (!seen) return null;
					const view = element.getBoundingClientRect();
					return (
						element.scrollTop +
						((seen.top + seen.bottom) / 2 - (view.top + view.bottom) / 2) /
							scale()
					);
				};

				const offsetFor = () =>
					(align === "center" ? centreOnRow() : null) ??
					virtualizer.getOffsetForIndex(target, align)?.[0] ??
					null;

				// A smooth scroll over the browser height cap ends before its target row is mounted.
				if (isScaled(virtualizer)) {
					const item = virtualizer.measurementsCache[target];
					if (item) element.scrollTop = scrollTopFor(virtualizer, item, align);
					if (align === "center")
						cancelScroll.current = settleOnRow(element, centreOnRow);
					return;
				}

				if (!animate) {
					virtualizer.scrollToIndex(target, { align });
					if (align === "center") {
						requestAnimationFrame(() => {
							const refined = centreOnRow();
							if (refined != null) element.scrollTop = refined;
						});
					}
					return;
				}

				cancelScroll.current = animateScrollTo(element, offsetFor);
			},
			whenRowMounted(index, run) {
				const row = rowElement(index);
				if (row) run(row);
				else rowAsk.current = { index, run };
			},
		}),
		[isAlbumLayout, groups, virtualizer, scrollRef, rowElement],
	);

	useEffect(
		() => () => {
			cancelScroll.current?.();
			rowAsk.current = null;
		},
		[],
	);

	const listIdentity = viewport ?? rows;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a change of list fires the clear rather than being read in it
	useEffect(() => {
		rowAsk.current = null;
	}, [listIdentity]);

	useEffect(() => {
		const ask = rowAsk.current;
		if (!ask) return;
		const row = rowElement(ask.index);
		if (!row) return;
		rowAsk.current = null;
		ask.run(row);
	});

	const remeasure = useEffectEvent(() => virtualizer.measure());

	// biome-ignore lint/correctness/useExhaustiveDependencies: the switches fire the effect rather than being read in it -- row 4 in list mode is not album 4, so every cached height is invalid across either
	useEffect(() => {
		remeasure();
	}, [isAlbumLayout, isCompactViewport]);

	const virtualItems = virtualizer.getVirtualItems();
	const firstGroup = virtualItems[0]?.index;

	const [albumDirection] = useState(scrollDirection);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!viewport || !isAlbumLayout || !scroller) return undefined;
		if (firstGroup === undefined) return undefined;

		let frame = 0;
		const report = () => {
			frame = 0;
			const sight = scroller.getBoundingClientRect();
			let first = Number.POSITIVE_INFINITY;
			let last = -1;
			for (const row of scroller.querySelectorAll<HTMLElement>("[data-row]")) {
				const box = row.getBoundingClientRect();
				if (box.bottom < sight.top || box.top > sight.bottom) continue;
				const index = Number(row.dataset.row);
				first = Math.min(first, index);
				last = Math.max(last, index);
			}
			if (last < 0) {
				first = groups[firstGroup].start;
				last = first;
			}
			viewport.watch(first, last + 1, albumDirection(first));
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(report);
		};

		report();
		scroller.addEventListener("scroll", schedule, { passive: true });
		const drawn = new MutationObserver(schedule);
		const list = listElement.current;
		if (list) drawn.observe(list, { childList: true, subtree: true });
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", schedule);
			drawn.disconnect();
		};
	}, [viewport, isAlbumLayout, scrollRef, groups, firstGroup, albumDirection]);

	useEffect(
		() => (isAlbumLayout ? viewport?.leave : undefined),
		[viewport, isAlbumLayout],
	);

	const shift = scrollShift(virtualizer);

	const listId = useId();
	const rowId = (index: number) => `${listId}-${index}`;

	const isCursorMounted = virtualItems.some(({ index }) => {
		if (!isAlbumLayout) return index === cursor;
		const group = groups[index];
		return (
			group !== undefined &&
			group.start <= cursor &&
			cursor < group.start + group.count
		);
	});

	// Rendered is not visible: overscan mounts rows past the fold, so a mounted row is measured
	// against the scroll container and only an absent one falls back to the index range.
	const reported = useRef<ActiveDirection | undefined>(undefined);

	useEffect(() => {
		const next = (() => {
			if (activeIndex < 0) return null;

			const scroller = scrollRef.current;
			if (!scroller) return null;

			// `[data-row]` as well, or anything else in the scroller that marks itself active -- a tab
			// strip in the header, say -- answers instead and the pill reports on that.
			const row = scroller.querySelector('[data-row][data-active="true"]');
			if (row) {
				const rowRect = row.getBoundingClientRect();
				const viewRect = scroller.getBoundingClientRect();
				if (rowRect.bottom <= viewRect.top) return "up";
				if (rowRect.top >= viewRect.bottom) return "down";
				return null;
			}

			if (virtualItems.length === 0) return null;
			const first = virtualItems[0].index;
			const last = virtualItems[virtualItems.length - 1].index;
			const start = isAlbumLayout ? groups[first].start : first;
			const end = isAlbumLayout
				? groups[last].start + groups[last].count - 1
				: last;
			return activeIndex < start ? "up" : activeIndex > end ? "down" : null;
		})();

		if (reported.current === next) return;
		reported.current = next;
		onActiveDirectionChange?.(next);
	});

	return (
		// biome-ignore lint/a11y/useSemanticElements: rows are absolutely positioned by the virtualiser, which table layout cannot express
		<div
			ref={listElement}
			className={showHeat ? styles.list : `${styles.list} heat-off`}
			style={{ height: scaledHeight(virtualizer.getTotalSize()) }}
			role="grid"
			tabIndex={0}
			aria-rowcount={rows.length}
			aria-activedescendant={isCursorMounted ? rowId(cursor) : undefined}
			data-drop-target={
				reorderRows === undefined ? undefined : REORDER_DROP_TARGET
			}
			data-drop-rows={reorderRows}
			data-drop-spans={
				isAlbumLayout && reorderRows !== undefined ? "" : undefined
			}
		>
			{virtualItems.map((virtualRow) => (
				<div
					key={virtualRow.key}
					data-index={virtualRow.index}
					ref={isAlbumLayout ? virtualizer.measureElement : undefined}
					className={styles.row}
					style={{
						transform: `translateY(${virtualRow.start - scrollMargin - shift}px)`,
						...(isAlbumLayout ? null : { height: virtualRow.size }),
					}}
				>
					{isAlbumLayout ? (
						<AlbumGroup
							group={groups[virtualRow.index]}
							rows={rows}
							source={source}
							columns={columns}
							template={albumTemplate}
							heat={heat}
							patina={patina}
							activeIndex={activeIndex}
							isPlaying={isPlaying}
							cursor={cursor}
							selection={selection}
							matches={matches}
							onSelect={onSelect}
							isCompactViewport={isCompactViewport}
							rowId={rowId}
						/>
					) : (
						<TrackRow
							id={rowId(virtualRow.index)}
							rows={rows}
							index={virtualRow.index}
							itemIndex={rows.ref(virtualRow.index)}
							coverIndex={coverIndexOf(virtualRow.index)}
							source={source}
							columns={columns}
							template={template}
							showArtwork={showArtwork}
							heat={heat[virtualRow.index]}
							patina={patina[virtualRow.index]}
							isActive={virtualRow.index === activeIndex}
							isPlaying={isPlaying}
							isSelected={selection.has(virtualRow.index)}
							isCursor={virtualRow.index === cursor}
							isMatch={isMatch(matches, virtualRow.index)}
							showDisc={showsDisc(virtualRow.index)}
							onSelect={onSelect}
							onGripPointerDown={gripProps?.onPointerDown}
						/>
					)}
				</div>
			))}
		</div>
	);
}
