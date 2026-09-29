import type { ConnectionState } from "@/domain/player/connection";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./ConnectionNotice.module.css";

type NoticePhrase = Extract<Phrase, `connection.${string}`>;

const WORDING = {
	reconnecting: { headline: "connection.reconnecting", remedy: null },
	stillReconnecting: {
		headline: "connection.reconnecting",
		remedy: "connection.remedy",
	},
	playerUnresponsive: {
		headline: "connection.unresponsive",
		remedy: "connection.unresponsiveRemedy",
	},
} as const satisfies Record<
	Exclude<ConnectionState, "connected">,
	{ headline: NoticePhrase; remedy: NoticePhrase | null }
>;

export function ConnectionNotice({
	state,
}: {
	state: Exclude<ConnectionState, "connected">;
}) {
	const t = useTranslate();
	const { headline, remedy } = WORDING[state];

	return (
		<div className={styles.notice}>
			<span className={styles.pulse} aria-hidden="true" />
			<div className={styles.text}>
				<p className={styles.headline}>{t(headline)}</p>
				{remedy ? <p className={styles.remedy}>{t(remedy)}</p> : null}
			</div>
		</div>
	);
}
