import { DiscAlbum, Music2, User } from "lucide-react";
import { useState } from "react";

import { genreHref } from "@/domain/library/genreRoute";
import type { Genre } from "@/domain/track/genres";
import type { LibrarySource } from "@/domain/track/librarySource";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./GenreTile.module.css";

export function GenreTile({
	genre,
	source,
}: {
	genre: Genre;
	source: LibrarySource;
}) {
	const t = useTranslate();
	const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
	const ready = genre.coverRefs.every((ref) => settled.has(ref));

	const figures = [
		{
			icon: Music2,
			count: genre.trackCount,
			label: t("view.trackCount", {
				count: genre.trackCount,
				total: genre.trackCount,
			}),
		},
		{
			icon: DiscAlbum,
			count: genre.albumCount,
			label: t("artist.albumCount", {
				count: genre.albumCount,
				total: genre.albumCount,
			}),
		},
		{
			icon: User,
			count: genre.artistCount,
			label: t("genre.artistCount", {
				count: genre.artistCount,
				total: genre.artistCount,
			}),
		},
	].filter((figure) => figure.count > 0);

	return (
		<a className={styles.tile} href={genreHref(genre.name)} data-genre-tile="">
			<span className={styles.stack} data-ready={ready ? "" : undefined}>
				{genre.coverRefs.length > 0 ? (
					genre.coverRefs.map((ref) => (
						<span key={ref} className={styles.sleeve}>
							<Artwork
								src={source.artworkUrl(ref)}
								size="100%"
								onSettled={() => setSettled((seen) => new Set(seen).add(ref))}
							/>
						</span>
					))
				) : (
					<span className={styles.sleeve}>
						<Artwork src={null} size="100%" />
					</span>
				)}
			</span>

			<span className={styles.body}>
				<span className={styles.name} title={genre.name}>
					{genre.name}
				</span>

				<span className={styles.figures}>
					{figures.map(({ icon: Icon, label }) => (
						<span key={label} className={styles.figure}>
							<Icon size={14} strokeWidth={1.75} aria-hidden="true" />
							{label}
						</span>
					))}
				</span>
			</span>
		</a>
	);
}
