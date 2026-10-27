import { DEVICE_NAME_KEY, defaultDeviceName } from "@/domain/player/device";
import {
	LOW_LATENCY_KEY,
	restartListening,
} from "@/domain/player/listenerStore";
import { canUseMse } from "@/domain/player/mseSupport";
import { useListener } from "@/domain/player/useListener";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Input } from "@/shared/ui/Input";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function ThisDevice() {
	const t = useTranslate();
	const { canListen, lowLatencyFellBack: fellBack } = useListener();
	const [name, setName] = useStoredState(DEVICE_NAME_KEY, defaultDeviceName);
	const [isLowLatency, setLowLatency] = useStoredState(LOW_LATENCY_KEY, true);

	if (!canListen) return null;

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>{t("device.title")}</h2>
				<HelpHint label={t("device.help")}>
					<p>
						<Trans phrase="device.guess" kind={<em>{t("device.kind")}</em>} />
					</p>
					<p>{t("device.local")}</p>
				</HelpHint>
			</div>

			<div className={styles.field}>
				<label className={styles.label} htmlFor="device-name">
					{t("label.name")}
				</label>
				<Input
					size="md"
					className={styles.input}
					id="device-name"
					type="text"
					value={name}
					maxLength={64}
					onChange={(event) => setName(event.target.value)}
					onBlur={(event) => {
						if (event.target.value.trim() === "") setName(defaultDeviceName());
					}}
					placeholder={defaultDeviceName()}
					spellCheck={false}
				/>
				<p className={styles.detail}>{t("device.nameDetail")}</p>
			</div>

			{canUseMse() ? (
				<div className={styles.field}>
					<Switch
						checked={isLowLatency}
						onChange={(next) => {
							setLowLatency(next);
							restartListening();
						}}
						label={t("device.shortBuffer")}
						hint={
							<HelpHint label={t("device.bufferHelp")}>
								<p>{t("device.shortBufferDetail")}</p>
							</HelpHint>
						}
					/>
					{fellBack ? (
						<p className={styles.detail}>{t("device.bufferFellBack")}</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
