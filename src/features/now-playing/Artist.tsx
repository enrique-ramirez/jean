import { ExternalLink } from "lucide-react";
import styles from "./Artist.module.css";
import { useArtistInfo, useArtistInfoEnabled } from "./artistInfo";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

// The one panel whose contents do not come from the player, which is why it is
// the one panel that has to be turned on. Off, it says what it would do and
// where the switch is -- a tab that is simply empty reads as broken, and a tab
// that quietly starts making outbound requests is worse.
export function Artist() {
	const { track } = useNowPlayingTrack();
	const [isEnabled] = useArtistInfoEnabled();
	const { data, isPending, isError } = useArtistInfo(track?.artist);

	if (!isEnabled)
		return (
			<div className={styles.notice}>
				<p>Artist information is off.</p>
				<p className={styles.hint}>
					Everything else on this screen comes from your player. This one asks
					MusicBrainz and Wikipedia, which means telling them what you are
					listening to — so it is off until you turn it on, in{" "}
					<b>Settings → Artist information</b>.
				</p>
			</div>
		);

	if (isPending)
		return (
			<p className={styles.notice}>
				Looking {track?.artist ? `${track.artist} ` : ""}up…
			</p>
		);

	// Not an error state with a retry button: no connection, no match and no
	// article are all ordinary, and the player being offline is the normal case
	// for a machine in a cupboard.
	if (isError || !data)
		return (
			<div className={styles.notice}>
				<p>Nothing found for {track?.artist ?? "this artist"}.</p>
				<p className={styles.hint}>
					Either the name in the tag matches no MusicBrainz entry, or this
					device has no connection to reach it.
				</p>
			</div>
		);

	const facts = [data.kind, data.area, data.years].filter(Boolean);

	return (
		<div className={styles.artist}>
			<h2 className={styles.name}>{data.name}</h2>
			{facts.length > 0 ? (
				<p className={styles.facts}>{facts.join(" · ")}</p>
			) : null}

			{data.summary ? <p className={styles.summary}>{data.summary}</p> : null}

			{/* Named, because an encyclopaedia entry about somebody's band should say
          which encyclopaedia -- and because it is the only text on this screen
          Jean did not get from the user's own files. */}
			<a
				className={styles.source}
				href={data.sourceUrl}
				target="_blank"
				rel="noreferrer noopener"
			>
				Read more on {data.sourceName}
				<ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
			</a>
		</div>
	);
}
