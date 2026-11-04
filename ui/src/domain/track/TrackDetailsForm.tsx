import { type ReactNode, useCallback, useId } from "react";
import { PLAYER_JOINER, valuesIn } from "@/shared/api/multiValue";
import type { WriteFailure } from "@/shared/api/tags";
import type { TrackAddress, TrackColumns } from "@/shared/api/types";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { type ChipGrammar, ChipInput } from "@/shared/ui/ChipInput";
import { Input } from "@/shared/ui/Input";
import { chipsFrom, endsChip, textOf } from "./chipText";
import { DETAIL_FIELDS, DETAIL_FIELD as F } from "./detailFields";
import { UNRESOLVED } from "./libraryColumns";
import styles from "./TrackDetails.module.css";
import { type TagValues, tagEdits } from "./tagEdits";
import type { TagSave } from "./useTagWriter";

export type EditableField = (typeof DETAIL_FIELDS)[number];

const GRAMMAR: ChipGrammar = {
	split: chipsFrom,
	ends: endsChip,
	spell: textOf,
};

// What the file holds under the raw read. `$meta()` answers empty for a tag the file lacks, and `?`
// is a column the player could not resolve.
const heldBy = (row: TrackColumns, field: EditableField) => {
	const raw = row[F[field.column]];
	return raw === undefined || raw === UNRESOLVED ? "" : raw;
};

const readFrom = (row: TrackColumns, field: EditableField) => {
	const held = heldBy(row, field);
	return field.multi ? (held === "" ? [] : valuesIn(held)) : held;
};

// Fixed when Edit is pressed: the track the form is for, with what the file held then, who may be
// written and where. The host may move on to another track, and a refusal may narrow the player's
// list, without the form changing under typed values.
export interface Editing {
	row: TrackColumns;
	addresses: readonly TrackAddress[];
	trackKey: string | undefined;
	read: TagValues;
	form: Record<string, string | string[]>;
	texts: Record<string, string>;
	permitted: readonly EditableField[];
}

export function openForm(
	row: TrackColumns,
	addresses: readonly TrackAddress[],
	trackKey: string | undefined,
	permitted: readonly EditableField[],
): Editing {
	const form: Editing["form"] = {};
	const held: Record<string, string | string[]> = {};
	for (const field of permitted) {
		const value = readFrom(row, field);
		held[field.tag] = value;
		form[field.tag] = Array.isArray(value) ? [...value] : value;
	}
	return { row, addresses, trackKey, read: held, form, texts: {}, permitted };
}

export function changesIn(editing: Editing) {
	const fields = tagEdits(editing.read, editing.form);
	return {
		fields,
		hasChanges:
			Object.keys(fields).length > 0 ||
			Object.values(editing.texts).some((text) => text !== ""),
	};
}

export function withPendingChips(editing: Editing): Editing {
	const form = { ...editing.form };
	for (const field of editing.permitted) {
		const text = editing.texts[field.tag] ?? "";
		if (field.multi && text !== "") {
			const chips = form[field.tag] as string[];
			form[field.tag] = [...chips, ...chipsFrom(text, chips)];
		}
	}
	return { ...editing, form, texts: {} };
}

export const requestFor = (
	editing: Editing,
	fields: TagSave["fields"],
): TagSave => ({
	addresses: editing.addresses,
	fields,
	reads: Object.fromEntries(
		DETAIL_FIELDS.filter((field) => field.tag in fields).map((field) => [
			field.tag,
			field.read,
		]),
	),
});

export const failureWords = (failure: WriteFailure, t: Translate) => {
	switch (failure.reason) {
		case "not-allowed": {
			const field = DETAIL_FIELDS.find(
				(entry) => entry.tag.toLowerCase() === failure.field?.toLowerCase(),
			);
			return t("details.saveForbidden", {
				field: field ? t(field.label) : (failure.field ?? ""),
			});
		}
		case "moved":
		case "ambiguous":
			return t("details.saveMoved");
		case "unknown-track":
			return t("details.saveGone");
		case "too-fast":
			return t("details.saveTooMany");
		case "unreachable":
			return t("details.saveUnreachable");
		default:
			return t("details.saveFailed");
	}
};

export function TrackDetailsForm({
	editing,
	onChange,
	onSubmit,
	onCancel,
	isSaving,
	failure,
	isNotPlaying,
	children,
}: {
	editing: Editing;
	onChange: (next: Editing) => void;
	onSubmit: () => void;
	onCancel: () => void;
	isSaving: boolean;
	failure: string | null;
	isNotPlaying: boolean;
	children: ReactNode;
}) {
	const t = useTranslate();
	const ids = useId();
	const changedId = `${ids}-changed`;
	const { fields, hasChanges } = changesIn(editing);
	const isChanged = (tag: string) =>
		tag in fields || (editing.texts[tag] ?? "") !== "";

	const focusFirstInput = useCallback((form: HTMLFormElement | null) => {
		form?.querySelector("input")?.focus({ preventScroll: true });
	}, []);

	const rows = DETAIL_FIELDS.map((field, at) => {
		const inputId = `${ids}-${at}`;
		const label = t(field.label);

		if (!editing.permitted.includes(field)) {
			const held = heldBy(editing.row, field);
			if (held === "") return null;
			return (
				<div key={field.tag} className={styles.row}>
					<dt className={styles.label}>{label}</dt>
					<dd className={styles.value}>
						{field.multi ? valuesIn(held).join(PLAYER_JOINER) : held}
					</dd>
				</div>
			);
		}

		const changed = isChanged(field.tag);
		const describedBy = changed ? changedId : undefined;
		return (
			<div key={field.tag} className={styles.row} data-editing="">
				<dt className={styles.label}>
					<label htmlFor={inputId}>
						{label}
						{changed ? (
							<span className={styles.mark} aria-hidden="true" />
						) : null}
					</label>
				</dt>
				<dd className={styles.value}>
					{field.multi ? (
						<ChipInput
							id={inputId}
							label={label}
							chips={editing.form[field.tag] as string[]}
							text={editing.texts[field.tag] ?? ""}
							grammar={GRAMMAR}
							readOnly={isSaving}
							aria-describedby={describedBy}
							onChange={({ chips, text }) =>
								onChange({
									...editing,
									form: { ...editing.form, [field.tag]: chips },
									texts: { ...editing.texts, [field.tag]: text },
								})
							}
						/>
					) : (
						<Input
							id={inputId}
							size="md"
							value={editing.form[field.tag] as string}
							autoComplete="off"
							spellCheck={false}
							readOnly={isSaving}
							aria-describedby={describedBy}
							onChange={(event) =>
								onChange({
									...editing,
									form: { ...editing.form, [field.tag]: event.target.value },
								})
							}
						/>
					)}
				</dd>
			</div>
		);
	});

	return (
		<form
			ref={focusFirstInput}
			className={styles.details}
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.requestSubmit();
				}
			}}
		>
			<span id={changedId} hidden>
				{t("details.changed")}
			</span>
			{failure ? (
				<p role="alert" className={styles.failure}>
					{failure}
				</p>
			) : null}
			<div className={styles.bar}>
				{isNotPlaying ? (
					<span className={styles.stale}>{t("details.notPlaying")}</span>
				) : null}
				<Button onClick={onCancel}>{t("action.cancel")}</Button>
				<Button
					type="submit"
					variant="primary"
					disabled={!hasChanges}
					aria-busy={isSaving}
				>
					{t("details.save")}
				</Button>
			</div>
			<section className={styles.group}>
				<h2 className={styles.groupTitle}>{t("details.group.release")}</h2>
				<dl className={styles.rows}>{rows}</dl>
			</section>
			{children}
		</form>
	);
}
