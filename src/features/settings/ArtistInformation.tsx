import { useArtistInfoEnabled } from "@/features/now-playing/artistInfo";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

// The only switch in Jean that decides whether anything leaves the network, so
// it says so plainly and in the panel rather than in a tooltip. Off by default:
// a music player on a LAN telling a third party what its owner is listening to
// is not a default anybody chose.
export function ArtistInformation() {
	const [isEnabled, setEnabled] = useArtistInfoEnabled();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>Artist information</h2>
				<span className={styles.status} data-tone={isEnabled ? "ok" : "off"}>
					{isEnabled ? "On" : "Off"}
				</span>
			</div>

			<p className={styles.summary}>
				Everything else Jean shows comes out of your own library. This is the
				exception: the Artist tab on the now-playing screen asks{" "}
				<b>MusicBrainz</b> and <b>Wikipedia</b> for a biography, which means
				sending them the artist name from the track you are playing.
			</p>

			<p className={styles.fix}>
				No account and no key — but the requests come from this device, so on a
				phone they go out over whatever connection it is using. Nothing is sent
				while this is off.
			</p>

			<Switch
				checked={isEnabled}
				onChange={setEnabled}
				label="Look up artists on MusicBrainz and Wikipedia"
			/>
		</section>
	);
}
