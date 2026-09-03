import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./TopTracks.module.css";
import type { TopTrack } from "./tracks";

// A ranked list rather than a rail of covers: Jean has no artist or track imagery beyond album art, and a numbered list needs none.
export function TopTracks({
	tracks,
	onPlayTrack,
}: {
	tracks: TopTrack[];
	onPlayTrack: (ref: number) => void;
}) {
	if (tracks.length === 0) return null;

	return (
		<section className={styles.block} aria-labelledby="home-top-tracks">
			<h2 className={styles.heading} id="home-top-tracks">
				Your top tracks
			</h2>

			<ol className={styles.list}>
				{tracks.map((track, at) => (
					<li key={track.ref}>
						<button
							type="button"
							className={styles.row}
							// A track title truncates in this column on a phone almost every time.
							title={
								track.artist ? `${track.artist} — ${track.title}` : track.title
							}
							onClick={() => onPlayTrack(track.ref)}
						>
							{/* Tabular, so the covers stay in line whether the rank is 1 or 10. */}
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
								{plural(track.plays, "play")}
							</span>
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}
