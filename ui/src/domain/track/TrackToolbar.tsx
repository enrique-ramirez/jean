import { Flame, LayoutList, ListMusic } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useStoredState } from "@/shared/hooks/useStoredState";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import type { IconComponent } from "@/shared/ui/icons";
import { Menu } from "@/shared/ui/Menu";
import { Segmented } from "@/shared/ui/Segmented";
import { ColumnsMenu } from "./ColumnsMenu";
import type { useAvailableFields } from "./fieldAvailability";
import { HeatLegend } from "./HeatLegend";
import styles from "./TrackBrowser.module.css";
import type { Layout, ListPreferences } from "./useListPreferences";

const LAYOUTS = [
	{ value: "compact", label: "layout.list", icon: LayoutList },
	{ value: "album", label: "layout.albums", icon: ListMusic },
] as const satisfies readonly {
	value: Layout;
	label: Phrase;
	icon: IconComponent;
}[];

export function TrackToolbar({
	leading,
	preferences,
	isAvailable,
	hasPlayCounts,
}: {
	leading?: ReactNode;
	preferences: ListPreferences;
	isAvailable: ReturnType<typeof useAvailableFields>["isAvailable"];
	hasPlayCounts: boolean;
}) {
	const t = useTranslate();
	const layouts = useMemo(
		() => LAYOUTS.map((option) => ({ ...option, label: t(option.label) })),
		[t],
	);

	const [isColumnsOpen, setIsColumnsOpen] = useState(false);
	const [isHeatInfoOpen, setIsHeatInfoOpen] = useState(false);
	const [heatIntroSeen, setHeatIntroSeen] = useStoredState(
		"jean.heatIntroSeen",
		false,
	);

	const dismissHeatInfo = useCallback(() => {
		setIsHeatInfoOpen(false);
		setHeatIntroSeen(true);
	}, [setHeatIntroSeen]);

	if (
		!isHeatInfoOpen &&
		!heatIntroSeen &&
		hasPlayCounts &&
		preferences.showHeat
	)
		setIsHeatInfoOpen(true);

	return (
		<div className={styles.toolbar}>
			{leading}

			<span className={styles.spacer} />

			{hasPlayCounts ? (
				<Menu
					isOpen={isHeatInfoOpen}
					onDismiss={dismissHeatInfo}
					role="dialog"
					className={styles.heatInfo}
					trigger={
						<Button
							icon={Flame}
							aria-pressed={preferences.showHeat}
							aria-label={t("heat.show")}
							title={t("heat.title")}
							onClick={() => {
								preferences.toggleHeat();
								if (isHeatInfoOpen) dismissHeatInfo();
							}}
						/>
					}
				>
					<HeatLegend onDismiss={dismissHeatInfo} />
				</Menu>
			) : null}

			<Segmented
				value={preferences.layout}
				onChange={preferences.setLayout}
				options={layouts}
				label={t("layout.label")}
			/>

			<ColumnsMenu
				isOpen={isColumnsOpen}
				onOpenChange={setIsColumnsOpen}
				enabledIds={preferences.enabledIds}
				isAvailable={isAvailable}
				onExplainHeat={
					hasPlayCounts
						? () => {
								setIsColumnsOpen(false);
								setIsHeatInfoOpen(true);
							}
						: undefined
				}
				showArtwork={preferences.showArtwork}
				onToggleArtwork={preferences.toggleArtwork}
				onToggleColumn={preferences.toggleColumn}
			/>
		</div>
	);
}
