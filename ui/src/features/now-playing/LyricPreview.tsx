import { Check, ChevronLeft, ChevronRight, PencilLine } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { Button } from "@/shared/ui/Button";
import styles from "./LyricPreview.module.css";
import {
	type Scope,
	ScopeSwitch,
	Stepper,
	useAmountReadout,
} from "./LyricStepper";
import { type PanelVariant, PlainLines, Synced } from "./Lyrics";
import type { LrclibRecord } from "./lrclib";
import {
	draftFromText,
	type LyricDraft,
	serialiseDraft,
	shiftAll,
	shiftLine,
} from "./lyricDraft";
import { useDiscardGuard } from "./useDiscardGuard";

function VersionNav({
	index,
	total,
	onPrevious,
	onNext,
}: {
	index: number;
	total: number;
	onPrevious: () => void;
	onNext: () => void;
}) {
	const t = useTranslate();

	return (
		<span className={styles.nav}>
			<button
				type="button"
				className={styles.round}
				aria-label={t("lyrics.previousVersion")}
				disabled={index === 0}
				onClick={onPrevious}
			>
				<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
			</button>
			{t("lyrics.previewPosition", { index: index + 1, total })}
			<button
				type="button"
				className={styles.round}
				aria-label={t("lyrics.nextVersion")}
				disabled={index === total - 1}
				onClick={onNext}
			>
				<ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
			</button>
		</span>
	);
}

interface Nudges {
	all: number;
	lines: Record<number, number>;
}

function nudged(original: LyricDraft, { all, lines }: Nudges): LyricDraft {
	const moved = Object.entries(lines).reduce(
		(draft, [index, ms]) => shiftLine(draft, Number(index), ms / 1000),
		original,
	);
	return shiftAll(moved, all / 1000);
}

const isTimed = (draft: LyricDraft) =>
	draft.lines.length > 0 && draft.lines.every((line) => line.at !== null);

export function LyricPreview({
	record,
	index,
	total,
	variant,
	summary,
	snapshot,
	title,
	isPlayingTarget,
	backLabel,
	onBack,
	onPrevious,
	onNext,
	onSave,
	onOpenEditor,
	className,
}: {
	record: LrclibRecord;
	index: number;
	total: number;
	variant: PanelVariant;
	summary: ReactNode;
	snapshot: PlayerSnapshot | null | undefined;
	title: string;
	isPlayingTarget: boolean;
	backLabel: string;
	onBack: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onSave: (text: string) => Promise<boolean>;
	onOpenEditor: (draft: LyricDraft) => void;
	className?: string;
}) {
	const t = useTranslate();
	const readout = useAmountReadout();
	const isPhone = variant === "screen";

	const original = useMemo(
		() => draftFromText(record.syncedLyrics ?? record.plainLyrics ?? ""),
		[record],
	);
	const [nudges, setNudges] = useState<Nudges>({ all: 0, lines: {} });
	const [selected, setSelected] = useState<number | null>(null);
	const [chosenScope, setChosenScope] = useState<Scope>("line");
	const [isSaving, setIsSaving] = useState(false);

	const draft = useMemo(() => nudged(original, nudges), [original, nudges]);

	const hasWords = !record.instrumental && draft.lines.length > 0;
	const timed = hasWords && isTimed(draft);
	const scope: Scope = selected === null ? "all" : chosenScope;

	const lines = useMemo(
		() => draft.lines.map((line) => ({ at: line.at ?? 0, text: line.text })),
		[draft],
	);

	const nudgeAll = (ms: number) =>
		setNudges((current) => ({ ...current, all: current.all + ms }));

	const nudgeLine = (ms: number) => {
		if (selected === null) return;
		setNudges((current) => ({
			...current,
			lines: {
				...current.lines,
				[selected]: (current.lines[selected] ?? 0) + ms,
			},
		}));
	};

	const toggle = (line: number) => {
		setSelected((current) => (current === line ? null : line));
		setChosenScope("line");
	};

	const lineAmount = selected === null ? 0 : (nudges.lines[selected] ?? 0);

	const { prompt } = useDiscardGuard({
		isDirty:
			nudges.all !== 0 || Object.values(nudges.lines).some((ms) => ms !== 0),
		title,
	});

	const save = async () => {
		setIsSaving(true);
		const saved = await onSave(serialiseDraft(draft));
		if (!saved) setIsSaving(false);
	};

	const openButton = (
		<Button
			icon={PencilLine}
			className={styles.open}
			onClick={() => onOpenEditor(draft)}
		>
			{t("lyrics.openInEditor")}
		</Button>
	);

	const saveButton = (
		<Button
			variant="primary"
			icon={Check}
			className={styles.save}
			disabled={isSaving}
			onClick={() => void save()}
		>
			{t("lyrics.save")}
		</Button>
	);

	return (
		<section
			className={classNames(styles.preview, className)}
			aria-label={t("lyrics.preview")}
			data-variant={variant}
		>
			<div className={styles.head}>
				<button type="button" className={styles.back} onClick={onBack}>
					<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
					{backLabel}
				</button>
				{isPhone ? (
					<VersionNav
						index={index}
						total={total}
						onPrevious={onPrevious}
						onNext={onNext}
					/>
				) : (
					<span className={styles.note}>{t("lyrics.previewNote")}</span>
				)}
			</div>

			{isPlayingTarget ? null : (
				<p className={styles.stale} role="status">
					{t("lyrics.previewStillFor", { title })}
				</p>
			)}

			<div className={styles.pick}>
				<div className={styles.summary}>{summary}</div>
				{isPhone ? null : (
					<VersionNav
						index={index}
						total={total}
						onPrevious={onPrevious}
						onNext={onNext}
					/>
				)}
			</div>

			<div className={styles.body}>
				{!hasWords ? (
					<p className={styles.wordless}>{t("lyrics.noWords")}</p>
				) : timed ? (
					<Synced
						lines={lines}
						snapshot={snapshot}
						lyricKey={record.id}
						isHeard={isPlayingTarget}
						selection={{
							selected,
							onToggle: toggle,
							trailing: () =>
								isPhone ? (
									<span className={styles.moved}>{readout(lineAmount)}</span>
								) : (
									<Stepper
										label={t("lyrics.thisLine")}
										showsLabel
										readout={readout(lineAmount)}
										isReadoutQuiet={lineAmount === 0}
										onStep={nudgeLine}
									/>
								),
						}}
					/>
				) : (
					<PlainLines lines={draft.lines.map((line) => line.text)} />
				)}
			</div>

			{!hasWords ? null : isPhone ? (
				<div className={styles.dock}>
					<div className={styles.dockRow}>
						{timed ? (
							<ScopeSwitch
								scope={scope}
								canChooseLine={selected !== null}
								onChange={setChosenScope}
							/>
						) : null}
						<span className={styles.unsaved}>{t("lyrics.notSavedYet")}</span>
					</div>
					{timed ? (
						<Stepper
							label={
								scope === "line" ? t("lyrics.thisLine") : t("lyrics.allLines")
							}
							showsLabel={false}
							size="touch"
							readout={readout(scope === "line" ? lineAmount : nudges.all)}
							isReadoutQuiet={
								(scope === "line" ? lineAmount : nudges.all) === 0
							}
							onStep={scope === "line" ? nudgeLine : nudgeAll}
						/>
					) : null}
					<div className={styles.actions}>
						{openButton}
						{saveButton}
					</div>
				</div>
			) : (
				<div className={styles.bar}>
					{timed ? (
						<Stepper
							label={t("lyrics.allLines")}
							showsLabel
							readout={readout(nudges.all)}
							isReadoutQuiet={nudges.all === 0}
							onStep={nudgeAll}
						/>
					) : null}
					<span className={styles.spacer} />
					{openButton}
					{saveButton}
				</div>
			)}
			{prompt}
		</section>
	);
}
