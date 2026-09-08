import { formatForDisplay } from "@tanstack/react-hotkeys";

import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwnership } from "./keyboardOwner";
import { type Binding, bindingsIn, KEYMAP_GROUPS } from "./keymap";
import styles from "./ShortcutSheet.module.css";

export const SHORTCUTS_KEYBOARD = "shortcuts";

const capsOf = (binding: Binding) =>
	(binding.shown ?? binding.keys.map((key) => formatForDisplay(key))).map(
		(chord) => chord.split(" ").filter(Boolean),
	);

export function ShortcutSheet({ onDismiss }: { onDismiss: () => void }) {
	const t = useTranslate();
	useKeyboardOwnership(SHORTCUTS_KEYBOARD);
	useEscapeCapture(onDismiss);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a dismissal scrim, not a control; Escape is the keyboard route out
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget) onDismiss();
			}}
		>
			<div
				className={styles.sheet}
				role="dialog"
				aria-modal="true"
				aria-label={t("shortcuts.title")}
			>
				<h2 className={styles.title}>{t("shortcuts.title")}</h2>
				<p className={styles.subtitle}>
					<Trans
						phrase="shortcuts.subtitle"
						find={<kbd className={styles.cap}>/</kbd>}
						search={
							<span className={styles.chord}>
								{formatForDisplay("Mod+k")
									.split(" ")
									.map((cap) => (
										<kbd key={cap} className={styles.cap}>
											{cap}
										</kbd>
									))}
							</span>
						}
					/>
				</p>

				{KEYMAP_GROUPS.map((group) => (
					<section key={group} className={styles.group}>
						<h3 className={styles.groupTitle}>{t(group)}</h3>
						{bindingsIn(group).map((binding) => (
							<div key={binding.id} className={styles.row}>
								<span>{t(binding.name)}</span>
								<span className={styles.keys}>
									{/* A hotkey may be an object rather than a string, so the rendered spelling keys the row. */}
									{capsOf(binding).map((chord) => (
										<span key={chord.join("+")} className={styles.chord}>
											{chord.map((cap) => (
												<kbd key={cap} className={styles.cap}>
													{cap}
												</kbd>
											))}
										</span>
									))}
								</span>
							</div>
						))}
					</section>
				))}
			</div>
		</div>
	);
}
