import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import {
	SETTINGS_KEYBOARD,
	useKeyboardOwnership,
} from "@/shared/keyboard/keyboardOwner";
import { Appearance } from "./Appearance";
import { ArtistInformation } from "./ArtistInformation";
import { Language } from "./Language";
import { Playback } from "./Playback";
import styles from "./Settings.module.css";
import { TagWriting } from "./TagWriting";
import { ThisDevice } from "./ThisDevice";

export function SettingsDialog({ onDismiss }: { onDismiss: () => void }) {
	const t = useTranslate();
	const dialogRef = useRef<HTMLDivElement | null>(null);

	useKeyboardOwnership(SETTINGS_KEYBOARD);

	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;

	// Capture phase: the hotkey manager binds keydown on the document at bubble, where Escape also clears the track selection behind the scrim.
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		dialogRef.current?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				dismiss.current();
				return;
			}

			if (event.key !== "Tab") return;
			const dialog = dialogRef.current;
			if (!dialog) return;

			const focusable = [
				...dialog.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			];
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) return;

			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			opener?.focus?.();
		};
	}, []);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a dismissal scrim, not a control
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget) onDismiss();
			}}
		>
			<div
				ref={dialogRef}
				className={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				tabIndex={-1}
			>
				<header className={styles.header}>
					<h1 className={styles.title} id="settings-title">
						{t("settings.title")}
					</h1>

					<button
						type="button"
						className={styles.close}
						onClick={onDismiss}
						aria-label={t("settings.close")}
					>
						<kbd className={styles.cap}>Esc</kbd>
						<X size={16} strokeWidth={2} aria-hidden="true" />
					</button>
				</header>

				<div className={styles.body}>
					<TagWriting />
					<Appearance />
					<Language />
					<Playback />
					<ThisDevice />
					<ArtistInformation />
				</div>
			</div>
		</div>
	);
}
