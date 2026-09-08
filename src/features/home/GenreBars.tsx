import { ChevronRight } from "lucide-react";
import { GENRES_HREF, genreHref } from "@/domain/library/genreRoute";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./GenreBars.module.css";

export interface GenreBar {
	name: string;
	count: number;
	share: number;
}

export function GenreBars({ genres }: { genres: GenreBar[] }) {
	const t = useTranslate();
	const format = useFormats();
	const largest = genres.reduce(
		(most, genre) => Math.max(most, genre.count),
		0,
	);
	if (genres.length === 0 || largest === 0) return null;

	return (
		<section className={styles.block} aria-labelledby="home-genres">
			<h2 className={styles.heading} id="home-genres">
				<a className={styles.open} href={GENRES_HREF}>
					{t("home.genres")}
					<ChevronRight
						className={styles.chevron}
						size={16}
						strokeWidth={2.5}
						aria-hidden="true"
					/>
				</a>
			</h2>

			<ul className={styles.bars}>
				{genres.map((genre) => (
					<li key={genre.name}>
						<a
							className={styles.bar}
							href={genreHref(genre.name)}
							title={t("home.genreShare", {
								count: genre.count,
								share: genre.share,
							})}
						>
							<span className={styles.name}>{genre.name}</span>
							<span className={styles.track}>
								<span
									className={styles.fill}
									style={{ width: `${(genre.count / largest) * 100}%` }}
								/>
							</span>
							<span className={styles.count}>{format.number(genre.count)}</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}
