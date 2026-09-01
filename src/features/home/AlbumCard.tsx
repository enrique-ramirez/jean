import { Artwork } from "@/shared/ui/Artwork";
import styles from "./AlbumCard.module.css";
import type { CoveredAlbum } from "./albums";

// The words sit on the sleeve, not under it.
//
// No play badge: a cover you can click is obviously one you can play, and a round
// button in the corner of the artwork is the most recognisable thing about every
// streaming service there is. Hover lifts the card and warms the title instead.
//
// The caption is the reason the album is on this shelf, which is the difference
// between a shelf and a query result -- so it sits in the accent rather than
// filed under the artist as a third line of grey text.
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

			{/* Last in the DOM, first on the sleeve. The pill is positioned, so its
          order here is purely what a screen reader reads -- and a card should
          announce the record before the statistic about it. */}
			{caption ? <span className={styles.caption}>{caption}</span> : null}
		</button>
	);
}
