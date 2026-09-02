import {
	useCursorFollowsPlayback,
	usePlaybackFollowsCursor,
} from "@/domain/track/followSettings";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function Playback() {
	const [cursorFollows, setCursorFollows] = useCursorFollowsPlayback();
	const [playbackFollows, setPlaybackFollows] = usePlaybackFollowsCursor();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>Playback</h2>
				<HelpHint label="About following">
					<p>
						Search results are exempt from both. Those rows change under every
						keystroke, and jumping to the playing track the moment it appears
						among them would take the view away from what you just typed for.
					</p>
					<p>
						With <strong>cursor follows playback</strong> off, the cursor stays
						wherever you last left it — and that is the row every track will
						hand over to.
					</p>
				</HelpHint>
			</div>

			<Switch
				checked={cursorFollows}
				onChange={setCursorFollows}
				label="Cursor follows playback"
			/>

			<Switch
				checked={playbackFollows}
				onChange={setPlaybackFollows}
				label="Playback follows cursor"
			/>
		</section>
	);
}
