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
import type { PlayerInfo } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";
import { VolumeGlyph, VolumeSlider } from "./Volume";

export const playerNameOf = (info: PlayerInfo) => info.title ?? info.name;

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
		case "silent":
			return "foobar2000 is stopped, so there is nothing to hear yet.";
		case "failed":
			return phase.message;
	}
}

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

const audienceMode = (
	canListen: boolean,
	looking: boolean,
	playerMuted: boolean,
): Watching => {
	if (!canListen) return "off";
	if (looking) return "open";
	return playerMuted ? "background" : "off";
};

const withOthers = (label: string, others: number) =>
	others === 0
		? label
		: `${label}, ${others} other ${others === 1 ? "device" : "devices"} listening`;

const roughly = (seconds: number) =>
	seconds < 1.5 ? "about a second" : `about ${Math.round(seconds)} seconds`;

const drift = (lagSeconds: number | null) =>
	lagSeconds === null
		? "Runs ahead of this device."
		: `Runs ${roughly(lagSeconds)} ahead of this device.`;

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

	const [gap, setGap] = useState(0);
	useLayoutEffect(() => {
		if (!isOpen) return;
		const box = ref.current?.getBoundingClientRect();
		if (box) setGap(window.innerWidth - box.right);
	}, [isOpen, ref]);

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

	if (!canListen) return null;

	const note = explain(phase);

	const playerAudible = !playerMuted;

	const canHandBack = isOn && others.length === 0 && !playerAudible;

	let playerNote: string | null = null;
	if (playerAudible) playerNote = isOn ? drift(audience.lagSeconds) : null;
	else if (canHandBack) playerNote = `Move the sound back to ${playerName}`;
	else if (held && others.length > 0) playerNote = silentFor(isOn, others);

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
				<div
					className={styles.popover}
					style={{ "--listen-gap": `${gap}px` } as CSSProperties}
					data-owns-touch=""
				>
					{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither */}
					<div role="group" aria-labelledby={headingId}>
						<p className={styles.heading} id={headingId}>
							Playing on
						</p>

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

					{/* No await in front of this call: an await loses the user gesture browsers require to start audio. */}
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
				{others.length > 0 ? (
					<span className={styles.badge} aria-hidden="true">
						{others.length}
					</span>
				) : null}
			</button>
		</div>
	);
}
