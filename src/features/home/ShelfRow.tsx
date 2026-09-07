import { ChevronRight } from "lucide-react";
import type { CoveredAlbum } from "@/domain/track/albums";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import type { FilledShelf } from "./shelves";

export function ShelfRow({
	shelf,
	onPlayAlbum,
}: {
	shelf: FilledShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	const t = useTranslate();
	return (
		<section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
			<header className={styles.header}>
				<h2 className={styles.title} id={`shelf-${shelf.id}`}>
					<a className={styles.open} href={`#/shelf/${shelf.id}`}>
						{t(shelf.title)}
						<ChevronRight
							className={styles.chevron}
							size={16}
							strokeWidth={2.5}
							aria-hidden="true"
						/>
					</a>
				</h2>
				<p className={styles.blurb}>{t(shelf.blurb)}</p>
			</header>

			<ShelfScroller shelf={shelf} onPlayAlbum={onPlayAlbum} />
		</section>
	);
}
