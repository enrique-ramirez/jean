import { useSplitCredits } from "@/domain/artist/splitCredits";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function SharedCredits() {
	const t = useTranslate();
	const [isEnabled, setEnabled] = useSplitCredits();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>
					{t("settings.sharedCredits.title")}
				</h2>
				<HelpHint label={t("settings.sharedCredits.help")}>
					<p>{t("settings.sharedCredits.how")}</p>
					<p>{t("settings.sharedCredits.whenOff")}</p>
				</HelpHint>
			</div>

			<Switch
				checked={isEnabled}
				onChange={setEnabled}
				label={t("settings.sharedCredits.enable")}
			/>
		</section>
	);
}
