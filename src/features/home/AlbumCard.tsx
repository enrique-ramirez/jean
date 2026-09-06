import { Artwork } from "@/shared/ui/Artwork";
import styles from "./AlbumCard.module.css";
import type { CoveredAlbum } from "./albums";

export function AlbumCard({
	album,
	caption,
	onPlay,
}: {
	album: CoveredAlbum;
	caption?: string | null;
	onPlay: () => void;
}) {
	return (
		<button
			type="button"
			className={styles.card}
			onClick={onPlay}
			title={`${album.artist} — ${album.album}`}
		>
			<span className={styles.cover}>
				<Artwork
					src={album.artworkUrl}
					size="100%"
					alt=""
					className={styles.art}
				/>
			</span>

			<span className={styles.meta}>
				<span className={styles.album}>{album.album}</span>
				<span className={styles.artist}>{album.artist}</span>
			</span>

			{caption ? <span className={styles.caption}>{caption}</span> : null}
		</button>
	);
}
