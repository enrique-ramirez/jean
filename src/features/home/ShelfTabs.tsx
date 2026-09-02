import { ChevronRight } from "lucide-react";
import { useStoredState } from "@/shared/hooks/useStoredState";
import type { CoveredAlbum } from "./albums";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import tabs from "./ShelfTabs.module.css";
import type { FilledShelf } from "./shelves";

// Every shelf that is not Recently played, in one row instead of five.
//
// Reference pass: taken from Ultra Sound's Explore panel -- a section heading
// with a strip of tabs under it and one carousel below that. The strip itself is
// Jean's own, lifted from the now-playing panel's Lyrics/Details/Artist tabs, so
// the app has one tab control rather than two that nearly match. Rejected the
// pill-shaped segmented control in `shared/ui`: that is for two or three options
// that are *settings*, and six shelf titles in pills is a second navigation bar.
// Rejected collapsing Recently played in with the others, which would put the
// whole library behind a control you have to notice first.
//
// **The heading is the link, and what it opens follows the tab.** The plain row
// beside this one puts the chevron on its own title; here the titles are the
// switch, so the chevron rides "Explore" and opens whichever shelf is showing.
// Still no "Show all" parked at the right of the strip -- the shape this project
// has the most to lose by copying.
//
// No blurbs. One sentence of grey under a title that is already a whole phrase
// -- "Remember these?", "Time for an upgrade" -- is explaining a joke.
export function ShelfTabs({
	shelves,
	onPlayAlbum,
}: {
	shelves: FilledShelf<CoveredAlbum>[];
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	// Remembered, because which of these somebody cares about is a preference
	// rather than a session. Validated against what actually filled: a library
	// that has stopped qualifying for the stored shelf falls back to the first
	// rather than rendering nothing.
	const [chosen, choose] = useStoredState<string | null>(
		"jean.homeShelf",
		null,
	);
	const active =
		shelves.find((shelf) => shelf.id === chosen) ?? shelves[0] ?? null;

	if (!active) return null;

	return (
		<section className={styles.shelf} aria-labelledby="home-explore">
			<header className={tabs.header}>
				<h2 className={tabs.heading} id="home-explore">
					<a className={styles.open} href={`#/shelf/${active.id}`}>
						Explore
						<ChevronRight
							className={styles.chevron}
							size={16}
							strokeWidth={2.5}
							aria-hidden="true"
						/>
					</a>
				</h2>

				<nav className={tabs.strip} aria-label="Shelves">
					{shelves.map((shelf) => (
						<button
							key={shelf.id}
							type="button"
							className={tabs.tab}
							aria-current={shelf.id === active.id}
							data-active={shelf.id === active.id}
							onClick={() => choose(shelf.id)}
						>
							{shelf.title}
						</button>
					))}
				</nav>
			</header>

			<ShelfScroller shelf={active} onPlayAlbum={onPlayAlbum} />
		</section>
	);
}
