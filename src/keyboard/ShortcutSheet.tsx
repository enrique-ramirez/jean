import { formatForDisplay } from "@tanstack/react-hotkeys";

import { bindingsIn, KEYMAP_GROUPS } from "./keymap";
import styles from "./ShortcutSheet.module.css";

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
					<kbd>/</kbd> filters the list you are looking at.{" "}
					<kbd>{formatForDisplay("Mod+k")}</kbd> searches everything.
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
									{binding.keys
										.map((key) => formatForDisplay(key))
										.map((shown) => (
											<kbd key={shown}>{shown}</kbd>
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
