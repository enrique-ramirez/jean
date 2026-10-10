import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./TopTracks.module.css";
import type { TopTrack } from "./tracks";

export function TopTracks({
	tracks,
	onPlayTrack,
}: {
	tracks: TopTrack[];
	onPlayTrack: (ref: number) => void;
}) {
	const t = useTranslate();
	const canControlPlayback = useCanControlPlayback();
	if (tracks.length === 0) return null;

	return (
		<section className={styles.block} aria-labelledby="home-top-tracks">
			<h2 className={styles.heading} id="home-top-tracks">
				{t("home.topTracks")}
			</h2>

			<ol className={styles.list}>
				{tracks.map((track, at) => {
					const artistAndTitle = track.artist
						? `${track.artist} — ${track.title}`
						: track.title;
					return (
						<li key={track.ref}>
							<button
								type="button"
								className={styles.row}
								title={artistAndTitle}
								onClick={
									canControlPlayback ? () => onPlayTrack(track.ref) : undefined
								}
								aria-disabled={canControlPlayback ? undefined : "true"}
								aria-label={
									canControlPlayback
										? undefined
										: t("player.controlOffName", { control: artistAndTitle })
								}
							>
								<span className={styles.rank}>{at + 1}</span>
								<Artwork
									src={track.artworkUrl}
									size={34}
									className={styles.art}
								/>
								<span className={styles.meta}>
									<span className={styles.title}>{track.title}</span>
									{track.artist ? (
										<span className={styles.artist}>{track.artist}</span>
									) : null}
								</span>
								<span className={styles.plays}>
									{t("shelf.plays", { count: track.plays })}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
