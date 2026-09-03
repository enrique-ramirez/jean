import { ChevronRight } from "lucide-react";
import type { CoveredAlbum } from "./albums";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import type { FilledShelf } from "./shelves";

// One shelf, drawn under its own name. The tabbed row beside it holds the rest.
export function ShelfRow({
	shelf,
	onPlayAlbum,
}: {
	shelf: FilledShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	return (
		<section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
			{/* The heading opens the shelf and the blurb under it does not: a sentence that navigates when brushed is a trap.
          An anchor rather than a button, so cmd- and middle-click open it in a tab. */}
			<header className={styles.header}>
				<h2 className={styles.title} id={`shelf-${shelf.id}`}>
					<a className={styles.open} href={`#/shelf/${shelf.id}`}>
						{shelf.title}
						<ChevronRight
							className={styles.chevron}
							size={16}
							strokeWidth={2.5}
							aria-hidden="true"
						/>
					</a>
				</h2>
				<p className={styles.blurb}>{shelf.blurb}</p>
			</header>

			<ShelfScroller shelf={shelf} onPlayAlbum={onPlayAlbum} />
		</section>
	);
}
