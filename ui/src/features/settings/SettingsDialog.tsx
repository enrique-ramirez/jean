import { useTranslate } from "@/shared/i18n/useTranslate";
import { SETTINGS_KEYBOARD } from "@/shared/keyboard/keyboardOwner";
import { ModalDialog } from "@/shared/ui/ModalDialog";
import { Appearance } from "./Appearance";
import { ArtistInformation } from "./ArtistInformation";
import { Keyboard } from "./Keyboard";
import { Language } from "./Language";
import { Playback } from "./Playback";
import styles from "./Settings.module.css";
import { SharedCredits } from "./SharedCredits";
import { TagWriting } from "./TagWriting";
import { ThisDevice } from "./ThisDevice";

export function SettingsDialog({ onDismiss }: { onDismiss: () => void }) {
	const t = useTranslate();

	return (
		<ModalDialog
			keyboardOwner={SETTINGS_KEYBOARD}
			title={t("settings.title")}
			closeLabel={t("settings.close")}
			onDismiss={onDismiss}
		>
			<div className={styles.body}>
				<TagWriting />
				<Appearance />
				<Language />
				<Playback />
				<Keyboard />
				<ThisDevice />
				<ArtistInformation />
				<SharedCredits />
			</div>
		</ModalDialog>
	);
}
