import { useRef } from "react";

import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SHORTCUTS_KEYBOARD, useKeyboardOwnership } from "./keyboardOwner";
import {
	bindingsIn,
	chordFor,
	chordsOf,
	hintFor,
	isAvailable,
	KEYMAP_GROUPS,
} from "./keymap";
import styles from "./ShortcutSheet.module.css";
import { useSingleKeyShortcuts } from "./useKeymap";

const Chord = ({ caps }: { caps: readonly string[] }) => (
	<span className={styles.chord}>
		{caps.map((cap) => (
			<kbd key={cap} className={styles.cap}>
				{cap}
			</kbd>
		))}
	</span>
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
	const search = <Chord caps={chordFor("globalSearch")} />;

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
					{hintFor("openFinder", singleKeys) === null ? (
						<Trans phrase="shortcuts.subtitleSearchOnly" search={search} />
					) : (
						<Trans
							phrase="shortcuts.subtitle"
							find={<Chord caps={chordFor("openFinder")} />}
							search={search}
						/>
					)}
				</p>

				{KEYMAP_GROUPS.filter((group) => listed(group).length > 0).map(
					(group) => (
						<section key={group} className={styles.group}>
							<h3 className={styles.groupTitle}>{t(group)}</h3>
							{listed(group).map((binding) => (
								<div key={binding.id} className={styles.row}>
									<span>{t(binding.name)}</span>
									<span className={styles.keys}>
										{chordsOf(binding).map((caps) => (
											<Chord key={caps.join("+")} caps={caps} />
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
