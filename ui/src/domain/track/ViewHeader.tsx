import type { ReactNode } from "react";
import { Trans } from "@/shared/i18n/Trans";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { Chip } from "@/shared/ui/Chip";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import { genreRoute, href } from "./routes";
import { formatDuration, type TrackStats } from "./stats";
import styles from "./ViewHeader.module.css";

function PlayedMeter({ share }: { share: number }) {
	const t = useTranslate();

	return (
		<div className={styles.meter}>
			<div className={styles.meterTrack}>
				<div
					className={styles.meterFill}
					style={{ transform: `scaleX(${share})` }}
				/>
			</div>
			<span>{t("view.playedShare", { share: Math.round(share * 100) })}</span>
		</div>
	);
}

function Stats({
	stats,
	isPending,
	hasPlayCounts,
	leading,
	allGenresHref,
}: {
	stats: TrackStats | null;
	isPending: boolean;
	hasPlayCounts?: boolean;
	leading?: ReactNode;
	allGenresHref?: string;
}) {
	const t = useTranslate();
	const format = useFormats();

	if (stats === null)
		return (
			<div className={styles.stats} {...busyProps(isPending)}>
				<Skeleton width="16em" />
				{hasPlayCounts ? <Skeleton className={styles.meterPending} /> : null}
				{isPending ? <BusyNote /> : null}
			</div>
		);

	const duration = formatDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest
			? stats.earliest === stats.latest
				? `${stats.earliest}`
				: `${stats.earliest}-${stats.latest}`
			: null;

	return (
		<>
			<div className={styles.stats}>
				{leading ? (
					<>
						<span>{leading}</span>
						<span className={styles.separator}>·</span>
					</>
				) : null}
				<span>
					<Trans
						phrase="view.trackCount"
						count={stats.trackCount}
						total={<b>{format.number(stats.trackCount)}</b>}
					/>
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
							href={href(genreRoute(genre.name))}
						/>
					))}

					{allGenresHref && stats.genreCount > stats.topGenres.length ? (
						<Chip
							className={styles.wayOut}
							label={t("view.allGenres")}
							value={format.number(stats.genreCount)}
							href={allGenresHref}
							title={t("view.everyGenre")}
						/>
					) : null}
				</div>
			) : null}
		</>
	);
}

export function ViewHeader({
	eyebrow,
	title,
	stats,
	isStatsPending,
	hasPlayCounts,
	leading,
	tabs,
	actions,
	aside,
	allGenresHref,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	stats: TrackStats | null;
	isStatsPending: boolean;
	hasPlayCounts?: boolean;
	leading?: ReactNode;
	tabs?: ReactNode;
	actions?: ReactNode;
	aside?: ReactNode;
	allGenresHref?: string;
}) {
	return (
		<header className={styles.header} data-tabs={tabs ? "true" : undefined}>
			<div className={styles.naming}>
				<p className={styles.eyebrow}>{eyebrow}</p>
				<h1 className={styles.title}>{title}</h1>
			</div>

			{aside ? <div className={styles.aside}>{aside}</div> : null}

			<div className={styles.meta}>
				<Stats
					stats={stats}
					isPending={isStatsPending}
					hasPlayCounts={hasPlayCounts}
					leading={leading}
					allGenresHref={allGenresHref}
				/>

				<div className={styles.actions}>{actions}</div>
			</div>

			{tabs ? <div className={styles.tabs}>{tabs}</div> : null}
		</header>
	);
}
