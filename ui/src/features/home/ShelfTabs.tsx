import { ChevronRight } from "lucide-react";
import { href, shelfRoute } from "@/domain/track/routes";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { BusyNote, busyProps } from "@/shared/ui/Skeleton";
import type { CoveredAlbum } from "./cover";
import styles from "./ShelfRow.module.css";
import { ShelfScroller } from "./ShelfScroller";
import tabs from "./ShelfTabs.module.css";
import type { DrawnShelf } from "./shelves";

export function ShelfTabs({
	shelves,
	onPlayAlbum,
}: {
	shelves: DrawnShelf<CoveredAlbum>[];
	onPlayAlbum: (shelf: DrawnShelf<CoveredAlbum>, album: CoveredAlbum) => void;
}) {
	const t = useTranslate();
	const [chosen, choose] = useStoredState<string | null>(
		"jean.homeShelf",
		null,
	);
	const active =
		shelves.find((shelf) => shelf.id === chosen) ?? shelves[0] ?? null;

	if (!active) return null;

	return (
		<section
			className={styles.shelf}
			aria-labelledby="home-explore"
			{...busyProps(active.isPending)}
		>
			<header className={tabs.header}>
				<h2 className={tabs.heading} id="home-explore">
					<a className={styles.open} href={href(shelfRoute(active.id))}>
						{t("home.explore")}
						<ChevronRight
							className={styles.chevron}
							size={16}
							strokeWidth={2.5}
							aria-hidden="true"
						/>
					</a>
				</h2>

				<nav className={tabs.strip} aria-label={t("home.shelves")}>
					{shelves.map((shelf) => (
						<button
							key={shelf.id}
							type="button"
							className={tabs.tab}
							aria-current={shelf.id === active.id}
							data-active={shelf.id === active.id}
							onClick={() => choose(shelf.id)}
						>
							{t(shelf.title)}
						</button>
					))}
				</nav>
				{active.isPending ? <BusyNote /> : null}
			</header>

			<ShelfScroller shelf={active} onPlayAlbum={onPlayAlbum} />
		</section>
	);
}
