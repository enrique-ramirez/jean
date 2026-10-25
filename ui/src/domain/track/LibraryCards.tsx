import { type ReactNode, useId } from "react";
import type { ArtistCards } from "@/shared/api/libraryQuestions";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { Chip } from "@/shared/ui/Chip";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import styles from "./LibraryCards.module.css";
import { genreRoute, href } from "./routes";

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
	cards,
	trackCount,
	hasPlayCounts,
	isOverdue,
}: {
	cards: ArtistCards | null;
	trackCount: number;
	hasPlayCounts: boolean;
	isOverdue: boolean;
}) {
	const t = useTranslate();
	const format = useFormats();
	const headingId = useId();

	const showsGenres = cards === null || cards.topGenres.length > 0;
	const showsMostPlayed =
		hasPlayCounts && (cards === null || cards.mostPlayed !== null);
	if (cards !== null && trackCount === 0) return null;
	if (!hasPlayCounts && !showsGenres) return null;

	return (
		<section
			className={styles.cards}
			data-library-cards=""
			aria-labelledby={headingId}
			{...busyProps(cards === null)}
		>
			<h2 className={styles.heading} id={headingId}>
				{t("cards.title")}
			</h2>
			{cards === null && isOverdue ? <BusyNote /> : null}

			<div className={styles.row}>
				{hasPlayCounts ? (
					<Card name="played" label={t("cards.played")}>
						{cards === null ? (
							<Pending hasMeter />
						) : (
							<>
								<span className={styles.value}>
									{format.number(Math.round(cards.playedShare * 100) / 100, {
										style: "percent",
									})}
								</span>
								<span className={styles.line}>
									{t("artist.someOf", {
										some: trackCount - cards.neverPlayed,
										all: trackCount,
									})}
								</span>
								<span className={styles.line}>
									{t("cards.neverPlayed", { count: cards.neverPlayed })}
								</span>
								<div className={styles.meter}>
									<div
										className={styles.meterFill}
										style={{ transform: `scaleX(${cards.playedShare})` }}
									/>
								</div>
							</>
						)}
					</Card>
				) : null}

				{hasPlayCounts ? (
					<Card name="plays" label={t("details.plays")}>
						{cards === null ? (
							<Pending />
						) : (
							<>
								<span className={styles.value}>
									{format.number(cards.plays)}
								</span>
								{cards.lastPlayed !== null ? (
									<span className={styles.line}>
										{t("cards.lastListened", {
											date: format.date(cards.lastPlayed, DATE_PARTS),
										})}
									</span>
								) : null}
							</>
						)}
					</Card>
				) : null}

				{showsMostPlayed ? (
					<Card name="most-played" label={t("cards.mostPlayed")}>
						{cards === null || cards.mostPlayed === null ? (
							<Pending />
						) : (
							<>
								<span className={`${styles.value} ${styles.title}`}>
									{cards.mostPlayed.title || t("track.unknownTitle")}
								</span>
								<span className={styles.line}>
									{t("shelf.plays", { count: cards.mostPlayed.plays })}
								</span>
							</>
						)}
					</Card>
				) : null}

				{showsGenres ? (
					<Card name="genres" label={t("cards.genres")}>
						{cards === null ? (
							<Pending />
						) : (
							<div className={styles.chips}>
								{cards.topGenres.map((genre) => (
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
