import { Columns3 } from "lucide-react";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./HeatLegend.module.css";

export function HeatLegend({ onDismiss }: { onDismiss: () => void }) {
	const t = useTranslate();
	return (
		<div className={styles.legend}>
			<p className={styles.title}>{t("heat.legendTitle")}</p>

			<div className={styles.scale} aria-hidden="true" />
			<div className={styles.ends} aria-hidden="true">
				<span>{t("heat.neverPlayed")}</span>
				<span>{t("heat.playedMost")}</span>
			</div>

			<p className={styles.body}>
				<Trans phrase="heat.warmer" list={<em>{t("heat.thisList")}</em>} />
			</p>

			<p className={styles.body}>{t("heat.cools")}</p>

			<div className={styles.actions}>
				<p className={styles.home}>
					<Columns3 size={13} strokeWidth={2} aria-hidden="true" />
					{t("heat.findAgain")}
				</p>
				<Button variant="primary" onClick={onDismiss}>
					{t("action.gotIt")}
				</Button>
			</div>
		</div>
	);
}
