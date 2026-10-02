import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type PointerEvent as ReactPointerEvent,
	type Ref,
	type RefObject,
	useEffect,
	useEffectEvent,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { animateScrollTo } from "@/shared/ui/animateScroll";
import { ALBUM_COVER, ALBUM_COVER_COMPACT, AlbumGroup } from "./AlbumGroup";
import { type AlbumRun, albumCoverRows, multiDiscRows } from "./grouping";
import type {
	ActiveDirection,
	ScrollToTrackOptions,
	TrackListHandle,
	TrackRenderProps,
} from "./listTypes";
import styles from "./TrackList.module.css";
import { TrackRow } from "./TrackRow";
import { REORDER_DROP_TARGET } from "./trackTargets";

const ROW_HEIGHT = 46;
const COMPACT_ROW_HEIGHT = 34;
const GROUP_PADDING = 28;
const GROUP_CAPTION = 56;
const DISC_HEADING = 40;
const COMPACT_HEADER = ALBUM_COVER_COMPACT + 34;

const isWhollyVisible = (row: DOMRect, view: DOMRect) =>
	row.top >= view.top && row.bottom <= view.bottom;

const ancestorsUpTo = (
	element: HTMLElement,
	stop: HTMLElement,
): HTMLElement[] =>
	element.parentElement && element.parentElement !== stop
		? [element.parentElement, ...ancestorsUpTo(element.parentElement, stop)]
		: [];

const estimateGroupHeight = (group: AlbumRun, isCompactViewport: boolean) => {
	const tracks =
		group.count * COMPACT_ROW_HEIGHT +
		(group.discs?.length ?? 0) * DISC_HEADING;
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
	groups: AlbumRun[];
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

	const discPrefixed = useMemo(
		() => (isAlbumLayout ? null : multiDiscRows(groups, rows.length)),
		[isAlbumLayout, groups, rows.length],
	);

	const coverRows = useMemo(
		() =>
			isAlbumLayout || !showArtwork
				? null
				: albumCoverRows(groups, rows.length),
		[isAlbumLayout, showArtwork, groups, rows.length],
	);

	// To the album run's opening row first, then through the refs: the other order looks up a
	// playlist index in a table of row positions.
	const coverIndexOf = (position: number) =>
		rows.ref(coverRows ? coverRows[position] : position);

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
		return () => {
			observer.disconnect();
			scroller.removeAttribute("data-drop-scroller");
		};
	}, [scrollRef]);

	const virtualizer = useVirtualizer({
		scrollMargin,
		count: isAlbumLayout ? groups.length : rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) =>
			isAlbumLayout
				? estimateGroupHeight(groups[index], isCompactViewport)
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
	});

	const cancelScroll = useRef<(() => void) | null>(null);

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
				const target = isAlbumLayout
					? groups.findIndex((entry) => index < entry.start + entry.count)
					: index;
				if (target < 0) return;

				const element = scrollRef.current;
				if (!element) return;

				const rowRect = () =>
					element
						.querySelector(`[data-row="${index}"]`)
						?.getBoundingClientRect() ?? null;

				if (ifNeeded) {
					const seen = rowRect();
					if (seen && isWhollyVisible(seen, element.getBoundingClientRect()))
						return;
				}
				cancelScroll.current?.();
				cancelScroll.current = null;

				const centreOnRow = () => {
					const seen = rowRect();
					if (!seen) return null;
					const view = element.getBoundingClientRect();
					return (
						element.scrollTop +
						(seen.top + seen.bottom) / 2 -
						(view.top + view.bottom) / 2
					);
				};

				const offsetFor = () =>
					(align === "center" ? centreOnRow() : null) ??
					virtualizer.getOffsetForIndex(target, align)?.[0] ??
					null;

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
		}),
		[isAlbumLayout, groups, virtualizer, scrollRef],
	);

	useEffect(() => () => cancelScroll.current?.(), []);

	const remeasure = useEffectEvent(() => virtualizer.measure());

	// biome-ignore lint/correctness/useExhaustiveDependencies: the switches fire the effect rather than being read in it -- row 4 in list mode is not album 4, so every cached height is invalid across either
	useEffect(() => {
		remeasure();
	}, [isAlbumLayout, isCompactViewport]);

	const virtualItems = virtualizer.getVirtualItems();

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
			style={{ height: virtualizer.getTotalSize() }}
			role="grid"
			aria-rowcount={rows.length}
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
						transform: `translateY(${virtualRow.start - scrollMargin}px)`,
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
						/>
					) : (
						<TrackRow
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
							isMatch={matches?.has(virtualRow.index) ?? false}
							showDisc={discPrefixed?.[virtualRow.index] === 1}
							onSelect={onSelect}
							onGripPointerDown={gripProps?.onPointerDown}
						/>
					)}
				</div>
			))}
		</div>
	);
}
