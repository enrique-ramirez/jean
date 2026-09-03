import styles from "./GenreBars.module.css";

export interface GenreBar {
	name: string;
	count: number;
	share: number;
}

// A distribution rather than a time series, because `%lastfm_last_played%` records only the most recent play and there is no history to plot.
// Bars are scaled against the largest genre rather than against the whole library, where the top few genres differ by a percentage point and would draw as identical slivers.
export function GenreBars({ genres }: { genres: GenreBar[] }) {
	const largest = genres.reduce(
		(most, genre) => Math.max(most, genre.count),
		0,
	);
	if (genres.length === 0 || largest === 0) return null;

	return (
		<section className={styles.block} aria-labelledby="home-genres">
			<h2 className={styles.heading} id="home-genres">
				Genres
			</h2>

			<ul className={styles.bars}>
				{genres.map((genre) => (
					<li key={genre.name}>
						{/* A route rather than a search: beefweb's search index covers title, artist and album and not genre. */}
						<a
							className={styles.bar}
							href={`#/genre/${encodeURIComponent(genre.name)}`}
							title={`${genre.count.toLocaleString()} tracks, ${genre.share}% of your library`}
						>
							<span className={styles.name}>{genre.name}</span>
							<span className={styles.track}>
								<span
									className={styles.fill}
									style={{ width: `${(genre.count / largest) * 100}%` }}
								/>
							</span>
							<span className={styles.count}>
								{genre.count.toLocaleString()}
							</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}
