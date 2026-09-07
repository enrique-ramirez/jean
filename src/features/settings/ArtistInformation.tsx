import { useArtistInfoEnabled } from "@/features/now-playing/artistInfo";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function ArtistInformation() {
	const t = useTranslate();
	const [isEnabled, setEnabled] = useArtistInfoEnabled();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("settings.artistInfo.title")}</h2>
				<HelpHint label={t("settings.artistInfo.help")}>
					<p>
						<Trans
							phrase="settings.artistInfo.where"
							device={<strong>{t("settings.artistInfo.thisDevice")}</strong>}
						/>
					</p>
					<p>{t("settings.artistInfo.whenOff")}</p>
				</HelpHint>
			</div>

			<Switch
				checked={isEnabled}
				onChange={setEnabled}
				label={t("settings.artistInfo.enable")}
			/>
		</section>
	);
}
