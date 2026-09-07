import { DiscAlbum, Music2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo } from "react";

import { genreHref } from "@/domain/library/genreRoute";
import type { Genre } from "@/domain/track/genres";
import type { LibrarySource } from "@/domain/track/librarySource";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { GenreMark } from "./GenreMark";
import styles from "./GenreTile.module.css";
import { markOf } from "./mark";

const MAX_TILT = 9;

export function GenreTile({
	genre,
	source,
}: {
	genre: Genre;
	source: LibrarySource;
}) {
	const t = useTranslate();
	const format = useFormats();
	const mark = useMemo(() => markOf(genre.name), [genre.name]);

	const covers = useMemo(
		() =>
			genre.coverRefs.map((ref, at) => ({
				ref,
				url: source.artworkUrl(ref),
				tilt: (mark.draws[at % mark.draws.length] * 2 - 1) * MAX_TILT,
			})),
		[genre.coverRefs, source, mark.draws],
	);

	const countLabel = [
		genre.albumCount > 0
			? t("artist.albumCount", {
					count: genre.albumCount,
					total: genre.albumCount,
				})
			: null,
		t("view.trackCount", {
			count: genre.trackCount,
			total: genre.trackCount,
		}),
	]
		.filter(Boolean)
		.join(", ");

	return (
		<a
			className={styles.tile}
			href={genreHref(genre.name)}
			style={{ "--genre-tint": mark.tint } as CSSProperties}
			data-genre-tile=""
		>
			<span className={styles.field}>
				<GenreMark mark={mark} />
			</span>

			<span className={styles.counts}>
				<span className="visually-hidden">{countLabel}</span>

				<span aria-hidden="true" className={styles.figures}>
					{genre.albumCount > 0 ? (
						<>
							<DiscAlbum size={12} strokeWidth={2} />
							{format.number(genre.albumCount)}
							<span className={styles.separator}>·</span>
						</>
					) : null}
					<Music2 size={12} strokeWidth={2} />
					{format.number(genre.trackCount)}
				</span>
			</span>

			<span className={styles.body}>
				<span className={styles.name} title={genre.name}>
					{genre.name}
				</span>

				{covers.length > 0 ? (
					<span className={styles.stack}>
						{covers.map((cover) => (
							<span
								key={cover.ref}
								className={styles.sleeve}
								style={{ "--tilt": `${cover.tilt}deg` } as CSSProperties}
							>
								<Artwork src={cover.url} size="100%" alt="" />
							</span>
						))}
					</span>
				) : null}
			</span>
		</a>
	);
}
