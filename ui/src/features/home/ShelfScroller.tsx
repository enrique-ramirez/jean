import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CoveredAlbum } from "@/domain/track/albums";
import { usePrefersReducedMotion } from "@/shared/hooks/useMediaQuery";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { AlbumCard } from "./AlbumCard";
import styles from "./ShelfRow.module.css";
import type { FilledShelf } from "./shelves";

export function ShelfScroller({
	shelf,
	onPlayAlbum,
}: {
	shelf: FilledShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	const t = useTranslate();
	const format = useFormats();
	const reducesMotion = usePrefersReducedMotion();
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: the shelf changing is what resets it
	useEffect(() => {
		scrollerRef.current?.scrollTo({ left: 0 });
	}, [shelf.id]);

	const page = (direction: number) => {
		const element = scrollerRef.current;
		if (!element) return;
		element.scrollBy({
			left: direction * (element.clientWidth * 0.85),
			behavior: reducesMotion ? "instant" : "smooth",
		});
	};

	return (
		<div className={styles.rail}>
			<button
				type="button"
				className={`${styles.arrow} ${styles.back}`}
				aria-label={t("home.scrollBack", { shelf: t(shelf.title) })}
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
						caption={shelf.caption(album, t, format.locale)}
						onPlay={() => onPlayAlbum(shelf, album)}
					/>
				))}
			</div>

			<button
				type="button"
				className={`${styles.arrow} ${styles.forward}`}
				aria-label={t("home.scrollForward", { shelf: t(shelf.title) })}
				disabled={!more.end}
				onClick={() => page(1)}
			>
				<ChevronRight size={17} strokeWidth={2.5} />
			</button>
		</div>
	);
}
