import {
	forgetStoredLibrary,
	useKeepLibrary,
} from "@/domain/track/keepLibrary";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Disclosure } from "@/shared/ui/Disclosure";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

export function AdvancedSection() {
	const t = useTranslate();
	const [isKept, setKept] = useKeepLibrary();

	return (
		<Disclosure className={styles.card} title={t("settings.advanced.title")}>
			<Switch
				checked={isKept}
				onChange={(isKept) => {
					setKept(isKept);
					if (!isKept) forgetStoredLibrary();
				}}
				label={t("settings.advanced.keepLibrary")}
				description={t("settings.advanced.keepLibraryDetail")}
			/>
		</Disclosure>
	);
}
