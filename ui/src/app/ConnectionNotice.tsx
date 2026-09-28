import type { ConnectionState } from "@/domain/player/connection";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./ConnectionNotice.module.css";

export function ConnectionNotice({
	state,
}: {
	state: Exclude<ConnectionState, "connected">;
}) {
	const t = useTranslate();

	return (
		<div className={styles.notice}>
			<span className={styles.pulse} aria-hidden="true" />
			<div className={styles.text}>
				<p className={styles.headline}>{t("connection.reconnecting")}</p>
				{state === "stillReconnecting" ? (
					<p className={styles.remedy}>{t("connection.remedy")}</p>
				) : null}
			</div>
		</div>
	);
}
