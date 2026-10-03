import { memo, type ReactNode, useEffect, useRef } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import styles from "./LyricEditor.module.css";
import { clockOf, clockOfTenths, type DraftLine } from "./lyricDraft";
import {
	type AudibleClock,
	useAudibleValue,
	wholeTenths,
} from "./useAudibleClock";

const NO_TIME = "––:––.––";

function LineWords({ line }: { line: DraftLine }) {
	const t = useTranslate();

	return line.text ? (
		<span className={styles.words}>{line.text}</span>
	) : (
		<span className={styles.words} data-break="">
			{line.at === null ? null : t("lyrics.instrumentalBreak")}
		</span>
	);
}

function WordsField({
	value,
	onChange,
	onCommit,
	onCancel,
}: {
	value: string;
	onChange: (value: string) => void;
	onCommit: () => void;
	onCancel: () => void;
}) {
	const t = useTranslate();
	const input = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	return (
		<input
			ref={input}
			className={styles.field}
			aria-label={t("lyrics.lineWords")}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			onBlur={onCommit}
			onKeyDown={(event) => {
				if (event.key === "Enter") onCommit();
				else if (event.key === "Escape") onCancel();
				else return;
				event.preventDefault();
			}}
		/>
	);
}

export function Playhead({ clock }: { clock: AudibleClock }) {
	const seconds = useAudibleValue(clock, wholeTenths);

	return (
		<div className={styles.playhead} data-playhead="" aria-hidden="true">
			<span>{clockOfTenths(seconds)}</span>
		</div>
	);
}

export const LyricRow = memo(function LyricRow({
	line,
	index,
	isSelected,
	field,
	ghost,
	onGhostEnd,
	tools,
	onSelect,
	onEditWords,
	onFieldChange,
	onFieldCommit,
	onFieldCancel,
	onRow,
}: {
	line: DraftLine;
	index: number;
	isSelected: boolean;
	field: string | null;
	ghost: number | null;
	onGhostEnd: (id: number) => void;
	tools: ReactNode;
	onSelect: (index: number) => void;
	onEditWords: (index: number) => void;
	onFieldChange: (value: string) => void;
	onFieldCommit: () => void;
	onFieldCancel: () => void;
	onRow: (index: number, element: HTMLDivElement | null) => void;
}) {
	const time = (
		<span className={styles.at} data-none={line.at === null}>
			{line.at === null ? (
				<span aria-hidden="true">{NO_TIME}</span>
			) : (
				clockOf(line.at)
			)}
		</span>
	);

	return (
		// biome-ignore lint/a11y/useSemanticElements: see the grid
		// biome-ignore lint/a11y/useFocusableInteractive: the cursor is an index in state that the keymap moves, and each line's own button takes focus
		<div
			ref={(element) => onRow(index, element)}
			role="row"
			aria-selected={isSelected}
			className={classNames(styles.row, styles.lineRow)}
			data-selected={isSelected}
			data-untimed={line.at === null}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: see the grid */}
			{/* biome-ignore lint/a11y/useFocusableInteractive: see the row */}
			<div role="gridcell">
				{field === null ? (
					<button
						type="button"
						className={classNames(styles.line, styles.pick)}
						data-pick=""
						onClick={() => onSelect(index)}
						onDoubleClick={() => onEditWords(index)}
					>
						{time}
						<LineWords line={line} />
					</button>
				) : (
					<div className={styles.line}>
						{time}
						<WordsField
							value={field}
							onChange={onFieldChange}
							onCommit={onFieldCommit}
							onCancel={onFieldCancel}
						/>
					</div>
				)}
				{tools}
				{ghost === null ? null : (
					<div
						className={styles.ghost}
						style={{ height: ghost }}
						aria-hidden="true"
						onAnimationEnd={() => onGhostEnd(line.id)}
					/>
				)}
			</div>
		</div>
	);
});
