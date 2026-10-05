import { useOffersListeningWhenSilent } from "@/domain/player/offersListening";
import {
	useCursorFollowsPlayback,
	usePlaybackFollowsCursor,
} from "@/domain/track/followSettings";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function Playback() {
	const t = useTranslate();
	const [cursorFollows, setCursorFollows] = useCursorFollowsPlayback();
	const [playbackFollows, setPlaybackFollows] = usePlaybackFollowsCursor();
	const [offersListening, setOffersListening] = useOffersListeningWhenSilent();

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("settings.playback.title")}</h2>
				<HelpHint label={t("settings.playback.help")}>
					<p>{t("settings.playback.exempt")}</p>
					<p>
						<Trans
							phrase="settings.playback.cursorOff"
							setting={<strong>{t("settings.playback.cursorFollows")}</strong>}
						/>
					</p>
				</HelpHint>
			</div>

			<Switch
				checked={cursorFollows}
				onChange={setCursorFollows}
				label={t("settings.playback.cursorFollows")}
			/>

			<Switch
				checked={playbackFollows}
				onChange={setPlaybackFollows}
				label={t("settings.playback.playbackFollows")}
			/>

			<Switch
				checked={offersListening}
				onChange={setOffersListening}
				label={t("settings.playback.offerListening")}
				description={t("settings.playback.offerListeningDetail")}
			/>
		</section>
	);
}
