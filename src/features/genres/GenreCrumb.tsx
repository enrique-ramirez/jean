import { ChevronLeft } from "lucide-react";

import { GENRES_HREF } from "@/domain/library/genreRoute";
import styles from "./GenreCrumb.module.css";

// Where the eyebrow goes on a genre view: the word `Genre` is a label, and this is the same word
// doing work. A chevron pointing *back*, not the forward one a shelf heading carries -- that one
// means "open this", and this means "return to where these are listed".
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
