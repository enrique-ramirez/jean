import { Loader2, VolumeOff } from "lucide-react";
import { type ReactNode, useId } from "react";

import type { LabelledListener } from "@/domain/player/audience";
import type { ListenPhase } from "@/domain/player/useListener";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { Equalizer } from "@/shared/ui/Equalizer";
import styles from "./ListenHere.module.css";

const isBusy = (phase: ListenPhase) =>
	phase.kind === "connecting" || phase.kind === "reconnecting";

function forHowLong(seconds: number, t: Translate): string {
	if (seconds < 60) return t("listen.forJustNow");
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return t("span.minutesShort", { count: minutes });
	return t("span.hoursShort", { count: Math.round(minutes / 60) });
}

export function ListeningLine({
	phase,
	isPlaying,
	listensHere,
	onlyControls,
	children,
}: {
	phase: ListenPhase;
	isPlaying: boolean;
	listensHere: boolean;
	onlyControls: boolean;
	children: ReactNode;
}) {
	const t = useTranslate();

	return (
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
			{children}
		</div>
	);
}

export function OtherListeners({
	others,
	isPlaying,
	onlyControls,
}: {
	others: readonly LabelledListener[];
	isPlaying: boolean;
	onlyControls: boolean;
}) {
	const t = useTranslate();
	const headingId = useId();

	return (
		<>
			<p className={classNames(styles.heading, styles.subhead)} id={headingId}>
				{onlyControls ? t("listen.listeningNow") : t("listen.alsoListening")}
			</p>
			<ul className={styles.roster} aria-labelledby={headingId}>
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
	);
}
