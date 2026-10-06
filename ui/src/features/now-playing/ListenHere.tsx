import { MonitorSpeaker } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

import {
	otherListeners,
	useAudience,
	type Watching,
} from "@/domain/player/audience";
import { useIsListeningOfferedFirst } from "@/domain/player/offersListening";
import { useIsStartOffered } from "@/domain/player/offersStart";
import { useListener } from "@/domain/player/useListener";
import { useVolume } from "@/domain/player/useVolume";
import { permitsPlaybackControl } from "@/shared/api/discovery";
import type { PlayerInfo } from "@/shared/api/types";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { usePresence } from "@/shared/hooks/usePresence";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { keepPressFromBindings } from "@/shared/keyboard/keepPress";
import {
	PLAYING_ON_SHEET_KEYBOARD,
	useKeyboardOwnership,
} from "@/shared/keyboard/keyboardOwner";
import { BottomSheet, SHEET_EXIT_MS } from "@/shared/ui/BottomSheet";
import { useFocusCapture } from "@/shared/ui/menuKeys";
import styles from "./ListenHere.module.css";
import { useOutputPage } from "./OutputDevices";
import { SessionDisc, type StartedBy, useStartedBy } from "./PickerRows";
import { PlayingOn, TAKES_FOCUS } from "./PlayingOn";

function whereLabel(
	startedBy: StartedBy | null,
	isOn: boolean,
	t: Translate,
): string {
	if (startedBy) return t("listen.onStarted", { device: startedBy.label });
	return isOn ? t("listen.onThisDevice") : t("listen.chooseWhere");
}

export const playerNameOf = (info: PlayerInfo) => info.name;

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

export function ListenHere({ playerName }: { playerName: string }) {
	const t = useTranslate();
	const { canListen, isOn } = useListener();
	const [isOpen, setIsOpen] = useState(false);
	const noSpeakersId = useId();
	const isCompact = useIsCompactViewport();
	const isPopoverOpen = isOpen && !isCompact;

	const isSheetOpen = isOpen && isCompact;
	useKeyboardOwnership(PLAYING_ON_SHEET_KEYBOARD, isSheetOpen);
	const isSheetPresent = usePresence(isSheetOpen, SHEET_EXIT_MS);
	const isLeaving = isSheetPresent && !isSheetOpen;

	const openerRef = useRef<HTMLButtonElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const closePopover = () => {
		const hadFocus = popoverRef.current?.contains(document.activeElement);
		setIsOpen(false);
		if (hadFocus) openerRef.current?.focus({ preventScroll: true });
	};
	const ref = useDismissable<HTMLDivElement>(isPopoverOpen, closePopover, {
		tapOutsideOnlyDismisses: true,
	});
	const onPopoverKeyDown = (event: ReactKeyboardEvent) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closePopover();
		} else if (event.target instanceof HTMLButtonElement) {
			keepPressFromBindings(event);
		}
	};
	useFocusCapture(popoverRef, isPopoverOpen, TAKES_FOCUS);

	const [gap, setGap] = useState(0);
	useLayoutEffect(() => {
		if (!isPopoverOpen) return;
		const box = ref.current?.getBoundingClientRect();
		if (box) setGap(window.innerWidth - box.right);
	}, [isPopoverOpen, ref]);

	const outputPage = useOutputPage(isOpen || isLeaving);

	const { volume } = useVolume();
	const { discovery } = useFooJean();
	const playerMuted = volume?.isMuted === true;

	const audience = useAudience(
		audienceMode(canListen, isOpen || isOn, playerMuted),
	);
	const others = otherListeners(audience);
	const isOffered = useIsListeningOfferedFirst(isOn);
	const startedBy = useStartedBy();
	const canStartSessions = useIsStartOffered();

	if (!canListen) return null;

	const where = whereLabel(startedBy, isOn, t);

	const body = (
		<PlayingOn
			playerName={playerName}
			audience={audience}
			outputPage={outputPage}
			canControlPlayback={permitsPlaybackControl(discovery)}
			canStartSessions={canStartSessions}
			showsHeading={!isCompact}
			namesWhatPlays={isCompact}
			isOpen={isOpen}
		/>
	);

	return (
		<div className={styles.anchor} ref={ref}>
			{isPopoverOpen ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: the panel takes Escape, and Enter and Space on its buttons, before the keymap's listener on the document sees them
				<div
					ref={popoverRef}
					className={styles.popover}
					style={{ "--listen-gap": `${gap}px` } as CSSProperties}
					data-owns-touch=""
					onKeyDown={onPopoverKeyDown}
				>
					{body}
				</div>
			) : null}

			{isCompact && isSheetPresent
				? createPortal(
						<BottomSheet
							label={t("listen.playingOnHeading")}
							closeLabel={t("listen.closePicker")}
							isLeaving={isLeaving}
							layer="picker"
							initialFocus={TAKES_FOCUS}
							onDismiss={() => setIsOpen(false)}
						>
							<div className={styles.sheetBody}>{body}</div>
						</BottomSheet>,
						document.body,
					)
				: null}

			<button
				ref={openerRef}
				type="button"
				className={styles.button}
				aria-label={withOthers(where, others.length, t)}
				aria-expanded={isOpen}
				aria-pressed={isOn}
				aria-describedby={isOffered ? noSpeakersId : undefined}
				title={
					startedBy || isOn
						? where
						: t("listen.playingOn", { player: playerName })
				}
				data-listening={isOn}
				data-offered={isOffered}
				onClick={() => setIsOpen((open) => !open)}
				onKeyDown={keepPressFromBindings}
			>
				{startedBy ? (
					<SessionDisc
						label={startedBy.label}
						hears={isOn}
						className={styles.openerDisc}
					/>
				) : (
					<MonitorSpeaker size={17} strokeWidth={2} aria-hidden="true" />
				)}
				{others.length > 0 ? (
					<span className={styles.badge} aria-hidden="true">
						{others.length}
					</span>
				) : null}
			</button>
			{isOffered ? (
				<span hidden id={noSpeakersId}>
					{t("listen.noSpeakers", { player: playerName })}
				</span>
			) : null}
		</div>
	);
}
