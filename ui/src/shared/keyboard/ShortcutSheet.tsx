import { formatForDisplay } from "@tanstack/react-hotkeys";
import { useRef } from "react";

import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SHORTCUTS_KEYBOARD, useKeyboardOwnership } from "./keyboardOwner";
import { type Binding, bindingsIn, isAvailable, KEYMAP_GROUPS } from "./keymap";
import styles from "./ShortcutSheet.module.css";
import { useSingleKeyShortcuts } from "./useKeymap";

const capsOf = (binding: Binding) =>
	(binding.shown ?? binding.keys.map((key) => formatForDisplay(key))).map(
		(chord) => chord.split(" ").filter(Boolean),
	);

export function ShortcutSheet({ onDismiss }: { onDismiss: () => void }) {
	const t = useTranslate();
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const [singleKeys] = useSingleKeyShortcuts();
	useKeyboardOwnership(SHORTCUTS_KEYBOARD);
	useEscapeCapture(onDismiss);
	useTabTrap(sheetRef);

	const listed = (group: (typeof KEYMAP_GROUPS)[number]) =>
		bindingsIn(group).filter((binding) => isAvailable(binding, singleKeys));

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
				ref={sheetRef}
				className={styles.sheet}
				role="dialog"
				aria-modal="true"
				aria-label={t("shortcuts.title")}
				tabIndex={-1}
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

				{KEYMAP_GROUPS.filter((group) => listed(group).length > 0).map(
					(group) => (
						<section key={group} className={styles.group}>
							<h3 className={styles.groupTitle}>{t(group)}</h3>
							{listed(group).map((binding) => (
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
					),
				)}
			</div>
		</div>
	);
}
