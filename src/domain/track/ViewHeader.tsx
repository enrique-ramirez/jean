import type { ReactNode } from "react";
import { genreHref } from "@/domain/library/genreRoute";
import { pluralise } from "@/shared/lib/text";
import { Chip } from "@/shared/ui/Chip";
import { formatDuration, type TrackStats } from "./stats";
import styles from "./ViewHeader.module.css";

function PlayedMeter({ share }: { share: number }) {
	return (
		<div className={styles.meter}>
			<div className={styles.meterTrack}>
				<div
					className={styles.meterFill}
					style={{ transform: `scaleX(${share})` }}
				/>
			</div>
			<span>{Math.round(share * 100)}% played</span>
		</div>
	);
}

// One header for anything that is a list of tracks: a playlist, a shelf or a set of search results.
export function ViewHeader({
	eyebrow,
	title,
	stats,
	hasPlayCounts,
	actions,
	aside,
	/** Where the chips end, on a view whose genres are the whole library's. See below. */
	allGenresHref,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	stats: TrackStats;
	hasPlayCounts?: boolean;
	actions?: ReactNode;
	aside?: ReactNode;
	allGenresHref?: string;
}) {
	const duration = formatDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest
			? stats.earliest === stats.latest
				? `${stats.earliest}`
				: `${stats.earliest}-${stats.latest}`
			: null;

	return (
		// Three grid areas rather than one column, so on a narrow viewport the naming can sit beside the mosaic while the rest stays full width.
		<header className={styles.header}>
			<div className={styles.naming}>
				<p className={styles.eyebrow}>{eyebrow}</p>
				<h1 className={styles.title}>{title}</h1>
			</div>

			{aside ? <div className={styles.aside}>{aside}</div> : null}

			<div className={styles.meta}>
				<div className={styles.stats}>
					<span>
						<b>{stats.trackCount.toLocaleString()}</b>{" "}
						{pluralise(stats.trackCount, "track")}
					</span>
					{duration ? (
						<>
							<span className={styles.separator}>·</span>
							<span>{duration}</span>
						</>
					) : null}
					{span ? (
						<>
							<span className={styles.separator}>·</span>
							<span>{span}</span>
						</>
					) : null}
					{hasPlayCounts ? <PlayedMeter share={stats.playedShare} /> : null}
				</div>

				{/* Every chip opens its genre: the share is what this list is made of, and the tag is where
				    the rest of it lives. On a playlist that is a change of scope -- 34% of these tracks,
				    then all 2,667 in the library -- and the destination's own header says `Genre` first,
				    which is what keeps the jump legible on arrival.
				    The last chip is the way out to the index, and it is drawn only where the count beside
				    it and the page behind it are the same set. On a playlist they are not: the header
				    would say 23 and the index would list 141. */}
				{stats.topGenres.length > 0 ? (
					<div className={styles.chips}>
						{stats.topGenres.map((genre) => (
							<Chip
								key={genre.name}
								label={genre.name}
								value={`${genre.share}%`}
								href={genreHref(genre.name)}
							/>
						))}

						{allGenresHref && stats.genreCount > stats.topGenres.length ? (
							<Chip
								className={styles.wayOut}
								label="All genres"
								value={stats.genreCount.toLocaleString()}
								href={allGenresHref}
								title="Every genre in your library"
							/>
						) : null}
					</div>
				) : null}

				<div className={styles.actions}>{actions}</div>
			</div>
		</header>
	);
}
