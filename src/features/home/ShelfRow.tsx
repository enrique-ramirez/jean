import { ChevronRight } from "lucide-react";
import type { CoveredAlbum } from "./albums";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import type { FilledShelf } from "./shelves";

// One shelf, drawn under its own name. The tabbed row beside it holds the rest;
// this is for the one shelf worth finding by scrolling rather than by looking.
export function ShelfRow({
	shelf,
	onPlayAlbum,
}: {
	shelf: FilledShelf<CoveredAlbum>;
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	return (
		<section className={styles.shelf} aria-labelledby={`shelf-${shelf.id}`}>
			{/* The heading opens the shelf, and only the heading: the blurb under it
          is a sentence explaining why these records are here, and a sentence
          that navigates when you brush it is a trap.

          Reference pass -- two shapes exist for this. Apple Music and Disney+
          make the title itself the target and hang a chevron off the end of the
          words; Spotify and Apple TV put a separate "Show all" at the far right
          of the row. Taken from the first: the chevron belongs to the title, so
          it travels with the text instead of floating in dead space a hundred
          pixels away, and it points at the row it opens. Rejected the second on
          two counts -- it is the shape Jean has the most to lose by copying,
          and it promises "all of them" when this opens the same albums that are
          already on screen, as tracks.

          An anchor rather than a button, because it is nothing but a
          destination: routing is the hash, so this needs no JavaScript at all
          and cmd- or middle-click opens it in a tab, which no button can do. */}
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
