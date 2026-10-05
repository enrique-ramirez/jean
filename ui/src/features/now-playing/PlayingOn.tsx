import {
	Headphones,
	Loader2,
	MonitorSpeaker,
	Play,
	RotateCcw,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useId,
	useLayoutEffect,
	useRef,
} from "react";

import {
	type Audience,
	otherListeners,
	playerHeld,
} from "@/domain/player/audience";
import { useIsListeningOfferedFirst } from "@/domain/player/offersListening";
import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import { useIsPlaying, usePlayer } from "@/domain/player/usePlayer";
import { useVolume } from "@/domain/player/useVolume";
import { readTrack } from "@/shared/api/playerState";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";
import {
	OutputCog,
	OutputDeviceList,
	type useOutputPage,
} from "./OutputDevices";
import { VolumeGlyph, VolumeSlider } from "./Volume";

export const TAKES_FOCUS = "[data-takes-focus]";

function explain(phase: ListenPhase, t: Translate): string | null {
	switch (phase.kind) {
		case "off":
		case "playing":
			return null;
		case "connecting":
			return t("listen.connecting");
		case "reconnecting":
			return t("listen.reconnecting");
		case "blocked":
			return t("listen.blocked");
		case "busy":
			return t("listen.busy");
		case "silent":
			return t("listen.stopped");
		case "failed":
			return phase.message;
	}
}

function silentFor(
	isHere: boolean,
	others: readonly { label: string }[],
	t: Translate,
): string {
	if (isHere) return t("listen.silentWithYou");
	if (others.length === 1)
		return t("listen.silentForOne", { device: others[0].label });
	return t("listen.silentForMany", { count: others.length });
}

const isBusy = (phase: ListenPhase) =>
	phase.kind === "connecting" || phase.kind === "reconnecting";

const drift = (lagSeconds: number | null, t: Translate) =>
	lagSeconds === null
		? t("listen.driftUnknown")
		: lagSeconds < 1.5
			? t("listen.driftSecond")
			: t("listen.driftSeconds", { seconds: Math.round(lagSeconds) });

function forHowLong(seconds: number, t: Translate): string {
	if (seconds < 60) return t("listen.forJustNow");
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return t("span.minutesShort", { count: minutes });
	return t("span.hoursShort", { count: Math.round(minutes / 60) });
}

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const keepArrowsFromApp = (event: ReactKeyboardEvent) => {
	if (!ARROWS.has(event.key)) return;
	event.preventDefault();
	event.stopPropagation();
};

export function PlayingOn({
	playerName,
	audience,
	outputPage,
	canControlPlayback,
	showsHeading,
	namesWhatPlays,
}: {
	playerName: string;
	audience: Audience;
	outputPage: ReturnType<typeof useOutputPage>;
	canControlPlayback: boolean;
	showsHeading: boolean;
	namesWhatPlays: boolean;
}) {
	const t = useTranslate();
	const { isOn, phase, canSetVolume, connect, disconnect, resume, retry } =
		useListener();
	const outputsQuery = useOutputs();
	const { data: snapshot } = usePlayer();
	const { volume, setValue } = useVolume();
	const isPlaying = useIsPlaying();
	const isOffered = useIsListeningOfferedFirst(isOn);

	const headingId = useId();
	const othersId = useId();
	const secondLineId = useId();
	const deviceNoteId = useId();
	const noSpeakersId = useId();

	const groupRef = useRef<HTMLDivElement | null>(null);
	const pressedToSwap = useRef(false);
	const swapByPress = (act: () => void) => {
		pressedToSwap.current = true;
		act();
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isOn` fires this rather than being read in it.
	useLayoutEffect(() => {
		const pressed = pressedToSwap.current;
		pressedToSwap.current = false;
		if (!pressed || document.activeElement !== document.body) return;
		groupRef.current
			?.querySelector<HTMLElement>(TAKES_FOCUS)
			?.focus({ preventScroll: true });
	}, [isOn]);

	if (outputPage.showsOutputs)
		return (
			<OutputDeviceList
				devices={outputsQuery.devices}
				activeId={snapshot?.player?.outputDeviceId ?? null}
				onChoose={outputsQuery.choose}
				onBack={outputPage.close}
				subtitle={playerName}
			/>
		);

	const others = otherListeners(audience);
	const held = playerHeld(audience);
	const note = explain(phase, t);
	const playerMuted = volume?.isMuted === true;
	const playerAudible = !playerMuted;
	const showOutputCog = isOn && outputsQuery.isAvailable;

	// `playerMuted` reads `player.volume.isMuted` off the poll, which can lag up to a second behind
	// `foo_jean` muting the player the instant this device's stream connects. `isOn` tracks this
	// device's own connection at once, with one exception: a stream gone silently dead still reads as
	// connected until the stall watchdog notices, up to `STALL_MS` later. Short of that, once this
	// device is the only listener it is itself the sign that the player is muted.
	const canHandBack = isOn && others.length === 0;

	let secondLine: string | null = null;
	if (playerAudible) secondLine = isOn ? drift(audience.lagSeconds, t) : null;
	else if (held && others.length > 0) secondLine = silentFor(isOn, others, t);

	const track = namesWhatPlays ? readTrack(snapshot?.player) : null;
	if (secondLine === null && track)
		secondLine = t("listen.playingTrack", {
			title: track.title,
			artist: track.artist,
		});

	const playerFace = (
		<>
			<span className={styles.tile} data-hears={isOn}>
				<MonitorSpeaker size={16} strokeWidth={2} aria-hidden="true" />
			</span>
			<span className={styles.title}>
				<span className={styles.name}>{playerName}</span>
				{playerAudible ? (
					<span className={styles.playing}>
						<Equalizer
							label={t("listen.playingOn", { player: playerName })}
							paused={!isPlaying}
						/>
					</span>
				) : null}
			</span>
		</>
	);

	const faceDescribedBy =
		[isOffered ? noSpeakersId : null, secondLine ? secondLineId : null]
			.filter(Boolean)
			.join(" ") || undefined;

	const hasInside = isOn || note !== null || others.length > 0;

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither
		<div
			role="group"
			aria-label={showsHeading ? undefined : t("listen.playingOnHeading")}
			aria-labelledby={showsHeading ? headingId : undefined}
			ref={groupRef}
		>
			{showsHeading ? (
				<p className={styles.heading} id={headingId}>
					{t("listen.playingOnHeading")}
				</p>
			) : null}

			<ul className={styles.rows}>
				<li className={styles.place} aria-current="true">
					<div className={styles.row} data-offered={isOffered}>
						{isOn ? (
							<div className={styles.face}>{playerFace}</div>
						) : (
							<button
								type="button"
								className={styles.face}
								aria-label={t("listen.here")}
								aria-describedby={faceDescribedBy}
								data-takes-focus=""
								onClick={() => swapByPress(connect)}
								onKeyDown={keepArrowsFromApp}
							>
								{playerFace}
								<span className={styles.verb}>
									{isOffered ? (
										<Headphones
											size={13}
											strokeWidth={2.5}
											aria-hidden="true"
										/>
									) : null}
									{t("listen.here")}
								</span>
								{isOffered ? (
									<span className={styles.noSpeakers} id={noSpeakersId}>
										{t("listen.noSpeakers", { player: playerName })}
									</span>
								) : null}
							</button>
						)}

						{volume || showOutputCog ? (
							<span className={styles.cell}>
								{volume ? (
									<span className={styles.fader}>
										<VolumeGlyph volume={volume} />
										<VolumeSlider
											volume={volume}
											onChange={setValue}
											className={styles.slider}
											label={t("listen.volumeOn", { player: playerName })}
											disabled={!canControlPlayback}
										/>
									</span>
								) : null}

								{showOutputCog ? (
									<OutputCog
										onClick={() => outputPage.open(outputsQuery.refetch)}
										autoFocus={outputPage.returnFocus}
									/>
								) : null}
							</span>
						) : null}

						{secondLine ? (
							<p className={styles.secondLine} id={secondLineId}>
								{secondLine}
							</p>
						) : null}
					</div>

					{hasInside ? (
						<div className={styles.inside}>
							{isOn ? (
								<div className={styles.listening}>
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
										{t("listen.listeningHere")}
									</span>
									<button
										type="button"
										className={styles.pill}
										aria-label={
											canHandBack
												? t("listen.handBack", { player: playerName })
												: t("listen.stopHere")
										}
										aria-describedby={note ? deviceNoteId : undefined}
										data-takes-focus=""
										onClick={() => swapByPress(disconnect)}
									>
										{t("action.stop")}
									</button>
								</div>
							) : null}

							{note ? (
								<p
									className={styles.note}
									id={deviceNoteId}
									data-tone={phase.kind}
								>
									{note}
								</p>
							) : null}

							{/* No await in front of this call: an await loses the user gesture browsers require to start audio. */}
							{phase.kind === "blocked" ? (
								<button
									type="button"
									className={styles.unblock}
									onClick={() => resume()}
								>
									<Play size={13} strokeWidth={2.5} aria-hidden="true" />
									{t("listen.startPlaying")}
								</button>
							) : null}

							{phase.kind === "failed" ? (
								<button
									type="button"
									className={styles.unblock}
									onClick={() => retry()}
								>
									<RotateCcw size={13} strokeWidth={2.5} aria-hidden="true" />
									{t("action.tryAgain")}
								</button>
							) : null}

							{isOn && !canSetVolume ? (
								<p className={styles.level}>{t("listen.ownLevel")}</p>
							) : null}

							{others.length > 0 ? (
								<>
									<p
										className={classNames(styles.heading, styles.subhead)}
										id={othersId}
									>
										{t("listen.alsoListening")}
									</p>
									<ul className={styles.roster} aria-labelledby={othersId}>
										{others.map((device) => (
											<li className={styles.listener} key={device.deviceId}>
												<span className={styles.mark}>
													<Equalizer paused={!isPlaying} />
												</span>
												<span className={styles.listenerName}>
													{device.label}
												</span>
												<span className={styles.listenerFor}>
													{forHowLong(device.listeningFor, t)}
												</span>
											</li>
										))}
									</ul>
								</>
							) : null}
						</div>
					) : null}
				</li>
			</ul>
		</div>
	);
}
