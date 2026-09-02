import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./TopTracks.module.css";
import type { TopTrack } from "./tracks";

// Ten rows in the space one row of sleeves takes.
//
// Reference pass: GrooveGraph's Top Tracks column -- a ranked list with a rank
// badge, a small cover and the count. Taken whole, because it solves a problem
// this project has no other answer to: Jean has no artist or track imagery
// beyond album art, and a numbered list needs none. Rejected the circular
// artist rail from Melodify for the same reason -- with no artist photographs
// it would be a row of album covers cropped into circles, which reads as a
// mistake rather than as a decision.
//
// Every row opens All music and plays that track, which is the rule the front
// door's own Play follows: pressing play should not leave you looking at the
// screen you pressed it from, and it should leave playback somewhere it can
// carry on from rather than at a dead end.
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
							// The same tooltip an album card carries, and it earns its keep
							// harder here: a track title has a narrower column than an album
							// sleeve and truncates on a phone almost every time.
							title={
								track.artist ? `${track.artist} — ${track.title}` : track.title
							}
							onClick={() => onPlayTrack(track.ref)}
						>
							{/* Tabular, so ten ranks share one column and the covers beside
                  them stay in line whether the number is 1 or 10. */}
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
