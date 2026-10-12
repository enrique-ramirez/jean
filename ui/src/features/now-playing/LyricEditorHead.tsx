import { Check, FileText, List, Undo2, X } from "lucide-react";

import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { KeyCap } from "@/shared/ui/KeyCap";
import { Segmented } from "@/shared/ui/Segmented";
import styles from "./LyricEditor.module.css";
import type { LyricTarget } from "./useNowPlayingLyric";

export type EditorView = "lines" | "text";

export function LyricEditorHead({
	isPhone,
	titleId,
	target,
	view,
	changes,
	canSave,
	onView,
	onClose,
	onUndo,
	onSave,
}: {
	isPhone: boolean;
	titleId: string;
	target: LyricTarget;
	view: EditorView;
	changes: number;
	canSave: boolean;
	onView: (view: EditorView) => void;
	onClose: () => void;
	onUndo: () => void;
	onSave: () => void;
}) {
	const t = useTranslate();

	const views = (
		<Segmented<EditorView>
			value={view}
			label={t("lyrics.editorViews")}
			options={[
				{
					value: "lines",
					label: t("lyrics.viewLines"),
					icon: isPhone ? undefined : List,
				},
				{
					value: "text",
					label: t("lyrics.viewText"),
					icon: isPhone ? undefined : FileText,
				},
			]}
			onChange={onView}
		/>
	);

	const changeCount =
		changes > 0 ? (
			<span className={styles.changes}>
				{t("lyrics.editorChanges", { count: changes })}
			</span>
		) : null;

	return (
		<>
			<header className={styles.head}>
				<button
					type="button"
					className={styles.close}
					aria-label={t("lyrics.editorClose")}
					onClick={onClose}
				>
					{isPhone ? null : <KeyCap label="Esc" />}
					<X size={isPhone ? 22 : 16} strokeWidth={2} aria-hidden="true" />
				</button>

				<div className={styles.identity}>
					<h2 id={titleId} className={styles.title}>
						{t("lyrics.editorTitle")}
					</h2>
					<p className={styles.bound}>
						{isPhone || target.artist === null ? (
							<Trans
								phrase="lyrics.editorSavesToTrack"
								title={<b>{target.title}</b>}
							/>
						) : (
							<Trans
								phrase="lyrics.editorSavesTo"
								title={<b>{target.title}</b>}
								artist={target.artist}
							/>
						)}
					</p>
				</div>

				{isPhone ? null : views}

				<div className={styles.actions}>
					{isPhone ? null : changeCount}
					<Button
						icon={Undo2}
						className={styles.undo}
						aria-label={isPhone ? t("lyrics.undo") : undefined}
						disabled={changes === 0 || view !== "lines"}
						onClick={onUndo}
					>
						{isPhone ? null : (
							<>
								{t("lyrics.undo")}
								<KeyCap binding="lyricUndo" />
							</>
						)}
					</Button>
					<Button
						variant="primary"
						icon={Check}
						className={styles.save}
						disabled={!canSave}
						onClick={onSave}
					>
						{t("lyrics.save")}
						{isPhone ? null : <KeyCap binding="lyricSave" />}
					</Button>
				</div>
			</header>

			{isPhone ? (
				<div className={styles.sub}>
					{views}
					{changeCount}
				</div>
			) : null}
		</>
	);
}
