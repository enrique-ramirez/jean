import { useTranslate } from "@/shared/i18n/useTranslate";
import { useSingleKeyShortcuts } from "@/shared/keyboard/useKeymap";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function Keyboard() {
	const t = useTranslate();
	const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("settings.keyboard.title")}</h2>
			</div>

			<Switch
				checked={singleKeys}
				onChange={setSingleKeys}
				label={t("settings.keyboard.singleKeys")}
				description={t("settings.keyboard.singleKeysDetail")}
			/>
		</section>
	);
}
