import { Check, Loader2, MonitorSpeaker, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useDismissable } from "@/shared/hooks/useDismissable";
import styles from "./ListenHere.module.css";

// **An output picker, not a confirmation.** The sound is in one of two places
// and this says which -- which is the one idea worth taking from Roon's zone
// menu and Sonos's room tray: you read where it is playing without opening
// anything, because the collapsed control already says so.
//
// The alternative shape, a "listen here too" toggle, was rejected: it makes both
// rooms play at once, and the player is muted while a listener is attached, so
// there is only ever one answer to draw.
//
// Deliberately not a cast glyph. Casting pushes audio away to a box you are not
// holding; this moves it to the device you are, and the arrow points the other
// way. `MonitorSpeaker` is device-agnostic on purpose -- a TV, a laptop and an
// iMac are all "this device", and none of them is a pair of headphones.

// What the row under "This device" says, in the states where it has something to
// say. **Silence is wrong in every one of these**: the component is installed and
// working in all of them, and in most the user has done nothing wrong.
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
		// The one case with no error to catch: the stream is open and carrying
		// nothing, which from here is indistinguishable from a broken one.
		case "silent":
			return "foobar2000 is stopped, so there is nothing to hear yet.";
		case "failed":
			return phase.message;
	}
}

const isBusy = (phase: ListenPhase) =>
	phase.kind === "connecting" || phase.kind === "reconnecting";

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

	// No component, no encoder, or a codec this browser cannot decode. A bare
	// install must get a complete app, never a dead control.
	if (!canListen) return null;

	const note = explain(phase);

	return (
		<div className={styles.anchor} ref={ref}>
			{isOpen ? (
				/* A radio group rather than a menu: the two outputs are mutually
				   exclusive and one of them is always true, which is what a radio
				   says and a pressed button does not. */
				<div
					className={styles.popover}
					role="radiogroup"
					aria-labelledby="listen-here-heading"
				>
					{/* Labelled *by* the heading rather than carrying a copy of it, or
					    the group announces its own name twice. */}
					<p className={styles.heading} id="listen-here-heading">
						Playing on
					</p>

					{/* Native radios would bring a form control's styling and focus
					    model into a menu that is neither. */}
					{/* biome-ignore lint/a11y/useSemanticElements: not a form field, see above */}
					<button
						type="button"
						className={styles.option}
						role="radio"
						aria-checked={!isOn}
						onClick={() => disconnect()}
					>
						<span className={styles.mark}>
							{isOn ? null : <Check size={14} strokeWidth={2.5} />}
						</span>
						<span className={styles.optionText}>
							<span className={styles.optionName}>{playerName}</span>
							<span className={styles.optionNote}>Where the player is</span>
						</span>
					</button>

					{/* biome-ignore lint/a11y/useSemanticElements: not a form field, see above */}
					<button
						type="button"
						className={styles.option}
						role="radio"
						aria-checked={isOn}
						onClick={() => (isOn ? undefined : connect())}
					>
						<span className={styles.mark}>
							{isBusy(phase) ? (
								<Loader2 size={14} strokeWidth={2.5} className={styles.spin} />
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

					{/* Called straight out of the click, with no await in front of it:
              that is the whole point of this control existing. */}
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

					{/* Giving up is visible and offers the way back, rather than the
              button quietly going dark. */}
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

					{/* There is no fader here: the bar's own retargets to this device while
              the sound is here, so a second one would be the same control drawn
              twice. This is only for the platform that will not have either. */}
					{isOn && !canSetVolume ? (
						<p className={styles.level}>
							This device sets its own level. Use its volume buttons.
						</p>
					) : null}
				</div>
			) : null}

			<button
				type="button"
				className={styles.button}
				aria-label={isOn ? "Playing on this device" : "Choose where to play"}
				aria-expanded={isOpen}
				aria-pressed={isOn}
				title={isOn ? "Playing on this device" : `Playing on ${playerName}`}
				data-listening={isOn}
				onClick={() => setIsOpen((open) => !open)}
			>
				{/* One glyph, and the tone is the state -- the same idiom the shuffle
				    mode uses. A control that swaps its drawing is a control that
				    moves in the corner of your eye every time the sound changes
				    rooms, and `MonitorSpeaker` already shows both outputs. */}
				<MonitorSpeaker size={17} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>
	);
}
