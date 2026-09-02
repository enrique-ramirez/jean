import styles from "./GenreBars.module.css";

export interface GenreBar {
	name: string;
	count: number;
	share: number;
}

// The one chart Jean can draw honestly.
//
// Reference pass: GrooveGraph's Top Genres block, which is the element that made
// that shot worth stealing from -- a distribution rather than a time series, so
// it needs no listening history, which is exactly what this player cannot
// supply. (`%lastfm_last_played%` records only the most recent play, so a
// plays-per-day chart would undercount every older day and slope upward whatever
// anybody actually did. It is not built, and it is not going to be.)
//
// Two deviations from the reference, both forced by real data. Its bars are
// vertical with the name in a pill on top, which breaks on `Rock En Español` and
// `Video Game Music`; horizontal bars give a long tag a whole line and read the
// same on a phone as on a desktop. And its bars are scaled against the largest
// rather than against the whole: measured on a 30,441-track library the top
// genre is 9% and the fourth is 6%, so four bars drawn as a share of the library
// are four slivers of identical length. The bar carries the *relative* size and
// the figure beside it carries the absolute one.
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
						{/* A route, so an anchor: cmd- and middle-click open it in a tab.
                It used to run a search, which was quietly broken -- the search
                index covers title, artist and album and **not genre**, so
                clicking "Indie Rock" looked for tracks with those words in
                their names and found almost none of them.

                The prefix is written out rather than imported from `app/routes`,
                which parses the other half: a feature reaching up into the shell
                is the wrong direction, and it is the same call `ShelfRow` makes
                with `#/shelf/`. */}
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
