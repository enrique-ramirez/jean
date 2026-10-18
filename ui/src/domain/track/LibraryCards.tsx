import { type ReactNode, useId } from "react";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { Chip } from "@/shared/ui/Chip";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import { titleOf } from "./fields";
import styles from "./LibraryCards.module.css";
import type { TrackRows } from "./project";
import { genreRoute, href } from "./routes";
import type { TrackStats } from "./stats";

const DATE_PARTS = { year: "numeric", month: "long", day: "numeric" } as const;

function Card({
	name,
	label,
	children,
}: {
	name: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className={styles.card} data-card={name}>
			<span className={styles.label}>{label}</span>
			{children}
		</div>
	);
}

function Pending({ hasMeter = false }: { hasMeter?: boolean }) {
	return (
		<>
			<span className={styles.value}>
				<Skeleton width="4em" />
			</span>
			<span className={styles.line}>
				<Skeleton width="7em" />
			</span>
			{hasMeter ? (
				<>
					<span className={styles.line}>
						<Skeleton width="6em" />
					</span>
					<div className={styles.meter} />
				</>
			) : null}
		</>
	);
}

export function LibraryCards({
	stats,
	rows,
	hasPlayCounts,
	isOverdue,
}: {
	stats: TrackStats | null;
	rows: TrackRows;
	hasPlayCounts: boolean;
	isOverdue: boolean;
}) {
	const t = useTranslate();
	const format = useFormats();
	const headingId = useId();

	const showsGenres = stats === null || stats.topGenres.length > 0;
	const showsMostPlayed =
		hasPlayCounts && (stats === null || stats.mostPlayed !== null);
	if (stats !== null && stats.trackCount === 0) return null;
	if (!hasPlayCounts && !showsGenres) return null;

	return (
		<section
			className={styles.cards}
			data-library-cards=""
			aria-labelledby={headingId}
			{...busyProps(stats === null)}
		>
			<h2 className={styles.heading} id={headingId}>
				{t("cards.title")}
			</h2>
			{stats === null && isOverdue ? <BusyNote /> : null}

			<div className={styles.row}>
				{hasPlayCounts ? (
					<Card name="played" label={t("cards.played")}>
						{stats === null ? (
							<Pending hasMeter />
						) : (
							<>
								<span className={styles.value}>
									{format.number(Math.round(stats.playedShare * 100) / 100, {
										style: "percent",
									})}
								</span>
								<span className={styles.line}>
									{t("artist.someOf", {
										some: stats.trackCount - stats.unplayed,
										all: stats.trackCount,
									})}
								</span>
								<span className={styles.line}>
									{t("cards.neverPlayed", { count: stats.unplayed })}
								</span>
								<div className={styles.meter}>
									<div
										className={styles.meterFill}
										style={{ transform: `scaleX(${stats.playedShare})` }}
									/>
								</div>
							</>
						)}
					</Card>
				) : null}

				{hasPlayCounts ? (
					<Card name="plays" label={t("details.plays")}>
						{stats === null ? (
							<Pending />
						) : (
							<>
								<span className={styles.value}>
									{format.number(stats.plays)}
								</span>
								{stats.lastPlayed !== null ? (
									<span className={styles.line}>
										{t("cards.lastListened", {
											date: format.date(stats.lastPlayed, DATE_PARTS),
										})}
									</span>
								) : null}
							</>
						)}
					</Card>
				) : null}

				{showsMostPlayed ? (
					<Card name="most-played" label={t("cards.mostPlayed")}>
						{stats === null || stats.mostPlayed === null ? (
							<Pending />
						) : (
							<>
								<span className={`${styles.value} ${styles.title}`}>
									{titleOf(rows.at(stats.mostPlayed.position), t)}
								</span>
								<span className={styles.line}>
									{t("shelf.plays", { count: stats.mostPlayed.plays })}
								</span>
							</>
						)}
					</Card>
				) : null}

				{showsGenres ? (
					<Card name="genres" label={t("cards.genres")}>
						{stats === null ? (
							<Pending />
						) : (
							<div className={styles.chips}>
								{stats.topGenres.map((genre) => (
									<Chip
										key={genre.name}
										label={genre.name}
										value={format.number(genre.share / 100, {
											style: "percent",
										})}
										href={href(genreRoute(genre.name))}
									/>
								))}
							</div>
						)}
					</Card>
				) : null}
			</div>
		</section>
	);
}
