import { type FormEvent, useId, useState } from "react";
import type { Library } from "@/domain/library/useLibrary";
import { editedAutoPlaylist } from "@/domain/player/editableAutoPlaylist";
import { useMakePlaylist } from "@/domain/player/usePlaylistActions";
import {
	untitledPlaylistName,
	usePlaylists,
} from "@/domain/player/usePlaylists";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { createAutoPlaylist, updateAutoPlaylist } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { ModalDialog } from "@/shared/ui/ModalDialog";
import styles from "./AutoPlaylistDialog.module.css";
import { QueryField } from "./QueryField";
import { Results } from "./Results";
import { usePreviewedQuery } from "./usePreviewedQuery";

const AUTOPLAYLIST_KEYBOARD = "autoplaylist";

export function AutoPlaylistDialog({
	library,
	editing,
	onOpenPlaylist,
	onDismiss,
}: {
	library: Library;
	editing?: PlaylistInfo;
	onOpenPlaylist: (id: string) => void;
	onDismiss: () => void;
}) {
	const t = useTranslate();
	const { data: playlists = [] } = usePlaylists();
	const { origin, structure } = library;

	const formId = useId();
	const nameId = useId();
	const queryId = useId();

	const [opened] = useState(() => ({
		title:
			editing?.title ??
			untitledPlaylistName(playlists, t("autoplaylist.newTitle")),
		query: editing?.managed?.query ?? "",
	}));
	const [title, setTitle] = useState(opened.title);
	const [query, setQuery] = useState(opened.query);
	const isForeign = editing !== undefined && !editing.managed;

	const { state, isStale } = usePreviewedQuery({ library, query });

	const save = useMakePlaylist(
		async () => {
			const named = title.trim();
			const wanted = query.trim();
			const player = requireFooJean(origin);

			return editing
				? orThrow(
						await updateAutoPlaylist(
							player,
							editing.id,
							editedAutoPlaylist(editing, { title: named, query: wanted }),
						),
					)
				: orThrow(
						await createAutoPlaylist(player, { title: named, query: wanted }),
					);
		},
		(made) => {
			onDismiss();
			onOpenPlaylist(made.id);
		},
	);

	const isConfirmed =
		!isStale && (state.kind === "matches" || state.kind === "empty");
	const isChanged =
		title.trim() !== opened.title || query.trim() !== opened.query;
	const canSubmit =
		isConfirmed &&
		title.trim() !== "" &&
		(!editing || isChanged) &&
		!save.isPending;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (canSubmit) save.mutate();
	};

	const submitLabel = editing
		? save.isPending
			? "action.saving"
			: "action.save"
		: save.isPending
			? "action.creating"
			: "action.create";

	const submitButton = (
		<Button variant="primary" type="submit" form={formId} disabled={!canSubmit}>
			{t(submitLabel)}
		</Button>
	);

	return (
		<ModalDialog
			keyboardOwner={AUTOPLAYLIST_KEYBOARD}
			title={t(editing ? "autoplaylist.editTitle" : "autoplaylist.newTitle")}
			closeLabel={t("autoplaylist.close")}
			onDismiss={onDismiss}
			size="wide"
			action={submitButton}
		>
			<form className={styles.content} id={formId} onSubmit={submit}>
				<div className={styles.fields}>
					<div className={styles.field}>
						<label className={styles.label} htmlFor={nameId}>
							{t("autoplaylist.name")}
						</label>
						<Input
							id={nameId}
							value={title}
							onChange={(event) => {
								setTitle(event.target.value);
								save.reset();
							}}
							spellCheck="false"
							autoComplete="off"
							enterKeyHint="done"
						/>
					</div>

					<div className={styles.field}>
						<label className={styles.label} htmlFor={queryId}>
							{t("autoplaylist.query")}
						</label>
						<QueryField
							id={queryId}
							value={query}
							origin={origin}
							structure={structure}
							onChange={(next) => {
								setQuery(next);
								save.reset();
							}}
						/>
					</div>

					{save.error ? (
						<p className={styles.error} role="alert">
							{t(
								editing
									? "autoplaylist.saveFailed"
									: "autoplaylist.createFailed",
								{
									error: save.error.message,
								},
							)}
						</p>
					) : null}
				</div>

				<Results
					state={state}
					isStale={isStale}
					idle={
						isForeign ? "autoplaylist.foreignQuery" : "autoplaylist.typeQuery"
					}
				/>

				<footer className={styles.footer}>
					<Button onClick={onDismiss}>{t("action.cancel")}</Button>
					{submitButton}
				</footer>
			</form>
		</ModalDialog>
	);
}
