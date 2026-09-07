import type { CoveredAlbum } from "@/domain/track/albums";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./AlbumCard.module.css";

export function AlbumCard({
	album,
	caption,
	onPlay,
}: {
	album: CoveredAlbum;
	caption?: string | null;
	onPlay: () => void;
}) {
	const t = useTranslate();
	return (
		<button
			type="button"
			className={styles.card}
			onClick={onPlay}
			title={`${album.artistTag ?? t("track.unknownArtist")} — ${album.album}`}
		>
			<span className={styles.cover}>
				<Artwork
					src={album.artworkUrl}
					identity={album.key}
					size="100%"
					alt=""
					className={styles.art}
				/>
			</span>

			<span className={styles.meta}>
				<span className={styles.album}>{album.album}</span>
				<span className={styles.artist}>
					{album.artistTag ?? t("track.unknownArtist")}
				</span>
			</span>

			{caption ? <span className={styles.caption}>{caption}</span> : null}
		</button>
	);
}
