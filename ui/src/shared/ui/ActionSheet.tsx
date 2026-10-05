import { translate } from "@/shared/i18n/locale";
import styles from "./ActionMenu.module.css";
import { Header, type PanelProps, usePanel } from "./actionPanel";
import { BottomSheet } from "./BottomSheet";

export function ActionSheet({
	header,
	actions,
	isLeaving,
	onDismiss,
}: PanelProps & { isLeaving: boolean }) {
	const { body, onKeyDown, page, depth, back } = usePanel({
		actions,
		onDismiss,
		canFilter: true,
	});

	return (
		<BottomSheet
			label={header?.title ?? translate("menu.actions")}
			isLeaving={isLeaving}
			layer="actionMenu"
			onDismiss={onDismiss}
			onKeyDown={onKeyDown}
			className={styles.sheet}
		>
			<Header header={header} page={page} depth={depth} onBack={back} />
			{body}
		</BottomSheet>
	);
}
