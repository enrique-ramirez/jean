import { Loader2, MonitorSpeaker, Play, RotateCcw } from "lucide-react";
import { type CSSProperties, useId, useLayoutEffect, useState } from "react";

import {
	otherListeners,
	playerHeld,
	useAudience,
	type Watching,
} from "@/domain/player/audience";
import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import { useIsPlaying, usePlayer, useVolume } from "@/domain/player/usePlayer";
import { permitsPlaybackControl } from "@/shared/api/fooJean";
import type { PlayerInfo } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";
import { OutputCog, OutputDeviceList, useOutputPage } from "./OutputDevices";
import { VolumeGlyph, VolumeSlider } from "./Volume";

export const playerNameOf = (info: PlayerInfo) => info.name;

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

const audienceMode = (
	canListen: boolean,
	looking: boolean,
	playerMuted: boolean,
): Watching => {
	if (!canListen) return "off";
	if (looking) return "open";
	return playerMuted ? "background" : "off";
};

const withOthers = (label: string, others: number, t: Translate) =>
	others === 0 ? label : t("listen.andOthers", { label, count: others });

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

export function ListenHere({ playerName }: { playerName: string }) {
	const t = useTranslate();
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

	// The output device picker's other two hosts move here instead while this device is listening,
	// for the reason `domain/player/CLAUDE.md` gives: this panel's own fader is the one still
	// reaching foobar2000.
	const outputPage = useOutputPage(isOpen);
	const outputsQuery = useOutputs();
	const { data: snapshot } = usePlayer();
	const showOutputCog = isOn && outputsQuery.isAvailable;

	const headingId = useId();
	const othersId = useId();
	const playerNoteId = useId();
	const deviceNoteId = useId();

	const { volume, setValue } = useVolume();
	const { discovery } = useFooJean();
	const canControlPlayback = permitsPlaybackControl(discovery);
	const playerMuted = volume?.isMuted === true;
	const isPlaying = useIsPlaying();

	const audience = useAudience(
		audienceMode(canListen, isOpen || isOn, playerMuted),
	);
	const others = otherListeners(audience);
	const held = playerHeld(audience);

	if (!canListen) return null;

	const note = explain(phase, t);

	const playerAudible = !playerMuted;

	// `playerMuted` reads `player.volume.isMuted` off the poll, which can lag up to a second behind
	// `foo_jean` muting the player the instant this device's stream connects. `isOn` tracks this
	// device's own connection at once, with one exception: a stream gone silently dead still reads as
	// connected until the stall watchdog notices, up to `STALL_MS` later. Short of that, once this
	// device is the only listener it is itself the sign that the player is muted.
	const canHandBack = isOn && others.length === 0;

	let playerNote: string | null = null;
	if (playerAudible) playerNote = isOn ? drift(audience.lagSeconds, t) : null;
	else if (canHandBack)
		playerNote = t("listen.handBack", { player: playerName });
	else if (held && others.length > 0) playerNote = silentFor(isOn, others, t);

	const playerFace = (
		<>
			<span className={styles.mark}>
				{playerAudible ? (
					<Equalizer
						label={t("listen.playingOn", { player: playerName })}
						paused={!isPlaying}
					/>
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
					{outputPage.showsOutputs ? (
						<OutputDeviceList
							devices={outputsQuery.devices}
							activeId={snapshot?.player?.outputDeviceId ?? null}
							onChoose={outputsQuery.choose}
							onBack={outputPage.close}
							subtitle={playerName}
						/>
					) : (
						<>
							{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither */}
							<div role="group" aria-labelledby={headingId}>
								<p className={styles.heading} id={headingId}>
									{t("listen.playingOnHeading")}
								</p>

								<div className={styles.row}>
									{canHandBack ? (
										<button
											type="button"
											className={`${styles.face} ${styles.option}`}
											aria-label={t("listen.handBack", { player: playerName })}
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
										aria-label={t(isOn ? "listen.stopHere" : "listen.here")}
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
											{t(isOn ? "listen.listeningHere" : "listen.here")}
										</span>
										{isOn ? (
											<span className={styles.stop}>{t("action.stop")}</span>
										) : null}
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
									<p className={styles.heading} id={othersId}>
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
						</>
					)}
				</div>
			) : null}

			<button
				type="button"
				className={styles.button}
				aria-label={
					isOn
						? withOthers(t("listen.onThisDevice"), others.length, t)
						: withOthers(t("listen.chooseWhere"), others.length, t)
				}
				aria-expanded={isOpen}
				aria-pressed={isOn}
				title={
					isOn
						? t("listen.onThisDevice")
						: t("listen.playingOn", { player: playerName })
				}
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
