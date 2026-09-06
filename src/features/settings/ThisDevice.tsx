import { DEVICE_NAME_KEY, defaultDeviceName } from "@/domain/player/device";
import {
	LOW_LATENCY_KEY,
	restartListening,
} from "@/domain/player/listenerStore";
import { canUseMse } from "@/domain/player/mseStream";
import { useListener } from "@/domain/player/useListener";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Input } from "@/shared/ui/Input";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

// The one setting in here that describes the machine rather than the library, which is why it says so and why it never syncs.
export function ThisDevice() {
	const { canListen, lowLatencyFellBack: fellBack } = useListener();
	const [name, setName] = useStoredState(DEVICE_NAME_KEY, defaultDeviceName);
	const [isLowLatency, setLowLatency] = useStoredState(LOW_LATENCY_KEY, true);

	// Nothing can listen without the component, and with nobody to be named to this is a field about nothing.
	if (!canListen) return null;

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>This device</h2>
				<HelpHint label="About the name">
					<p>
						A browser cannot read the name of the machine it is running on, so
						Jean guesses at the <em>kind</em> of device. Change it to whatever
						you would recognise from across the house.
					</p>
					<p>
						It is stored on this device alone and never follows you to another
						one — the whole point of it is to tell them apart. A new name
						reaches the other devices when this one next connects to the stream.
					</p>
				</HelpHint>
			</div>

			<div className={styles.field}>
				<label className={styles.label} htmlFor="device-name">
					Name
				</label>
				<Input
					size="md"
					className={styles.input}
					id="device-name"
					type="text"
					value={name}
					maxLength={64}
					// Emptied, it falls back to the guess rather than to nothing: a blank row in somebody else's picker says less than a wrong word.
					onChange={(event) => setName(event.target.value)}
					onBlur={(event) => {
						if (event.target.value.trim() === "") setName(defaultDeviceName());
					}}
					placeholder={defaultDeviceName()}
					spellCheck={false}
				/>
				<p className={styles.detail}>
					What the other devices call this one while it is listening.
				</p>
			</div>

			{canUseMse() ? (
				<div className={styles.field}>
					<Switch
						checked={isLowLatency}
						onChange={(next) => {
							setLowLatency(next);
							restartListening();
						}}
						label="Use a short buffer"
					/>
					<p className={styles.detail}>
						{fellBack
							? "This connection kept running dry, so Jean went back to the browser's own buffer. It will try the short one again next time you listen."
							: "Playback starts almost at once and runs under half a second behind the player, rather than the seconds this browser would hold on its own. The sound is identical either way — the same audio in a different wrapper. Turn it off if the stream breaks up; Jean does the same by itself when a connection cannot hold it. Reconnects while listening."}
					</p>
				</div>
			) : null}
		</section>
	);
}
