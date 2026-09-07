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

export function ViewHeader({
	eyebrow,
	title,
	stats,
	hasPlayCounts,
	leading,
	tabs,
	actions,
	aside,
	allGenresHref,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	stats: TrackStats;
	hasPlayCounts?: boolean;
	leading?: ReactNode;
	tabs?: ReactNode;
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
		<header className={styles.header} data-tabs={tabs ? "true" : undefined}>
			<div className={styles.naming}>
				<p className={styles.eyebrow}>{eyebrow}</p>
				<h1 className={styles.title}>{title}</h1>
			</div>

			{aside ? <div className={styles.aside}>{aside}</div> : null}

			<div className={styles.meta}>
				<div className={styles.stats}>
					{leading ? (
						<>
							<span>{leading}</span>
							<span className={styles.separator}>·</span>
						</>
					) : null}
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

			{tabs ? <div className={styles.tabs}>{tabs}</div> : null}
		</header>
	);
}
