import { ChevronRight } from "lucide-react";
import type { CoveredAlbum } from "@/domain/track/albums";
import { useStoredState } from "@/shared/hooks/useStoredState";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import tabs from "./ShelfTabs.module.css";
import type { FilledShelf } from "./shelves";

export function ShelfTabs({
	shelves,
	onPlayAlbum,
}: {
	shelves: FilledShelf<CoveredAlbum>[];
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
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
