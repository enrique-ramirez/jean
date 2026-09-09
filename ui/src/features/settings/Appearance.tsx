import { ChevronDown, Palette } from "lucide-react";

import { type Theme, useTheme } from "@/shared/hooks/useTheme";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./Settings.module.css";

const FOLLOW_SYSTEM = "";

const THEMES: Theme[] = ["light", "dark"];

const NAME = {
	light: "settings.appearance.light",
	dark: "settings.appearance.dark",
} as const;

export function Appearance() {
	const t = useTranslate();
	const { chosen, choose } = useTheme();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("settings.appearance.title")}</h2>
			</div>

			<div className={styles.field}>
				<label className={styles.label} htmlFor="theme-choice">
					{t("settings.appearance.choose")}
				</label>

				<div className={styles.select}>
					<Palette size={15} strokeWidth={2} aria-hidden="true" />
					<select
						id="theme-choice"
						value={chosen ?? FOLLOW_SYSTEM}
						onChange={(event) => choose((event.target.value as Theme) || null)}
					>
						<option value={FOLLOW_SYSTEM}>
							{t("settings.appearance.follow")}
						</option>
						{THEMES.map((name) => (
							<option key={name} value={name}>
								{t(NAME[name])}
							</option>
						))}
					</select>
					<ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
				</div>
			</div>
		</section>
	);
}
