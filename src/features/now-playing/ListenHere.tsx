import { Check, Loader2, MonitorSpeaker, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import {
	otherListeners,
	playerHeld,
	releasePlayer,
	useAudience,
	type Watching,
} from "@/domain/player/audience";
import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useVolume } from "@/domain/player/usePlayer";
import { useDismissable } from "@/shared/hooks/useDismissable";
import styles from "./ListenHere.module.css";
import { VolumeSlider } from "./Volume";

// An output picker, and under it a roster.
// The two are different kinds of thing and are drawn as such: the top rows move this device's sound, and the rest is who else has it. Audio cannot be sent to a device that is not already asking for it -- starting playback in a browser takes a gesture on that browser -- so there is nothing in the roster to press.

// What the row under "This device" says, in the states where it has something to say.
function explain(phase: ListenPhase): string | null {
	switch (phase.kind) {
		case "off":
		case "playing":
			return null;
		case "connecting":
			return "Connecting…";
		case "reconnecting":
			return "The stream dropped. Reconnecting…";
		case "blocked":
			return "This browser needs one more tap before it will play audio.";
		case "busy":
			return "The player is already streaming to as many devices as it allows.";
		// A stopped player and a broken stream look identical from the stream: it is open and carrying nothing, with no error to catch.
		case "silent":
			return "foobar2000 is stopped, so there is nothing to hear yet.";
		case "failed":
			return phase.message;
	}
}

// Why the player is silent, in the words of whoever is reading it. The component says the silence is its doing; who it is doing it for comes off the roster.
function explainSilence(
	held: boolean,
	isHere: boolean,
	others: readonly { label: string }[],
): string {
	if (!held) return "Muted";
	if (isHere) return "Muted while you listen here";
	if (others.length === 1) return `Muted while ${others[0].label} is listening`;
	return `Muted while ${others.length} devices are listening`;
}

const isBusy = (phase: ListenPhase) =>
	phase.kind === "connecting" || phase.kind === "reconnecting";

// Nothing to ask until there is a component to ask, which is also what says the connection knows where to send it -- so `canListen` is what re-arms the poll once discovery settles, rather than the first answer being twenty seconds late.
// Closely only while somebody is looking. A silent player is worth watching in the background because others listening is what usually silences it, but a player muted by hand looks exactly the same from beefweb, so that case must cost little.
const audienceMode = (
	canListen: boolean,
	looking: boolean,
	playerMuted: boolean,
): Watching => {
	if (!canListen) return "off";
	if (looking) return "open";
	return playerMuted ? "background" : "off";
};

// The badge is a bare digit, so the count only reaches a reader through here.
const withOthers = (label: string, others: number) =>
	others === 0
		? label
		: `${label}, ${others} other ${others === 1 ? "device" : "devices"} listening`;

// Whole seconds: the figure moves with every rebuffer, and a decimal place would invite reading it as a measurement rather than as a warning.
const roughly = (seconds: number) =>
	seconds < 1.5 ? "about a second" : `about ${Math.round(seconds)} seconds`;

// Rounded to what the sentence can carry. Minutes past a minute, because "127 seconds" is nobody's unit.
function forHowLong(seconds: number): string {
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.round(minutes / 60);
	return hours === 1 ? "1 hr" : `${hours} hr`;
}

export function ListenHere({ playerName }: { playerName: string }) {
	const {
		canListen,
		isOn,
		phase,
		canSetVolume,
		connect,
		disconnect,
		resume,
		retry,
	} = useListener();
	const [isOpen, setIsOpen] = useState(false);
	const ref = useDismissable<HTMLDivElement>(isOpen, () => setIsOpen(false));

	const { volume, setValue } = useVolume();
	const playerMuted = volume?.isMuted === true;

	const audience = useAudience(
		audienceMode(canListen, isOpen || isOn, playerMuted),
	);
	const others = otherListeners(audience);
	const held = playerHeld(audience);

	// No component, no encoder, or a codec this browser cannot decode: a bare install gets no control rather than a dead one.
	if (!canListen) return null;

	const note = explain(phase);

	// The tick means the sound comes out there, which stays literally true on a device that is not listening to anything.
	const playerAudible = !playerMuted;

	// Only while this device is listening: elsewhere the status bar's own fader still points at the player, and a second one beside it would be the same control twice.
	const showPlayerFader = isOn && playerAudible && Boolean(volume);

	return (
		<div className={styles.anchor} ref={ref}>
			{isOpen ? (
				<div className={styles.popover}>
					{/* Toggles rather than a radio group, because both outputs can be on at once. Pressing one still hands the sound over -- that is what the buttons do -- but the state underneath is two booleans, and saying otherwise would leave a reader hearing "1 of 2" while it plays in two rooms. */}
					{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither */}
					<div role="group" aria-labelledby="listen-here-heading">
						{/* Labelled by the heading rather than carrying a copy, or the group announces its own name twice. */}
						<p className={styles.heading} id="listen-here-heading">
							Playing on
						</p>

						{/* Two controls side by side rather than one inside the other: a button nested in a button is neither valid nor reachable. */}
						<div className={styles.row}>
							<button
								type="button"
								className={styles.option}
								aria-pressed={playerAudible}
								onClick={() => (isOn ? disconnect() : undefined)}
							>
								<span className={styles.mark}>
									{playerAudible ? <Check size={14} strokeWidth={2.5} /> : null}
								</span>
								<span className={styles.optionText}>
									<span className={styles.optionName}>{playerName}</span>
									<span className={styles.optionNote}>
										{playerAudible
											? "Where the player is"
											: explainSilence(held, isOn, others)}
									</span>
								</span>
							</button>

							{/* Never stops anybody: it adds an output rather than taking one away, which is why a device that is not listening itself may press it too. */}
							{held ? (
								<button
									type="button"
									className={styles.inlineAction}
									// Named for its target, because the status bar's own mute
									// button is called "Unmute" too whenever the player is silent
									// -- and pressing that one is the same act by accident.
									aria-label={`Unmute ${playerName}`}
									onClick={() => releasePlayer()}
								>
									Unmute
								</button>
							) : null}
						</div>

						{showPlayerFader ? (
							<div className={styles.alongside}>
								<VolumeSlider
									volume={volume}
									onChange={setValue}
									label={`Volume on ${playerName}`}
								/>
								{/* The real figure off the audible clock rather than a hedge, because "a second or two" is the difference between a room away and an echo. */}
								<p className={styles.drift}>
									{audience.lagSeconds === null
										? "Runs ahead of this device."
										: `Runs ${roughly(audience.lagSeconds)} ahead of this device.`}
								</p>
							</div>
						) : null}

						<button
							type="button"
							className={styles.option}
							aria-pressed={isOn}
							onClick={() => (isOn ? undefined : connect())}
						>
							<span className={styles.mark}>
								{isBusy(phase) ? (
									<Loader2
										size={14}
										strokeWidth={2.5}
										className={styles.spin}
									/>
								) : isOn ? (
									<Check size={14} strokeWidth={2.5} />
								) : null}
							</span>
							<span className={styles.optionText}>
								<span className={styles.optionName}>This device</span>
								{note ? (
									<span className={styles.optionNote} data-tone={phase.kind}>
										{note}
									</span>
								) : null}
							</span>
						</button>
					</div>

					{/* Called straight out of the click with no await in front of it: an await loses the user gesture browsers require to start audio. */}
					{phase.kind === "blocked" ? (
						<button
							type="button"
							className={styles.unblock}
							onClick={() => resume()}
						>
							<Play size={13} strokeWidth={2.5} aria-hidden="true" />
							Start playing
						</button>
					) : null}

					{phase.kind === "failed" ? (
						<button
							type="button"
							className={styles.unblock}
							onClick={() => retry()}
						>
							<RotateCcw size={13} strokeWidth={2.5} aria-hidden="true" />
							Try again
						</button>
					) : null}

					{/* No fader here: the status bar's own retargets to this device. This line is only for the platform that exposes no level at all. */}
					{isOn && !canSetVolume ? (
						<p className={styles.level}>
							This device sets its own level. Use its volume buttons.
						</p>
					) : null}

					{others.length > 0 ? (
						<>
							<p className={styles.heading} id="listen-here-others">
								Also listening
							</p>
							{/* A list and not a menu: there is nothing here to press. */}
							<ul
								className={styles.roster}
								aria-labelledby="listen-here-others"
							>
								{others.map((device) => (
									<li className={styles.listener} key={device.deviceId}>
										<span className={styles.listenerName}>{device.label}</span>
										<span className={styles.listenerFor}>
											{forHowLong(device.listeningFor)}
										</span>
									</li>
								))}
							</ul>
						</>
					) : null}
				</div>
			) : null}

			<button
				type="button"
				className={styles.button}
				aria-label={
					isOn
						? withOthers("Playing on this device", others.length)
						: withOthers("Choose where to play", others.length)
				}
				aria-expanded={isOpen}
				aria-pressed={isOn}
				title={isOn ? "Playing on this device" : `Playing on ${playerName}`}
				data-listening={isOn}
				onClick={() => setIsOpen((open) => !open)}
			>
				<MonitorSpeaker size={17} strokeWidth={2} aria-hidden="true" />
				{/* Deliberately a count and not a dot: "somebody else has this too" is the useful fact, and how many is the only detail that fits out here. */}
				{others.length > 0 ? (
					<span className={styles.badge} aria-hidden="true">
						{others.length}
					</span>
				) : null}
			</button>
		</div>
	);
}
