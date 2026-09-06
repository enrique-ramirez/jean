import { Loader2, MonitorSpeaker, Play, RotateCcw } from "lucide-react";
import { type CSSProperties, useId, useLayoutEffect, useState } from "react";

import {
	otherListeners,
	playerHeld,
	useAudience,
	type Watching,
} from "@/domain/player/audience";
import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useIsPlaying, useVolume } from "@/domain/player/usePlayer";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";
import { VolumeGlyph, VolumeSlider } from "./Volume";

// An output picker, and under it a roster.
// The two are different kinds of thing and are drawn as such: the top rows move this device's sound, and the rest is who else has it. Audio cannot be sent to a device that is not already asking for it -- starting playback in a browser takes a gesture on that browser -- so there is nothing in the roster to press.
// Every row that has the sound is marked with the same bars a playing track carries, which makes "where is it coming out" one glance rather than a vocabulary. Taken from AirPlay's card, along with the fader per row; the checkmark it marks the chosen device with is what was left behind, because two outputs can be live at once and a tick says one was picked.

// What the row under "Listen here" says, in the states where it has something to say.
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

// Why the player's fader is sitting at the bottom, in the words of whoever is reading it. The component silences it for the audience, so who it is silent for comes off the roster.
function silentFor(
	isHere: boolean,
	others: readonly { label: string }[],
): string {
	if (isHere) return "Silent while you and others listen";
	if (others.length === 1)
		return `Silent while ${others[0].label} is listening`;
	return `Silent while ${others.length} devices are listening`;
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

// Only worth saying while both are audible, which is the one arrangement where the gap can be heard as an echo.
const drift = (lagSeconds: number | null) =>
	lagSeconds === null
		? "Runs ahead of this device."
		: `Runs ${roughly(lagSeconds)} ahead of this device.`;

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

	// How far the button sits from the right of the screen, which is what the compact rule right-aligns the panel against. Measured on open: it closes on any press outside, so there is no arrangement where it is up while the bar underneath it reflows.
	const [gap, setGap] = useState(0);
	useLayoutEffect(() => {
		if (!isOpen) return;
		const box = ref.current?.getBoundingClientRect();
		if (box) setGap(window.innerWidth - box.right);
	}, [isOpen, ref]);

	// Two of these are mounted at once on a screen that has both a status bar and a now-playing panel, so the ids a row points at cannot be spelled out.
	const headingId = useId();
	const othersId = useId();
	const playerNoteId = useId();
	const deviceNoteId = useId();

	const { volume, setValue } = useVolume();
	const playerMuted = volume?.isMuted === true;
	const isPlaying = useIsPlaying();

	const audience = useAudience(
		audienceMode(canListen, isOpen || isOn, playerMuted),
	);
	const others = otherListeners(audience);
	const held = playerHeld(audience);

	// No component, no encoder, or a codec this browser cannot decode: a bare install gets no control rather than a dead one.
	if (!canListen) return null;

	const note = explain(phase);

	// The sound comes out of the player unless something took it away, which stays true on a player nobody is listening to.
	const playerAudible = !playerMuted;

	// Only the last device holding the sound can hand it back by stopping, and only where the player is silent is there anything to hand back. Anybody else stopping would leave it exactly as silent as it was, and a player already playing has nothing to be given.
	const canHandBack = isOn && others.length === 0 && !playerAudible;

	// What pressing the row would do, why its fader is at the bottom, or how far ahead of this device it runs -- at most one of the three is ever true at once, which is what keeps a pressable row from being drawn with no sign of what it does.
	let playerNote: string | null = null;
	if (playerAudible) playerNote = isOn ? drift(audience.lagSeconds) : null;
	else if (canHandBack) playerNote = `Move the sound back to ${playerName}`;
	else if (held && others.length > 0) playerNote = silentFor(isOn, others);

	// The name and its mark, pressable or not: the row is a control only where pressing it would do something.
	const playerFace = (
		<>
			<span className={styles.mark}>
				{playerAudible ? (
					<Equalizer label={`Playing on ${playerName}`} paused={!isPlaying} />
				) : null}
			</span>
			<span className={styles.name}>{playerName}</span>
		</>
	);

	return (
		<div className={styles.anchor} ref={ref}>
			{isOpen ? (
				// On the now-playing screen this opens inside the swipe surface, and a flick down a roster is not a dismissal of the screen under it.
				<div
					className={styles.popover}
					style={{ "--listen-gap": `${gap}px` } as CSSProperties}
					data-owns-touch=""
				>
					{/* Toggles rather than a radio group, because both outputs can be on at once. Pressing one still hands the sound over -- that is what the rows do -- but the state underneath is two booleans, and saying otherwise would leave a reader hearing "1 of 2" while it plays in two rooms. */}
					{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither */}
					<div role="group" aria-labelledby={headingId}>
						{/* Labelled by the heading rather than carrying a copy, or the group announces its own name twice. */}
						<p className={styles.heading} id={headingId}>
							Playing on
						</p>

						{/* The fader is a control of its own beside the row rather than inside it: a slider nested in a button is neither valid nor reachable. */}
						<div className={styles.row}>
							{canHandBack ? (
								<button
									type="button"
									className={`${styles.face} ${styles.option}`}
									aria-label={`Move the sound back to ${playerName}`}
									aria-describedby={playerNote ? playerNoteId : undefined}
									onClick={() => disconnect()}
								>
									{playerFace}
								</button>
							) : (
								<div className={styles.face}>{playerFace}</div>
							)}

							{/* Always drawn, and never a mute button beside it: the player's mute is its fader at the bottom, and a control that disappears at zero is one there is no way back from. */}
							{volume ? (
								<span className={styles.fader}>
									<VolumeGlyph volume={volume} />
									<VolumeSlider
										volume={volume}
										onChange={setValue}
										className={styles.slider}
										label={`Volume on ${playerName}`}
									/>
								</span>
							) : null}

							{playerNote ? (
								<p className={styles.note} id={playerNoteId}>
									{playerNote}
								</p>
							) : null}
						</div>

						<div className={styles.row}>
							<button
								type="button"
								className={`${styles.face} ${styles.option}`}
								aria-pressed={isOn}
								aria-label={isOn ? "Stop listening here" : "Listen here"}
								aria-describedby={note ? deviceNoteId : undefined}
								onClick={() => (isOn ? disconnect() : connect())}
							>
								<span className={styles.mark}>
									{isBusy(phase) ? (
										<Loader2
											size={14}
											strokeWidth={2.5}
											className={styles.spin}
										/>
									) : phase.kind === "playing" ? (
										<Equalizer paused={!isPlaying} />
									) : null}
								</span>
								<span className={styles.name}>
									{isOn ? "Listening here" : "Listen here"}
								</span>
								{/* Inside the row rather than beside it, because it is not a second action: the row is the switch, and this is what says which way it throws. */}
								{isOn ? <span className={styles.stop}>Stop</span> : null}
							</button>

							{note ? (
								<p
									className={styles.note}
									id={deviceNoteId}
									data-tone={phase.kind}
								>
									{note}
								</p>
							) : null}
						</div>
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
							<p className={styles.heading} id={othersId}>
								Also listening
							</p>
							{/* A list and not a menu: there is nothing here to press. */}
							<ul className={styles.roster} aria-labelledby={othersId}>
								{others.map((device) => (
									<li className={styles.listener} key={device.deviceId}>
										<span className={styles.mark}>
											<Equalizer paused={!isPlaying} />
										</span>
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
