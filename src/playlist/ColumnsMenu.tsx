import { Check, Columns3, Flame } from "lucide-react";

import { Button } from "../ui/Button";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
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
	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => onOpenChange(false)}
			className={styles.menu}
			trigger={
				<Button
					icon={Columns3}
					aria-label="View options"
					title="View options"
					aria-expanded={isOpen}
					onClick={() => onOpenChange(!isOpen)}
				/>
			}
		>
			{/* The permanent way back to the explanation. The flame teaches once, on
          first sight, and after that this is where someone goes looking. */}
			{onExplainHeat ? (
				<>
					<MenuItem icon={Flame} onClick={onExplainHeat}>
						What the shading means
					</MenuItem>
					<MenuSeparator />
				</>
			) : null}

			<Option
				label="Artwork"
				checked={showArtwork}
				onToggle={onToggleArtwork}
			/>
			<MenuSeparator />
			{OPTIONAL_COLUMNS.map((column) => {
				const available = isAvailable(column.field);
				return (
					<Option
						key={column.id}
						label={available ? column.label : `${column.label} (not available)`}
						checked={enabledIds.includes(column.id) && available}
						disabled={!available}
						onToggle={() => onToggleColumn(column.id)}
					/>
				);
			})}
		</Menu>
	);
}
