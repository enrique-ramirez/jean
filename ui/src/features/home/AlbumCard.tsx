import {
	useCanControlPlayback,
	whenControllable,
} from "@/domain/player/usePlaybackControl";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./AlbumCard.module.css";
import type { CoveredAlbum } from "./cover";

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
	const canControlPlayback = useCanControlPlayback();
	const title = `${album.artist ?? t("track.unknownArtist")} — ${album.album}`;
	return (
		<button
			type="button"
			className={styles.card}
			{...whenControllable(canControlPlayback, onPlay, title, t)}
			title={title}
		>
			<span className={styles.cover}>
				<Artwork
					src={album.artworkUrl}
					identity={album.identity}
					size="100%"
					alt=""
					className={styles.art}
				/>
			</span>

			<span className={styles.meta}>
				<span className={styles.album}>{album.album}</span>
				<span className={styles.artist}>
					{album.artist ?? t("track.unknownArtist")}
				</span>
			</span>

			{caption ? <span className={styles.caption}>{caption}</span> : null}
		</button>
	);
}
