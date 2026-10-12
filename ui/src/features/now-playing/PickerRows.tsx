import {
	Headphones,
	Info,
	Lock,
	type LucideIcon,
	MonitorSpeaker,
	Plus,
	Users,
} from "lucide-react";
import { type ReactNode, useId } from "react";

import { deviceId } from "@/domain/player/device";
import { useSessionId } from "@/domain/player/session";
import { creatorOf, useDocumentOf } from "@/domain/player/sessionDocument";
import type { ListedSession } from "@/domain/player/sessionList";
import type { SessionDocument } from "@/shared/api/sessions";
import {
	type Translate,
	useSpoken,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { Equalizer } from "@/shared/ui/Equalizer";
import { SwitchTrack } from "@/shared/ui/SwitchTrack";
import styles from "./ListenHere.module.css";

export const whatPlaysIn = (document: SessionDocument, t: Translate) =>
	document.title === null
		? t("player.nothingPlaying")
		: t("listen.playingTrack", {
				title: document.title,
				artist: document.artist ?? t("track.unknownArtist"),
			});

const joinRefused = (playerName: string, t: Translate) =>
	t("listen.joinRefused", { player: playerName });

export interface StartedBy {
	label: string;
	isThisDevice: boolean;
}

export function useStartedBy(): StartedBy | null {
	const t = useTranslate();
	const sessionId = useSessionId();
	const sessionDocument = useDocumentOf(sessionId);
	if (sessionId === null) return null;
	const createdBy = sessionDocument
		? sessionDocument.createdBy
		: creatorOf(sessionId);
	if (createdBy === undefined) return null;
	return {
		label: createdBy?.name ?? t("device.unknown"),
		isThisDevice: createdBy?.deviceId === deviceId(),
	};
}

const initialOf = (label: string) => (Array.from(label)[0] ?? "").toUpperCase();

export function SessionDisc({
	label,
	hears,
	className,
}: {
	label: string;
	hears: boolean;
	className?: string;
}) {
	return (
		<span
			className={classNames(styles.disc, className)}
			data-hears={hears}
			aria-hidden="true"
		>
			{initialOf(label)}
		</span>
	);
}

export function PlayerRow({
	playerName,
	isCurrent,
	hears,
	isOffered,
	showsPlaying,
	isPlaying,
	secondLine,
	onListen,
	beside,
	children,
}: {
	playerName: string;
	isCurrent: boolean;
	hears: boolean;
	isOffered: boolean;
	showsPlaying: boolean;
	isPlaying: boolean;
	secondLine: string | null;
	onListen: (() => void) | null;
	beside: ReactNode;
	children: ReactNode;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const secondLineId = useId();
	const noSpeakersId = useId();

	const face = (
		<>
			<span className={styles.tile} data-hears={hears}>
				<MonitorSpeaker size={16} strokeWidth={2} aria-hidden="true" />
			</span>
			<span className={styles.title}>
				<span className={styles.name}>{playerName}</span>
				{showsPlaying ? (
					<span className={styles.playing}>
						<Equalizer
							label={say("listen.playingOn", { player: playerName })}
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

	return (
		<li className={styles.place} aria-current={isCurrent ? "true" : undefined}>
			<div className={styles.row} data-offered={isOffered}>
				{onListen ? (
					<button
						type="button"
						className={styles.face}
						aria-label={t("listen.here")}
						aria-describedby={faceDescribedBy}
						data-takes-focus=""
						data-row-stop=""
						onClick={onListen}
					>
						{face}
						<span className={styles.verb}>
							{isOffered ? (
								<Headphones size={13} strokeWidth={2.5} aria-hidden="true" />
							) : null}
							{t("listen.here")}
						</span>
						{isOffered ? (
							<span className={styles.noSpeakers} id={noSpeakersId}>
								{t("listen.noSpeakers", { player: playerName })}
							</span>
						) : null}
					</button>
				) : (
					<div className={styles.face}>{face}</div>
				)}

				{beside}

				{secondLine ? (
					<p className={styles.secondLine} id={secondLineId}>
						{secondLine}
					</p>
				) : null}
			</div>

			{children}
		</li>
	);
}

export function SessionRow({
	startedBy,
	hears,
	whatPlays,
	isPrivate,
	isRefused,
	playerName,
	onListen,
	children,
}: {
	startedBy: StartedBy | null;
	hears: boolean;
	whatPlays: string | null;
	isPrivate: boolean;
	isRefused: boolean;
	playerName: string;
	onListen: (() => void) | null;
	children: ReactNode;
}) {
	const t = useTranslate();
	const wordsId = useId();
	const isThisDevice = startedBy?.isThisDevice === true;
	const hasSecondLine = isRefused || isThisDevice || whatPlays !== null;

	const face = (
		<>
			{startedBy ? (
				<SessionDisc label={startedBy.label} hears={hears} />
			) : (
				<span className={styles.disc} aria-hidden="true" />
			)}
			<span className={styles.words} id={wordsId}>
				{startedBy ? (
					<span className={styles.name}>{startedBy.label}</span>
				) : null}
				{isRefused ? (
					<span className={styles.sub}>{joinRefused(playerName, t)}</span>
				) : hasSecondLine ? (
					<span className={styles.sub}>
						{isThisDevice ? (
							<span className={styles.mine}>{t("device.title")}</span>
						) : null}
						{whatPlays ? (
							<span className={styles.what}>{whatPlays}</span>
						) : null}
					</span>
				) : null}
			</span>
		</>
	);

	return (
		<li className={styles.place} aria-current="true">
			<div className={styles.row}>
				{onListen ? (
					<button
						type="button"
						className={styles.face}
						aria-label={t("listen.here")}
						aria-describedby={wordsId}
						data-takes-focus=""
						data-row-stop=""
						onClick={onListen}
					>
						{face}
						<span className={styles.verb}>{t("listen.here")}</span>
					</button>
				) : (
					<div className={styles.face}>{face}</div>
				)}
				{isPrivate ? (
					<span className={classNames(styles.cell, styles.private)}>
						<Lock size={12} strokeWidth={2.2} aria-hidden="true" />
						{t("listen.private")}
					</span>
				) : null}
			</div>
			{children}
		</li>
	);
}

export function ShareRow({
	isShared,
	onFlip,
}: {
	isShared: boolean;
	onFlip: (shared: boolean) => void;
}) {
	const t = useTranslate();
	const switchId = useId();
	const presentId = useId();

	return (
		<div className={styles.share}>
			<span className={styles.mark}>
				<Users size={14} strokeWidth={2.2} aria-hidden="true" />
			</span>
			<span className={styles.words}>
				<label className={styles.name} htmlFor={switchId}>
					{t("listen.share")}
				</label>
				<span className={styles.sub} id={presentId}>
					{isShared ? t("listen.shareOn") : t("listen.shareOff")}
				</span>
			</span>
			<button
				type="button"
				role="switch"
				id={switchId}
				className={styles.toggle}
				aria-checked={isShared}
				aria-describedby={presentId}
				onClick={() => onFlip(!isShared)}
			>
				<SwitchTrack checked={isShared} />
			</button>
		</div>
	);
}

export function ListedRow({
	session,
	playerName,
	isRefused,
	onListen,
	onControl,
}: {
	session: ListedSession;
	playerName: string;
	isRefused: boolean;
	onListen: () => void;
	onControl: () => void;
}) {
	const t = useTranslate();
	const subId = useId();
	const { document, label, isOwn } = session;

	return (
		<li className={styles.place}>
			<div className={styles.row}>
				<button
					type="button"
					className={classNames(styles.face, styles.listed)}
					aria-label={t("listen.joinNamed", { device: label })}
					aria-describedby={subId}
					data-row-stop=""
					onClick={onListen}
				>
					<SessionDisc label={label} hears={false} />
					<span className={styles.name}>{label}</span>
					<span className={styles.verb}>{t("listen.join")}</span>
					<span className={styles.sub} id={subId}>
						{isRefused ? (
							joinRefused(playerName, t)
						) : (
							<>
								{isOwn ? (
									<span className={styles.mine}>{t("device.title")}</span>
								) : null}
								<span className={styles.what}>{whatPlaysIn(document, t)}</span>
								<span className={styles.count}>
									{document.listeners === 0
										? t("listen.nobodyListening")
										: t("listen.listenerCount", { count: document.listeners })}
								</span>
							</>
						)}
					</span>
				</button>
				{document.listeners > 0 ? (
					<span className={styles.cell}>
						<button
							type="button"
							className={styles.pill}
							aria-label={t("listen.controlNamed", { device: label })}
							title={t("listen.controlNamed", { device: label })}
							data-row-beside=""
							onClick={onControl}
						>
							{t("listen.control")}
						</button>
					</span>
				) : null}
			</div>
		</li>
	);
}

export function EndedRow({ session }: { session: ListedSession }) {
	const t = useTranslate();
	const { label } = session;

	return (
		<li className={classNames(styles.place, styles.ended)}>
			<div className={styles.row}>
				<div className={classNames(styles.face, styles.listed)}>
					<SessionDisc label={label} hears={false} />
					<span className={styles.name}>{label}</span>
					<span className={styles.sub}>{t("listen.goneBeforeJoin")}</span>
				</div>
			</div>
		</li>
	);
}

export function StandingLine({
	glyph: Glyph,
	tone,
	id,
	children,
}: {
	glyph: LucideIcon;
	tone: "plain" | "caution";
	id?: string;
	children: ReactNode;
}) {
	return (
		<p className={styles.standing} data-tone={tone} id={id}>
			<span className={styles.mark}>
				<Glyph size={14} strokeWidth={2.2} aria-hidden="true" />
			</span>
			{children}
		</p>
	);
}

export function StartRow({
	playerName,
	isPlayerFull,
	onStart,
}: {
	playerName: string;
	isPlayerFull: boolean;
	onStart: () => void;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const detailId = useId();
	const busyId = useId();

	return (
		<li className={styles.place}>
			<div className={styles.row}>
				<button
					type="button"
					className={classNames(styles.face, styles.start)}
					aria-label={say("listen.start")}
					aria-describedby={isPlayerFull ? `${detailId} ${busyId}` : detailId}
					onClick={onStart}
					data-row-stop=""
				>
					<span className={styles.newDisc} aria-hidden="true">
						<Plus size={14} strokeWidth={2} />
					</span>
					<span className={styles.words}>
						<span className={styles.name}>{t("listen.start")}</span>
						<span className={styles.sub} id={detailId}>
							{t("listen.startDetail", { player: playerName })}
						</span>
					</span>
				</button>
			</div>
			{isPlayerFull ? (
				<StandingLine glyph={Info} tone="plain" id={busyId}>
					{t("listen.playerBusy", { player: playerName })}
				</StandingLine>
			) : null}
		</li>
	);
}
