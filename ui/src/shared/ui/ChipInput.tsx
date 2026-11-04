import { X } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./ChipInput.module.css";

/** How typed text becomes chips and a chip becomes text again; the input knows neither. */
export interface ChipGrammar {
	/** The chips new in `text`, none that `held` has already. */
	split: (text: string, held: readonly string[]) => string[];
	ends: (text: string) => boolean;
	/** A chip as text that `split` reads back as the same chip. */
	spell: (chip: string) => string;
}

export interface ChipInputProps {
	id: string;
	label: string;
	chips: readonly string[];
	text: string;
	onChange: (next: { chips: string[]; text: string }) => void;
	grammar: ChipGrammar;
	/** Held still while something is being done with the chips; focus stays where it is. */
	readOnly?: boolean;
	"aria-describedby"?: string;
}

const isSubmitChord = (event: KeyboardEvent) =>
	event.key === "Enter" && (event.ctrlKey || event.metaKey);

export function ChipInput({
	id,
	label,
	chips,
	text,
	onChange: change,
	grammar,
	readOnly = false,
	"aria-describedby": describedBy,
}: ChipInputProps) {
	const t = useTranslate();
	const list = useRef<HTMLUListElement | null>(null);
	const box = useRef<HTMLInputElement | null>(null);

	const onChange: ChipInputProps["onChange"] = (next) => {
		if (!readOnly) change(next);
	};

	const items = () =>
		Array.from(
			list.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? [],
		);

	const commit = (typed: string) =>
		onChange({ chips: [...chips, ...grammar.split(typed, chips)], text: "" });

	const onBoxKey = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isSubmitChord(event)) return;

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			if (text !== "") commit(text);
		} else if (event.key === "Backspace" && text === "" && chips.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			onChange({
				chips: chips.slice(0, -1),
				text: grammar.spell(chips[chips.length - 1]),
			});
		} else if (event.key === "ArrowLeft" && text === "") {
			const last = items().at(-1);
			if (!last) return;
			event.preventDefault();
			event.stopPropagation();
			last.focus();
		}
	};

	const onChipKey = (event: KeyboardEvent<HTMLElement>, at: number) => {
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			event.stopPropagation();
			const step = event.key === "ArrowLeft" ? -1 : 1;
			(items()[at + step] ?? (step > 0 ? box.current : null))?.focus();
		} else if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			event.stopPropagation();
			(items()[at - 1] ?? box.current)?.focus();
			onChange({ chips: chips.filter((_, i) => i !== at), text });
		}
	};

	return (
		<div className={styles.field}>
			{chips.length > 0 ? (
				// biome-ignore lint/a11y/noRedundantRoles: Safari drops a list's role once its markers are hidden
				<ul ref={list} role="list" aria-label={label} className={styles.chips}>
					{chips.map((chip, at) => (
						<li
							key={chip}
							data-chip=""
							tabIndex={-1}
							className={styles.chip}
							onKeyDown={(event) => onChipKey(event, at)}
						>
							{chip}
							<button
								type="button"
								tabIndex={-1}
								className={styles.remove}
								aria-label={t("chip.remove", { value: chip })}
								onClick={() => {
									box.current?.focus();
									onChange({ chips: chips.filter((_, i) => i !== at), text });
								}}
							>
								<X size={12} strokeWidth={2.25} aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			) : null}
			<input
				ref={box}
				id={id}
				type="text"
				className={styles.box}
				value={text}
				readOnly={readOnly}
				autoComplete="off"
				spellCheck={false}
				aria-describedby={describedBy}
				onChange={(event) => {
					const typed = event.target.value;
					if (grammar.ends(typed)) commit(typed);
					else onChange({ chips: [...chips], text: typed });
				}}
				onKeyDown={onBoxKey}
				onBlur={() => {
					if (text !== "") commit(text);
				}}
				onPaste={(event) => {
					// An `<input>` drops a pasted line break before `onChange` sees it, so the clipboard is
					// read here and the paste inserted by hand.
					const pasted = event.clipboardData.getData("text");
					if (!pasted) return;
					event.preventDefault();
					const { selectionStart, selectionEnd } = event.currentTarget;
					commit(
						text.slice(0, selectionStart ?? text.length) +
							pasted +
							text.slice(selectionEnd ?? text.length),
					);
				}}
			/>
		</div>
	);
}
