import { type FormEvent, type ReactNode, type Ref, useId } from "react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import styles from "./NewPlaylistForm.module.css";

export function NewPlaylistForm({
	label,
	title,
	onTitleChange,
	inputRef,
	children,
	error,
	isPending,
	pendingLabel,
	canSubmit = true,
	onSubmit,
	onCancel,
}: {
	label: string;
	title: string;
	onTitleChange: (title: string) => void;
	inputRef?: Ref<HTMLInputElement>;
	children?: ReactNode;
	error: string | null;
	isPending: boolean;
	pendingLabel: string;
	canSubmit?: boolean;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const t = useTranslate();
	const id = useId();
	const isNamed = title.trim().length > 0;
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (isNamed && canSubmit && !isPending) onSubmit();
	};

	return (
		<form className={styles.form} onSubmit={submit}>
			<label className={styles.label} htmlFor={id}>
				{label}
			</label>

			<Input
				size="md"
				id={id}
				inputRef={inputRef}
				value={title}
				onChange={(event) => onTitleChange(event.target.value)}
				placeholder={t("playlist.name")}
				aria-label={t("playlist.name")}
				spellCheck="false"
				autoComplete="off"
				autoFocus
			/>

			{children}

			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}

			<div className={styles.actions}>
				<Button onClick={onCancel}>{t("action.cancel")}</Button>
				<Button
					variant="primary"
					type="submit"
					disabled={!isNamed || !canSubmit || isPending}
				>
					{isPending ? pendingLabel : t("action.create")}
				</Button>
			</div>
		</form>
	);
}
