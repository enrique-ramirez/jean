import type { ReactNode } from "react";
import { Trans } from "@/shared/i18n/Trans";
import { useFormats } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import { HeaderBackdrop } from "./HeaderBackdrop";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { formatDuration, type HeaderStats } from "./stats";
import { useCoverPicks } from "./useCoverPicks";
import styles from "./ViewHeader.module.css";

function Figures({
	stats,
	isPending,
	albumCount,
}: {
	stats: HeaderStats | null;
	isPending: boolean;
	albumCount: number | null;
}) {
	const format = useFormats();

	if (stats === null)
		return (
			<p className={styles.figures} data-figures="" {...busyProps(isPending)}>
				<Skeleton width="16em" />
				{isPending ? <BusyNote /> : null}
			</p>
		);

	const duration = formatDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest
			? stats.earliest === stats.latest
				? `${stats.earliest}`
				: `${stats.earliest}-${stats.latest}`
			: null;

	const figures: { name: string; content: ReactNode }[] = [];
	if (albumCount !== null && albumCount > 1)
		figures.push({
			name: "albums",
			content: (
				<Trans
					phrase="artist.albumCount"
					count={albumCount}
					total={<b>{format.number(albumCount)}</b>}
				/>
			),
		});
	figures.push({
		name: "tracks",
		content: (
			<Trans
				phrase="view.trackCount"
				count={stats.trackCount}
				total={<b>{format.number(stats.trackCount)}</b>}
			/>
		),
	});
	if (duration) figures.push({ name: "duration", content: duration });
	if (span) figures.push({ name: "span", content: span });

	return (
		<p className={styles.figures} data-figures="">
			{figures.map(({ name, content }, at) => (
				<span key={name} className={styles.figure}>
					{at > 0 ? (
						<span className={styles.separator} aria-hidden="true">
							·
						</span>
					) : null}
					<span data-figure={name}>{content}</span>
				</span>
			))}
		</p>
	);
}

export function ViewHeader({
	eyebrow,
	title,
	stats,
	isStatsPending,
	covers,
	cover,
	tabs,
	actions,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	stats: HeaderStats | null;
	isStatsPending: boolean;
	covers: { source: LibrarySource; rows: TrackRows; seed: string | null };
	cover?: { src: string | null; identity: string | undefined; alt: string };
	tabs?: ReactNode;
	actions?: ReactNode;
}) {
	const picks = useCoverPicks(covers.source, covers.rows, covers.seed);

	return (
		<header className={styles.header} data-tabs={tabs ? "true" : undefined}>
			<HeaderBackdrop source={covers.source} covers={picks} />

			<div className={styles.lead}>
				{cover ? (
					<div className={styles.cover} data-header-cover="">
						<Artwork
							src={cover.src}
							identity={cover.identity}
							size="100%"
							alt={cover.alt}
						/>
					</div>
				) : null}
				<div className={styles.naming}>
					<p className={styles.eyebrow}>{eyebrow}</p>
					<h1 className={styles.title}>{title}</h1>
				</div>
			</div>

			<div className={styles.meta}>
				<Figures
					stats={stats}
					isPending={isStatsPending}
					albumCount={stats?.albumCount ?? picks.albumCount}
				/>

				<div className={styles.actions}>{actions}</div>
			</div>

			{tabs ? <div className={styles.tabs}>{tabs}</div> : null}
		</header>
	);
}
