import { ChevronRight } from "lucide-react";
import { href, shelfRoute } from "@/domain/track/routes";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { BusyNote, busyProps } from "@/shared/ui/Skeleton";
import type { CoveredAlbum } from "./cover";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import type { DrawnShelf } from "./shelves";

export function ShelfRow({
	shelf,
	onPlayAlbum,
}: {
	shelf: DrawnShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: DrawnShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	const t = useTranslate();
	return (
		<section
			className={styles.shelf}
			aria-labelledby={`shelf-${shelf.id}`}
			{...busyProps(shelf.isPending)}
		>
			<header className={styles.header}>
				<h2 className={styles.title} id={`shelf-${shelf.id}`}>
					<a className={styles.open} href={href(shelfRoute(shelf.id))}>
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
				{shelf.isPending ? <BusyNote /> : null}
			</header>

			<ShelfScroller shelf={shelf} onPlayAlbum={onPlayAlbum} />
		</section>
	);
}
