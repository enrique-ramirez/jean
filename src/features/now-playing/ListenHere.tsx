import { Check, Loader2, MonitorSpeaker, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useDismissable } from "@/shared/hooks/useDismissable";
import styles from "./ListenHere.module.css";

// An output picker: the sound is in one of two places and this says which.
// Silencing the player while a listener is attached is the component's job and is not built yet, so both play at once today. Jean must not paper over that with a mute of its own.

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

	// No component, no encoder, or a codec this browser cannot decode: a bare install gets no control rather than a dead one.
	if (!canListen) return null;

	const note = explain(phase);

	return (
		<div className={styles.anchor} ref={ref}>
			{isOpen ? (
				/* A radio group rather than a menu: the two outputs are mutually exclusive and one is always true. */
				<div
					className={styles.popover}
					role="radiogroup"
					aria-labelledby="listen-here-heading"
				>
					{/* Labelled by the heading rather than carrying a copy, or the group announces its own name twice. */}
					<p className={styles.heading} id="listen-here-heading">
						Playing on
					</p>

					{/* Native radios would bring a form control's styling and focus model into a menu that is neither. */}
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
				<MonitorSpeaker size={17} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>
	);
}
