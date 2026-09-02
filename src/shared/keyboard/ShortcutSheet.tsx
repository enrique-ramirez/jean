import { formatForDisplay } from "@tanstack/react-hotkeys";

import { type Binding, bindingsIn, KEYMAP_GROUPS } from "./keymap";
import styles from "./ShortcutSheet.module.css";

// `formatForDisplay` returns a whole chord in one string -- "⌘ ⇧ P" -- and a
// keycap is a key, so the chord is split back into its parts. Space-joined by
// the formatter, which is why a space is a safe separator here and the Space
// key comes back as `␣` rather than as a gap.
const capsOf = (binding: Binding) =>
	(binding.shown ?? binding.keys.map((key) => formatForDisplay(key))).map(
		(chord) => chord.split(" ").filter(Boolean),
	);

export function ShortcutSheet({ onDismiss }: { onDismiss: () => void }) {
	return (
		// A dismissal scrim, not a control: Escape is the keyboard route out and the
		// panel above owns it.
		// biome-ignore lint/a11y/noStaticElementInteractions: scrim, see above
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
				aria-label="Keyboard shortcuts"
			>
				<h2 className={styles.title}>Keyboard shortcuts</h2>
				<p className={styles.subtitle}>
					<kbd className={styles.cap}>/</kbd> filters the list you are looking
					at.{" "}
					<span className={styles.chord}>
						{formatForDisplay("Mod+k")
							.split(" ")
							.map((cap) => (
								<kbd key={cap} className={styles.cap}>
									{cap}
								</kbd>
							))}
					</span>{" "}
					searches everything.
				</p>

				{KEYMAP_GROUPS.map((group) => (
					<section key={group} className={styles.group}>
						<h3 className={styles.groupTitle}>{group}</h3>
						{bindingsIn(group).map((binding) => (
							<div key={binding.id} className={styles.row}>
								<span>{binding.name}</span>
								<span className={styles.keys}>
									{/* A registerable hotkey can be an object rather than a
                      string, so the rendered spelling is what keys the row. */}
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
