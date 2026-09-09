import { ChevronDown, Languages } from "lucide-react";
import { useEffect } from "react";

import { nameOfLanguage } from "@/shared/i18n/format";
import {
	CUSTOM_FILE,
	discover,
	LOCALES_FOLDER,
	setLocale,
} from "@/shared/i18n/locale";
import { Trans } from "@/shared/i18n/Trans";
import { useLocale, useTranslate } from "@/shared/i18n/useTranslate";
import { HelpHint } from "@/shared/ui/HelpHint";
import styles from "./Settings.module.css";

const FOLLOW_BROWSER = "";

export function Language() {
	const t = useTranslate();
	const { chosen, available, missing, failed } = useLocale();

	useEffect(() => {
		void discover();
	}, []);

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("settings.language.title")}</h2>
				<HelpHint label={t("settings.language.help")}>
					<p>
						<Trans
							phrase="settings.language.folder"
							folder={<code>{LOCALES_FOLDER}/</code>}
						/>
					</p>
					<p>
						<Trans
							phrase="settings.language.customHow"
							example={<code>es.json</code>}
							file={<code>{CUSTOM_FILE}</code>}
							sample={<code>["es"]</code>}
						/>
					</p>
					<p>{t("settings.language.fallback")}</p>
					<p>{t("settings.language.upgrade")}</p>
				</HelpHint>
			</div>

			<div className={styles.field}>
				<label className={styles.label} htmlFor="language-choice">
					{t("settings.language.choose")}
				</label>

				<div className={styles.select}>
					<Languages size={15} strokeWidth={2} aria-hidden="true" />
					<select
						id="language-choice"
						value={chosen ?? FOLLOW_BROWSER}
						onChange={(event) => {
							void setLocale(event.target.value || null);
						}}
					>
						<option value={FOLLOW_BROWSER}>
							{t("settings.language.follow")}
						</option>
						{available.map((code) => (
							<option key={code} value={code} lang={code}>
								{nameOfLanguage(code)}
							</option>
						))}
					</select>
					<ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
				</div>
			</div>

			{failed === null ? null : (
				<p className={styles.note} data-tone="warn">
					{t("settings.language.failed", { name: failed })}
				</p>
			)}

			{missing > 0 ? (
				<p className={styles.note}>
					{t("settings.language.partial", { count: missing })}
				</p>
			) : null}
		</section>
	);
}
