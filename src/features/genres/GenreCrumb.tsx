import { ChevronLeft } from "lucide-react";

import { GENRES_HREF } from "@/domain/library/genreRoute";
import styles from "./GenreCrumb.module.css";

export function GenreCrumb() {
	return (
		<a className={styles.crumb} href={GENRES_HREF}>
			<ChevronLeft
				className={styles.chevron}
				size={13}
				strokeWidth={2.5}
				aria-hidden="true"
			/>
			All genres
		</a>
	);
}
