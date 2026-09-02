import { useArtistInfoEnabled } from "@/features/now-playing/artistInfo";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function ArtistInformation() {
	const [isEnabled, setEnabled] = useArtistInfoEnabled();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>Artist information</h2>
				<HelpHint label="About artist lookups">
					<p>
						The requests come from <strong>this device</strong>, not from the
						player — so on a phone they go out over whatever connection it is
						using. No account and no key.
					</p>
					<p>Nothing is sent while this is off.</p>
				</HelpHint>
			</div>

			<Switch
				checked={isEnabled}
				onChange={setEnabled}
				label="Look up artists on MusicBrainz and Wikipedia"
			/>
		</section>
	);
}
