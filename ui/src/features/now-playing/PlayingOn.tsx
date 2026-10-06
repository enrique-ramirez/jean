import {
	Headphones,
	Loader2,
	MonitorSpeaker,
	Play,
	RotateCcw,
	TriangleAlert,
	VolumeOff,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {
	type Audience,
	otherListeners,
	playerHeld,
} from "@/domain/player/audience";
import { useIsListeningOfferedFirst } from "@/domain/player/offersListening";
import { sessionEpoch, useSession } from "@/domain/player/session";
import { useDocumentOf } from "@/domain/player/sessionDocument";
import { type ListedSession, useSessions } from "@/domain/player/sessionList";
import {
	type SessionOutcome,
	useSessionActions,
} from "@/domain/player/sessionOperations";
import { type ListenPhase, useListener } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import { useIsPlaying, usePlayer } from "@/domain/player/usePlayer";
import { useVolume } from "@/domain/player/useVolume";
import { readTrack } from "@/shared/api/playerState";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { rovedIndex } from "@/shared/lib/rove";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";
import {
	OutputCog,
	OutputDeviceList,
	type useOutputPage,
} from "./OutputDevices";
import {
	EndedRow,
	ListedRow,
	ROW_BESIDE,
	ROW_STOP,
	SessionRow,
	ShareRow,
	StandingLine,
	type StartedBy,
	StartRow,
	usePressedRows,
	useStartedBy,
	whatPlaysIn,
} from "./PickerRows";
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

const NO_SESSIONS: readonly ListedSession[] = [];

type FocusAfter = "ifLost" | { awayFrom: string | null };

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function acrossRow(row: Element, key: string, from: EventTarget) {
	const face = row.querySelector<HTMLElement>(ROW_STOP);
	const beside = row.querySelector<HTMLElement>(ROW_BESIDE);
	if (key === "ArrowRight" && from === face) return beside;
	if (key === "ArrowLeft" && from === beside) return face;
	return null;
}

function roveRows(event: ReactKeyboardEvent, list: HTMLUListElement | null) {
	if (!ARROWS.has(event.key) || !list) return;
	if (
		event.target instanceof HTMLElement &&
		event.target.getAttribute("role") === "slider"
	)
		return;
	event.stopPropagation();
	event.preventDefault();

	if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
		const row = [...list.children].find((held) =>
			held.contains(event.target as Node),
		);
		if (row) acrossRow(row, event.key, event.target)?.focus();
		return;
	}

	const stops = [...list.children].flatMap(
		(row) => row.querySelector<HTMLElement>(ROW_STOP) ?? [],
	);
	const at = stops.findIndex((stop) =>
		stop.closest("li")?.contains(event.target as Node),
	);
	const next = rovedIndex(event.key, at, stops.length, { wrap: true });
	if (next !== null) stops[next]?.focus();
}

export function PlayingOn({
	playerName,
	audience,
	outputPage,
	canControlPlayback,
	canStartSessions,
	showsHeading,
	namesWhatPlays,
	isOpen,
}: {
	playerName: string;
	audience: Audience;
	outputPage: ReturnType<typeof useOutputPage>;
	canControlPlayback: boolean;
	canStartSessions: boolean;
	showsHeading: boolean;
	namesWhatPlays: boolean;
	isOpen: boolean;
}) {
	const t = useTranslate();
	const { isOn, phase, canSetVolume, connect, disconnect, resume, retry } =
		useListener();
	const outputsQuery = useOutputs();
	const { data: snapshot } = usePlayer();
	const { volume, setValue } = useVolume();
	const isPlaying = useIsPlaying();
	const isOffered = useIsListeningOfferedFirst(isOn);
	const session = useSession();
	const inSession = session.id !== null;
	const sessionDocument = useDocumentOf(session.id);
	const playsWithoutEffects = sessionDocument?.chainDropped === true;
	const isShared = sessionDocument?.shared;
	const startedBy = useStartedBy();
	const { start, leave, share, listen, listenTo, control } =
		useSessionActions();
	const list = useSessions(isOpen);
	const {
		rows: listed,
		markEnded,
		markRefused,
	} = usePressedRows(list?.sessions ?? NO_SESSIONS);

	const headingId = useId();
	const othersId = useId();
	const secondLineId = useId();
	const deviceNoteId = useId();
	const onlyListenerId = useId();
	const noSpeakersId = useId();

	const groupRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<HTMLUListElement | null>(null);
	const focusAfter = useRef<FocusAfter | null>(null);
	const swapByPress = (act: () => void) => {
		focusAfter.current = "ifLost";
		act();
	};
	const [isPlayerFull, setIsPlayerFull] = useState(false);
	const [refusedInEpoch, setRefusedInEpoch] = useState<number | null>(null);
	const listenWhereControlled = async () => {
		const pressedIn = sessionEpoch();
		const outcome = await listen();
		if (outcome.ok) setRefusedInEpoch(null);
		else if (outcome.reason !== "pending" && outcome.reason !== "gone")
			setRefusedInEpoch(pressedIn);
	};
	const startHere = async () => {
		const outcome = await start();
		if (outcome.ok || outcome.reason !== "pending")
			setIsPlayerFull(!outcome.ok && outcome.reason === "full");
		return outcome;
	};
	const moveByPress = (act: () => Promise<SessionOutcome>) => {
		const awaiting = { awayFrom: session.id };
		focusAfter.current = awaiting;
		void act().then((outcome) => {
			const isStillAwaited = focusAfter.current === awaiting;
			if (!outcome.ok && outcome.reason !== "pending" && isStillAwaited)
				focusAfter.current = null;
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isOn` fires this rather than being read in it.
	useLayoutEffect(() => {
		const after = focusAfter.current;
		if (after === null) return;
		if (after !== "ifLost" && after.awayFrom === session.id) return;
		focusAfter.current = null;
		if (after === "ifLost" && document.activeElement !== document.body) return;
		groupRef.current
			?.querySelector<HTMLElement>(TAKES_FOCUS)
			?.focus({ preventScroll: true });
	}, [isOn, session.id]);

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
	const showOutputCog = !inSession && isOn && outputsQuery.isAvailable;

	// `playerMuted` reads `player.volume.isMuted` off the poll, which can lag up to a second behind
	// `foo_jean` muting the player the instant this device's stream connects. `isOn` tracks this
	// device's own connection at once, with one exception: a stream gone silently dead still reads as
	// connected until the stall watchdog notices, up to `STALL_MS` later. Short of that, once this
	// device is the only listener it is itself the sign that the player is muted.
	const canHandBack = isOn && others.length === 0;
	const isOnlyListener =
		inSession && isOn && audience.listeners !== null && others.length === 0;

	const track = namesWhatPlays ? readTrack(snapshot?.player) : null;
	const whatPlays = track
		? t("listen.playingTrack", { title: track.title, artist: track.artist })
		: null;

	let secondLine: string | null = null;
	if (inSession) {
		secondLine = list?.player ? whatPlaysIn(list.player, t) : null;
	} else {
		if (playerAudible) secondLine = isOn ? drift(audience.lagSeconds, t) : null;
		else if (held && others.length > 0) secondLine = silentFor(isOn, others, t);
		secondLine ??= whatPlays;
	}

	const playerFace = (
		<>
			<span className={styles.tile} data-hears={!inSession && isOn}>
				<MonitorSpeaker size={16} strokeWidth={2} aria-hidden="true" />
			</span>
			<span className={styles.title}>
				<span className={styles.name}>{playerName}</span>
				{playerAudible && !inSession && !isOffered ? (
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

	const hasListeningLine = inSession || isOn;
	const hasInside = hasListeningLine || note !== null || others.length > 0;
	const listensHere = inSession ? session.role === "listening" : isOn;
	const onlyControls = session.role === "controlling";
	const nobodyListens = onlyControls && sessionDocument?.listeners === 0;

	const wayOut = inSession ? (
		<button
			type="button"
			className={styles.pill}
			aria-label={t("listen.leaveNamed", { player: playerName })}
			title={t("listen.leaveNamed", { player: playerName })}
			aria-describedby={
				[isOnlyListener ? onlyListenerId : null, note ? deviceNoteId : null]
					.filter(Boolean)
					.join(" ") || undefined
			}
			data-takes-focus=""
			data-row-stop=""
			onClick={() => moveByPress(leave)}
		>
			{t("listen.leave")}
		</button>
	) : (
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
			data-row-stop=""
			onClick={() => swapByPress(disconnect)}
		>
			{t("action.stop")}
		</button>
	);

	const inside = hasInside ? (
		<div className={styles.inside}>
			{hasListeningLine ? (
				<div className={styles.listening} data-only-controls={onlyControls}>
					<span className={styles.mark}>
						{isBusy(phase) ? (
							<Loader2 size={14} strokeWidth={2.5} className={styles.spin} />
						) : phase.kind === "playing" ? (
							<Equalizer paused={!isPlaying} />
						) : onlyControls ? (
							<VolumeOff size={14} strokeWidth={2.2} aria-hidden="true" />
						) : null}
					</span>
					{listensHere ? (
						<span className={styles.name}>{t("listen.listeningHere")}</span>
					) : onlyControls ? (
						<span className={styles.name}>{t("listen.controlling")}</span>
					) : null}
					{wayOut}
				</div>
			) : null}

			{nobodyListens ? (
				<StandingLine glyph={TriangleAlert} tone="caution">
					{t("listen.nobodyNow", { player: playerName })}
				</StandingLine>
			) : null}

			{isOnlyListener ? (
				<p className={styles.note} id={onlyListenerId}>
					{t("listen.onlyListener")}
				</p>
			) : null}

			{note ? (
				<p className={styles.note} id={deviceNoteId} data-tone={phase.kind}>
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

			{playsWithoutEffects ? (
				<StandingLine glyph={TriangleAlert} tone="caution">
					{t("listen.withoutEffects")}
				</StandingLine>
			) : null}

			{others.length > 0 ? (
				<>
					<p
						className={classNames(styles.heading, styles.subhead)}
						id={othersId}
					>
						{onlyControls
							? t("listen.listeningNow")
							: t("listen.alsoListening")}
					</p>
					<ul className={styles.roster} aria-labelledby={othersId}>
						{others.map((device) => (
							<li className={styles.listener} key={device.deviceId}>
								<span className={styles.mark}>
									<Equalizer paused={!isPlaying} />
								</span>
								<span className={styles.listenerName}>{device.label}</span>
								<span className={styles.listenerFor}>
									{forHowLong(device.listeningFor, t)}
								</span>
							</li>
						))}
					</ul>
				</>
			) : null}

			{isShared !== undefined ? (
				<ShareRow isShared={isShared} onFlip={(shared) => void share(shared)} />
			) : null}
		</div>
	) : null;

	const listedHere = listed.find(
		({ session: entry }) => entry.document.id === session.id,
	)?.session;
	const hereStartedBy: StartedBy | null = listedHere
		? { label: listedHere.label, isThisDevice: listedHere.isOwn }
		: startedBy;
	const joinFrom = (
		entry: ListedSession,
		index: number,
		join: (id: string) => Promise<SessionOutcome>,
	) =>
		moveByPress(async () => {
			const outcome = await join(entry.document.id);
			if (outcome.ok) markRefused(entry, false);
			else if (outcome.reason === "gone") markEnded(entry, index);
			return outcome;
		});
	const listenFrom = (entry: ListedSession, index: number) =>
		joinFrom(entry, index, async (id) => {
			const outcome = await listenTo(id);
			if (
				!outcome.ok &&
				outcome.reason !== "gone" &&
				outcome.reason !== "pending"
			)
				markRefused(entry, true);
			return outcome;
		});
	const hereRow = inSession ? (
		<SessionRow
			key={session.id}
			startedBy={hereStartedBy}
			hears={isOn}
			whatPlays={whatPlays}
			isPrivate={isShared === false}
			isRefused={refusedInEpoch === sessionEpoch()}
			playerName={playerName}
			onListen={onlyControls ? () => swapByPress(listenWhereControlled) : null}
		>
			{inside}
		</SessionRow>
	) : null;
	const sessionRows = listed.map(
		({ session: entry, hasEnded, isRefused }, index) =>
			entry === listedHere ? (
				hereRow
			) : hasEnded ? (
				<EndedRow key={entry.document.id} session={entry} />
			) : (
				<ListedRow
					key={entry.document.id}
					session={entry}
					playerName={playerName}
					isRefused={isRefused}
					onListen={() => listenFrom(entry, index)}
					onControl={() => joinFrom(entry, index, control)}
				/>
			),
	);
	if (!listedHere && hereRow) sessionRows.push(hereRow);

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a form control's styling and legend into a menu that is neither
		<div
			role="group"
			aria-label={showsHeading ? undefined : t("listen.playingOnHeading")}
			aria-labelledby={showsHeading ? headingId : undefined}
			ref={groupRef}
			onKeyDown={(event) => roveRows(event, rowsRef.current)}
		>
			{showsHeading ? (
				<p className={styles.heading} id={headingId}>
					{t("listen.playingOnHeading")}
				</p>
			) : null}

			<ul className={styles.rows} ref={rowsRef}>
				<li
					className={styles.place}
					aria-current={inSession ? undefined : "true"}
				>
					<div className={styles.row} data-offered={isOffered}>
						{hasListeningLine ? (
							<div className={styles.face}>{playerFace}</div>
						) : (
							<button
								type="button"
								className={styles.face}
								aria-label={t("listen.here")}
								aria-describedby={faceDescribedBy}
								data-takes-focus=""
								data-row-stop=""
								onClick={() => swapByPress(connect)}
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

					{inSession ? null : inside}
				</li>

				{sessionRows}

				{canStartSessions ? (
					<StartRow
						playerName={playerName}
						isPlayerFull={isPlayerFull}
						onStart={() => moveByPress(startHere)}
					/>
				) : null}
			</ul>
		</div>
	);
}
