import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlbumCard } from "./AlbumCard";
import type { CoveredAlbum } from "./albums";
import styles from "./ShelfRow.module.css";
import type { FilledShelf } from "./shelves";

// A shelf is a horizontal scroller, not a carousel. The distinction is the
// point: a carousel shows one thing and hides the rest behind an animation,
// which is lovely for eight albums and useless for a library. A scroller shows
// six at a time and is a native scroll -- so it flicks on a phone,
// shift-wheels on a desktop, and costs nothing.
//
// Split out from `ShelfRow` when the tabbed row arrived: the two differ in what
// sits above the covers and in nothing below them, and a second copy of the
// arrow measuring is a second place for it to go wrong. Its stylesheet stays
// `ShelfRow.module.css`, because `.shelf:hover .arrow` reaches across the two --
// the arrows appear on the section, which is the parent's element.
export function ShelfScroller({
	shelf,
	onPlayAlbum,
}: {
	shelf: FilledShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const [more, setMore] = useState({ start: false, end: false });

	const measure = useCallback(() => {
		const element = scrollerRef.current;
		if (!element) return;
		const max = element.scrollWidth - element.clientWidth;
		setMore({
			start: element.scrollLeft > 8,
			end: element.scrollLeft < max - 8,
		});
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: new albums are a new scroll extent to measure
	useEffect(() => {
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [measure, shelf.albums]);

	// Switching tabs is a different row of covers in the same box, so the old
	// scroll offset would leave the new shelf opening halfway along itself.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the shelf changing is what resets it
	useEffect(() => {
		scrollerRef.current?.scrollTo({ left: 0 });
	}, [shelf.id]);

	// A page is whatever is currently visible, less a little overlap so nothing
	// is skipped over between presses.
	const page = (direction: number) => {
		const element = scrollerRef.current;
		if (!element) return;
		element.scrollBy({
			left: direction * (element.clientWidth * 0.85),
			behavior: "smooth",
		});
	};

	// The rail exists so the arrows have somewhere to sit that the scroller's own
	// overflow cannot clip, and so they can be centred on the artwork without
	// anyone measuring the heading above it.
	return (
		<div className={styles.rail}>
			<button
				type="button"
				className={`${styles.arrow} ${styles.back}`}
				aria-label={`Scroll ${shelf.title} back`}
				disabled={!more.start}
				onClick={() => page(-1)}
			>
				<ChevronLeft size={17} strokeWidth={2.5} />
			</button>

			<div
				className={styles.scroller}
				ref={scrollerRef}
				onScroll={measure}
				data-more-start={more.start}
				data-more-end={more.end}
			>
				{shelf.albums.map((album) => (
					<AlbumCard
						key={album.key}
						album={album}
						caption={shelf.caption(album)}
						onPlay={() => onPlayAlbum(shelf, album)}
					/>
				))}
			</div>

			<button
				type="button"
				className={`${styles.arrow} ${styles.forward}`}
				aria-label={`Scroll ${shelf.title} forward`}
				disabled={!more.end}
				onClick={() => page(1)}
			>
				<ChevronRight size={17} strokeWidth={2.5} />
			</button>
		</div>
	);
}
