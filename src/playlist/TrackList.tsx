import { useVirtualizer } from "@tanstack/react-virtual";
import {
	forwardRef,
	type Ref,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { animateScrollTo } from "../ui/animateScroll";
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

const ROW_HEIGHT = 46;
const COMPACT_ROW_HEIGHT = 34;
const GROUP_PADDING = 28;
const GROUP_CAPTION = 56;
const DISC_HEADING = 40;
const COMPACT_HEADER = ALBUM_COVER_COMPACT + 34;

const ancestorsUpTo = (
	element: HTMLElement,
	stop: HTMLElement,
): HTMLElement[] =>
	element.parentElement && element.parentElement !== stop
		? [element.parentElement, ...ancestorsUpTo(element.parentElement, stop)]
		: [];

// Album groups are measured, not computed. Their height depends on how the
// caption wraps and which breakpoint is active, and getting that arithmetic
// wrong leaves visible gaps between groups -- so this is only the first guess
// the virtualiser uses before it measures the real thing.
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

export const TrackList = forwardRef(function TrackList(
	{
		rows,
		groups,
		indices,
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
		isCompactViewport,
	}: TrackRenderProps & {
		groups: AlbumRun[];
		scrollRef: RefObject<HTMLElement | null>;
		layout: string;
		albumTemplate: string;
		showArtwork: boolean;
		showHeat: boolean;
		onActiveDirectionChange?: (direction: ActiveDirection) => void;
	},
	ref: Ref<TrackListHandle>,
) {
	const isAlbumLayout = layout === "album";

	// The list draws no group headings, so a multi-disc album has to say so in
	// the track numbers instead -- one byte per row, filled from the same runs
	// the album layout draws.
	const discPrefixed = useMemo(
		() => (isAlbumLayout ? null : multiDiscRows(groups, rows.length)),
		[isAlbumLayout, groups, rows.length],
	);

	// Off the same runs, and only where rows draw their own covers. The album
	// layout asks `AlbumGroup` for one cover per group and never gets here.
	const coverRows = useMemo(
		() =>
			isAlbumLayout || !showArtwork
				? null
				: albumCoverRows(groups, rows.length),
		[isAlbumLayout, showArtwork, groups, rows.length],
	);

	// A row position becomes the ref the source addresses that cover by: first to
	// the album run's opening row, then through `indices`, because a filtered view
	// renumbers everything. Doing it in the other order would look up a playlist
	// index in a table of row positions.
	const coverIndexOf = (position: number) => {
		const row = coverRows ? coverRows[position] : position;
		return indices ? indices[row] : row;
	};

	// How far down the scroll container the list actually begins. The view header
	// and the toolbar sit above it, so row 0 is not at scroll offset 0 -- and
	// without telling the virtualiser that, every scrollToIndex lands short by
	// exactly this much. Rendering still looked right, because the rows are
	// positioned inside a list that is itself in normal flow; only the scroll
	// arithmetic was wrong, which is why it read as "jump to playing is a bit
	// off" rather than as anything obviously broken. On a short viewport that
	// same error is the whole distance, so the track never came into view at all.
	const listElement = useRef<HTMLDivElement | null>(null);
	const [scrollMargin, setScrollMargin] = useState(0);

	useLayoutEffect(() => {
		const list = listElement.current;
		const scroller = scrollRef.current;
		if (!list || !scroller) return undefined;

		const measure = () => {
			// Rounded so that `start - scrollMargin` stays the whole number it was
			// before this existed. A fractional margin would otherwise leak into
			// every row's transform, and sub-pixel churn would re-render the list
			// for nothing.
			const next = Math.round(
				list.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top +
					scroller.scrollTop,
			);
			setScrollMargin((current) => (current === next ? current : next));
		};

		measure();

		// The header is what moves the list, and the only boxes that grow when it
		// does are the list's own ancestors -- so observing the chain up to the
		// scroller catches a wrapping title, the stats appearing once rows load,
		// the finder opening, and the loading bar, without knowing about any of
		// them. `.rows` is display:contents and generates no box, so observing it
		// costs nothing and reports nothing.
		const observer = new ResizeObserver(measure);
		for (const node of [scroller, ...ancestorsUpTo(list, scroller)])
			observer.observe(node);
		return () => observer.disconnect();
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
		// Measurements are cached by *item key*, and the default key is the index --
		// so group 0 of one search inherits the height of group 0 of the last one,
		// which left the first album of a search overlapping the second. It stayed
		// wrong, too: measureElement reports on mount and on resize, and a group
		// that was already there did neither. Keying by the album makes a new result
		// set new items, measured when they mount. `measure()` below covers the case
		// this cannot -- see there.
		getItemKey: isAlbumLayout
			? (index) => groups[index]?.key ?? index
			: undefined,
		// Compact rows are genuinely a fixed height, so they skip measurement
		// entirely and cost nothing per row.
		measureElement: isAlbumLayout
			? (element) => element.getBoundingClientRect().height
			: undefined,
	});

	// The parent drives scrolling by track index; in album mode that has to be
	// translated into the group holding it.
	const cancelScroll = useRef<(() => void) | null>(null);

	useImperativeHandle(
		ref,
		() => ({
			scrollToTrack(
				index: number,
				{ animate = false, align = "center" }: ScrollToTrackOptions = {},
			) {
				cancelScroll.current?.();
				cancelScroll.current = null;

				const target = isAlbumLayout
					? groups.findIndex((entry) => index < entry.start + entry.count)
					: index;
				if (target < 0) return;

				const element = scrollRef.current;
				if (!element) return;

				// Centring is measured off the row, not computed from the index. In
				// album mode the virtualiser's items are groups, so asking it to centre
				// gets the *album* centred and the track left wherever it falls inside
				// it -- off screen entirely once an album is longer than the window. In
				// list mode a row and its index are the same thing, so the two agree and
				// this is one path rather than a special case.
				//
				// Null until the row is mounted, which is what the fallback is for: the
				// first frames aim at the group, that brings the row into existence, and
				// the target refines to the track. It converges rather than oscillating,
				// because the offset is absolute.
				const centreOnRow = () => {
					const row = element.querySelector(`[data-row="${index}"]`);
					if (!row) return null;
					const seen = row.getBoundingClientRect();
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
					// The row exists now even if it did not a moment ago, so a second
					// pass puts the track where the group just went.
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

	// The other trap, and the one `getItemKey` cannot fix: *the same data in a
	// different shape*. Row 4 in list mode is not album 4, and a compact group is
	// not a wide one, so the cached heights are meaningless across either switch.
	// `measure()` is wrong for new data at the same index -- it runs after the
	// refs have measured the new elements and throws those measurements away.
	const virtualizerRef = useRef(virtualizer);
	virtualizerRef.current = virtualizer;

	// biome-ignore lint/correctness/useExhaustiveDependencies: both switches invalidate cached heights, see above
	useEffect(() => {
		virtualizerRef.current.measure();
	}, [isAlbumLayout, isCompactViewport]);

	const virtualItems = virtualizer.getVirtualItems();

	// Where the playing track sits relative to the viewport. Rendered is not the
	// same as visible -- overscan mounts rows beyond the fold, and an album group
	// is tall enough that its rows can be mounted well below the screen -- so a
	// row that exists is measured against the scroll container, and only one that
	// is absent entirely has its direction decided by the index range.
	const reported = useRef<ActiveDirection | undefined>(undefined);

	useEffect(() => {
		const next = (() => {
			if (activeIndex < 0) return null;

			const scroller = scrollRef.current;
			if (!scroller) return null;

			const row = scroller.querySelector('[data-active="true"]');
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
		// Not a <table>: the rows are absolutely positioned by the virtualiser,
		// which table layout cannot express.
		// biome-ignore lint/a11y/useSemanticElements: virtualised, see above
		<div
			ref={listElement}
			className={showHeat ? styles.list : `${styles.list} heat-off`}
			style={{ height: virtualizer.getTotalSize() }}
			role="grid"
			aria-rowcount={rows.length}
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
							indices={indices}
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
							row={rows[virtualRow.index]}
							index={virtualRow.index}
							itemIndex={indices ? indices[virtualRow.index] : virtualRow.index}
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
						/>
					)}
				</div>
			))}
		</div>
	);
});
