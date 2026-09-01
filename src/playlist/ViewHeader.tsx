import type { ReactNode } from "react";

import { Chip } from "../ui/Chip";
import { pluralise } from "../ui/text";
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

// One header for anything that is a list of tracks. A playlist and a set of
// search results differ in where they came from, not in what is worth saying
// about them -- how many tracks, how long, which years, what it is made of.
export function ViewHeader({
	eyebrow,
	title,
	stats,
	hasPlayCounts,
	actions,
	aside,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	stats: TrackStats;
	hasPlayCounts?: boolean;
	actions?: ReactNode;
	aside?: ReactNode;
}) {
	const duration = formatDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest
			? stats.earliest === stats.latest
				? `${stats.earliest}`
				: `${stats.earliest}-${stats.latest}`
			: null;

	return (
		// Three grid areas rather than one column beside the mosaic. On a wide
		// screen they stack into that same column, but on a phone the naming can
		// move up alongside the mosaic while the rest stays full width -- which is
		// the whole point: stacked, the mosaic owned a row and left the space next
		// to it empty, and the header ran to six separate bands before a track.
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

				{stats.topGenres.length > 0 ? (
					<div className={styles.chips}>
						{stats.topGenres.map((genre) => (
							<Chip
								key={genre.name}
								label={genre.name}
								value={`${genre.share}%`}
							/>
						))}
					</div>
				) : null}

				<div className={styles.actions}>{actions}</div>
			</div>
		</header>
	);
}
