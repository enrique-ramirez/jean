import { Check, Columns3, Flame } from "lucide-react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Menu, MenuItem, MenuSeparator } from "@/shared/ui/Menu";
import styles from "./ColumnsMenu.module.css";
import { OPTIONAL_COLUMNS } from "./columns";

function Option({
	label,
	checked,
	disabled,
	onToggle,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	return (
		<MenuItem
			role="menuitemcheckbox"
			aria-checked={checked}
			disabled={disabled}
			onClick={onToggle}
		>
			<span className={styles.check} data-checked={checked}>
				{checked ? (
					<Check size={11} strokeWidth={3} aria-hidden="true" />
				) : null}
			</span>
			{label}
		</MenuItem>
	);
}

export function ColumnsMenu({
	isOpen,
	onOpenChange,
	enabledIds,
	onToggleColumn,
	showArtwork,
	onToggleArtwork,
	isAvailable,
	onExplainHeat,
}: {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	enabledIds: string[];
	onToggleColumn: (id: string) => void;
	showArtwork: boolean;
	onToggleArtwork: () => void;
	isAvailable: (field: number) => boolean;
	onExplainHeat?: () => void;
}) {
	const t = useTranslate();

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => onOpenChange(false)}
			className={styles.menu}
			trigger={
				<Button
					icon={Columns3}
					aria-label={t("columns.viewOptions")}
					title={t("columns.viewOptions")}
					aria-expanded={isOpen}
					onClick={() => onOpenChange(!isOpen)}
				/>
			}
		>
			{onExplainHeat ? (
				<>
					<MenuItem icon={Flame} onClick={onExplainHeat}>
						{t("heat.whatItMeans")}
					</MenuItem>
					<MenuSeparator />
				</>
			) : null}

			<Option
				label={t("columns.artwork")}
				checked={showArtwork}
				onToggle={onToggleArtwork}
			/>
			<MenuSeparator />
			{OPTIONAL_COLUMNS.map((column) => {
				const available = isAvailable(column.field);
				return (
					<Option
						key={column.id}
						label={
							available
								? t(column.label)
								: t("columns.unavailable", { column: t(column.label) })
						}
						checked={enabledIds.includes(column.id) && available}
						disabled={!available}
						onToggle={() => onToggleColumn(column.id)}
					/>
				);
			})}
		</Menu>
	);
}
