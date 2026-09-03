import { ExternalLink } from "lucide-react";
import styles from "./Artist.module.css";
import { useArtistInfo, useArtistInfoEnabled } from "./artistInfo";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

// The one panel whose contents do not come from the player, and so the one that has to be turned on first.
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

	// Not an error state with a retry: no connection, no match and no article are all ordinary outcomes here.
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
