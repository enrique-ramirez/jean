import { DiscAlbum, Music2, User } from "lucide-react";
import { useState } from "react";
import { genreRoute, href } from "@/domain/track/routes";
import { libraryArtworkUrl } from "@/shared/api/artwork";
import { useTranslate } from "@/shared/i18n/useTranslate";
import type { FuzzyKey } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./GenreTile.module.css";

export interface GenreTileData {
	name: string;
	key: string;
	match: FuzzyKey;
	trackCount: number;
	albumCount: number;
	artistCount: number;
	covers: string[];
}

export function GenreTile({
	genre,
	origin,
}: {
	genre: GenreTileData;
	origin: string | null;
}) {
	const t = useTranslate();
	const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
	const ready = genre.covers.every((cover) => settled.has(cover));

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
		<a
			className={styles.tile}
			href={href(genreRoute(genre.name))}
			data-genre-tile=""
		>
			<span className={styles.stack} data-ready={ready ? "" : undefined}>
				{genre.covers.length > 0 ? (
					genre.covers.map((cover) => (
						<span key={cover} className={styles.sleeve}>
							<Artwork
								src={libraryArtworkUrl(origin, cover)}
								size="100%"
								onSettled={() => setSettled((seen) => new Set(seen).add(cover))}
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
