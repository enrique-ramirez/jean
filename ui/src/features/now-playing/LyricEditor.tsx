import { Plus, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useId, useMemo, useRef, useState } from "react";

import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import {
	KEY_SEEK_SECONDS,
	usePlayPause,
	useSeek,
	useSeekBy,
} from "@/domain/player/useTransport";
import { useDiscardGuard } from "@/domain/track/useDiscardGuard";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import styles from "./LyricEditor.module.css";
import { LyricEditorDock } from "./LyricEditorDock";
import { type EditorView, LyricEditorHead } from "./LyricEditorHead";
import { LyricKeys } from "./LyricKeys";
import { LyricLineTools } from "./LyricLineTools";
import { LyricRow, Playhead } from "./LyricRow";
import { type Scope, Stepper } from "./LyricStepper";
import type { PanelVariant } from "./Lyrics";
import {
	draftFromText,
	insertLineBelow,
	type LyricDraft,
	removeLine,
	serialiseDraft,
	setLineText,
	shiftAll,
	shiftLine,
	stampLine,
} from "./lyricDraft";
import {
	useAudibleClock,
	useAudibleValue,
	wholeTenths,
} from "./useAudibleClock";
import { useEditorRows } from "./useEditorRows";
import { useLineField } from "./useLineField";
import { useLyricDraft } from "./useLyricDraft";
import {
	type LyricTarget,
	playingAgainst,
	useNowPlayingLyric,
} from "./useNowPlayingLyric";

const LYRIC_EDITOR_KEYBOARD = "lyric-editor";

const TENTH = 0.1;
const SECOND = 1;
const PLAY_FROM_LEAD_SECONDS = 2;

export interface EditorOpening {
	target: LyricTarget;
	draft: LyricDraft;
	held: string;
	onSaved?: () => void;
}

function firstToWork(draft: LyricDraft): number | null {
	if (draft.lines.length === 0) return null;
	const untimed = draft.lines.findIndex((line) => line.at === null);
	return untimed < 0 ? 0 : untimed;
}

function handBackToControl(event: KeyboardEvent): boolean {
	const target = event.target;
	if (target instanceof HTMLButtonElement && !("pick" in target.dataset)) {
		target.click();
		return true;
	}
	return false;
}

const headerKey = (headers: string[], index: number) =>
	`${headers[index]}#${headers.slice(0, index).filter((h) => h === headers[index]).length}`;

export function LyricEditor({
	opening,
	variant,
	snapshot,
	onClose,
}: {
	opening: EditorOpening;
	variant: PanelVariant;
	snapshot: PlayerSnapshot | null | undefined;
	onClose: () => void;
}) {
	const t = useTranslate();
	const { save: saveLyric } = useNowPlayingLyric();
	const canControlPlayback = useCanControlPlayback();
	const seek = useSeek();
	const seekBy = useSeekBy();
	const playPause = usePlayPause();
	const clock = useAudibleClock(snapshot);
	const { target } = opening;
	const isPhone = variant === "screen";
	const titleId = useId();

	useKeyboardOwnership(LYRIC_EDITOR_KEYBOARD);

	const { isPlayingTarget: isSongPlaying, other } = playingAgainst(
		target,
		snapshot,
	);
	const notPlaying = isSongPlaying ? null : target.title;

	const { draft, selection, changes, change, select, undo } = useLyricDraft(
		() => ({
			draft: opening.draft,
			selection: { cursor: firstToWork(opening.draft), isAll: false },
		}),
	);
	const { cursor, isAll } = selection;
	const [view, setView] = useState<EditorView>("lines");
	const [text, setText] = useState("");
	const {
		field,
		isOpen: isFieldOpen,
		open: openField,
		type: onFieldChange,
		close: closeField,
		commit: commitField,
	} = useLineField(change);
	const [phoneScope, setPhoneScope] = useState<Scope>("line");
	const [isSaving, setIsSaving] = useState(false);
	const [held] = useState(() => serialiseDraft(draftFromText(opening.held)));

	const draftRef = useRef(draft);
	draftRef.current = draft;

	const pending = useMemo(
		() =>
			view === "text"
				? serialiseDraft(draftFromText(text))
				: serialiseDraft(
						field ? setLineText(draft, field.index, field.value) : draft,
					),
		[view, text, field, draft],
	);
	const canSave = pending !== held && !isSaving;
	const hasUnreadEdits =
		view === "text"
			? text !== serialiseDraft(draft)
			: field !== null && field.value !== draft.lines[field.index]?.text;
	const { isAsking, prompt, leave } = useDiscardGuard({
		isDirty: (changes > 0 || hasUnreadEdits) && pending !== held,
		title: target.title,
		changes,
	});
	const requestClose = () => leave(onClose);
	useEscapeCapture(isAsking ? null : requestClose);
	const hasLines = draft.lines.length > 0;
	const hasTimes = draft.lines.some((line) => line.at !== null);
	const inLines = view === "lines";

	const layer = useRef<HTMLDivElement | null>(null);
	useTabTrap(layer);

	const playheadSlot = useAudibleValue(
		clock,
		(seconds) =>
			draft.lines.findLastIndex(
				(line) => line.at !== null && line.at <= wholeTenths(seconds),
			) + 1,
	);

	const selectedId = cursor === null ? null : (draft.lines[cursor]?.id ?? null);

	const { ghosts, dropGhost, pointerChose, placeRow } = useEditorRows({
		cursor,
		selectedId,
		isFieldOpen,
	});

	const onSelect = useCallback(
		(index: number) => {
			pointerChose(index, draftRef.current.lines[index]?.id);
			select({ cursor: index, isAll: false });
			setPhoneScope("line");
		},
		[select, pointerChose],
	);

	const onEditWords = useCallback(
		(index: number) => {
			const line = draftRef.current.lines[index];
			if (!line) return;
			select({ cursor: index, isAll: false });
			openField(index, line.text);
		},
		[select, openField],
	);

	const moveCursor = (by: number) => {
		if (!hasLines || !inLines) return;
		const from = cursor ?? (by > 0 ? -1 : draft.lines.length);
		const next = Math.min(draft.lines.length - 1, Math.max(0, from + by));
		select({ cursor: next, isAll: false });
	};

	const shift = (seconds: number, of: Scope | "selection") => {
		if (!inLines) return;
		change((from) => {
			const all = of === "all" || (of === "selection" && from.selection.isAll);
			const moved = all
				? shiftAll(from.draft, seconds)
				: from.selection.cursor === null
					? from.draft
					: shiftLine(from.draft, from.selection.cursor, seconds);
			return { draft: moved, selection: from.selection };
		});
	};

	const canEditLine = inLines && !isAll && cursor !== null;

	const stamp = () => {
		if (!canEditLine || !isSongPlaying) return;
		const at = clock.now();
		change((from) => {
			if (from.selection.cursor === null) return null;
			const stamped = stampLine(from.draft, from.selection.cursor, at);
			return {
				draft: stamped.draft,
				selection: { cursor: stamped.selected, isAll: false },
			};
		});
	};

	const selectedLine = cursor === null ? null : draft.lines[cursor];
	const playFromAt =
		canControlPlayback && canEditLine && selectedLine?.at != null
			? Math.max(0, selectedLine.at - PLAY_FROM_LEAD_SECONDS)
			: null;
	const playFrom = () => {
		if (playFromAt !== null && isSongPlaying) seek.mutate(playFromAt);
	};

	const lineBelow = () => {
		if (!inLines || isAll) return;
		const index = (cursor ?? -1) + 1;
		change((from) => {
			const added = insertLineBelow(from.draft, from.selection.cursor ?? -1);
			return {
				draft: added.draft,
				selection: { cursor: added.selected, isAll: false },
			};
		});
		if (!isPhone) openField(index, "");
	};

	const removeSelected = () => {
		if (!canEditLine) return;
		closeField();
		change((from) => {
			if (from.selection.cursor === null) return null;
			const removed = removeLine(from.draft, from.selection.cursor);
			return {
				draft: removed.draft,
				selection: { cursor: removed.selected, isAll: false },
			};
		});
	};

	const undoLast = () => {
		if (!inLines) return;
		closeField();
		undo();
	};

	const showText = () => {
		commitField();
		setText(pending);
		setView("text");
	};

	const showLines = () => {
		if (view === "lines") return;
		if (text !== serialiseDraft(draft)) {
			const read = draftFromText(text);
			change(() => ({
				draft: read,
				selection: { cursor: firstToWork(read), isAll: false },
			}));
		}
		setView("lines");
	};

	const save = async () => {
		if (!canSave) return;
		setIsSaving(true);
		const saved = await saveLyric(target, pending);
		if (!saved) {
			setIsSaving(false);
			return;
		}
		opening.onSaved?.();
		onClose();
	};

	useKeymap(
		SCOPE.lyricEditor,
		{
			lyricLineNext: () => moveCursor(1),
			lyricLinePrevious: () => moveCursor(-1),
			lyricEarlierTenth: () => shift(-TENTH, "selection"),
			lyricLaterTenth: () => shift(TENTH, "selection"),
			lyricEarlierSecond: () => shift(-SECOND, "selection"),
			lyricLaterSecond: () => shift(SECOND, "selection"),
			lyricSelectAll: () => {
				if (hasLines && inLines) select({ cursor, isAll: true });
			},
			lyricStamp: (event) => {
				if (!handBackToControl(event)) stamp();
			},
			lyricPlayFrom: playFrom,
			lyricEditWords: () => {
				if (canEditLine && cursor !== null) onEditWords(cursor);
			},
			lyricLineBelow: lineBelow,
			lyricRemoveLine: removeSelected,
			lyricUndo: undoLast,
			lyricSave: () => void save(),
		},
		{ owner: LYRIC_EDITOR_KEYBOARD },
	);

	useKeymap(
		SCOPE.global,
		{
			playPause: (event) => {
				event.preventDefault();
				playPause.mutate();
			},
			seekBack: () => {
				if (isSongPlaying) seekBy.mutate(-KEY_SEEK_SECONDS);
			},
			seekForward: () => {
				if (isSongPlaying) seekBy.mutate(KEY_SEEK_SECONDS);
			},
		},
		{ enabled: canControlPlayback, owner: LYRIC_EDITOR_KEYBOARD },
	);

	const lineIsTimed = selectedLine?.at != null;
	const scope: Scope = cursor === null ? "all" : phoneScope;

	const lineStepper = (
		<Stepper
			label={t("lyrics.thisLine")}
			showsLabel={!isPhone}
			size={isPhone ? "touch" : "inline"}
			readout={lineIsTimed ? undefined : t("lyrics.notTimed")}
			isReadoutQuiet
			disabled={!inLines || !lineIsTimed}
			onStep={(ms) => shift(ms / 1000, "line")}
		/>
	);

	const allStepper = (
		<Stepper
			label={t("lyrics.allLines")}
			showsLabel={!isPhone}
			size={isPhone ? "touch" : "inline"}
			disabled={!inLines || !hasTimes}
			onStep={(ms) => shift(ms / 1000, "all")}
		/>
	);

	const lineBelowButton = (
		<Button
			variant="ghost"
			icon={Plus}
			aria-label={isPhone ? t("lyrics.lineBelow") : undefined}
			onClick={lineBelow}
		>
			{isPhone ? null : t("lyrics.lineBelow")}
		</Button>
	);

	const tools = canEditLine ? (
		<LyricLineTools
			isPhone={isPhone}
			title={target.title}
			isSongPlaying={isSongPlaying}
			playFromAt={playFromAt}
			stepper={isPhone ? null : lineStepper}
			lineBelowButton={lineBelowButton}
			onPlayFrom={playFrom}
			onRemove={removeSelected}
		/>
	) : null;

	const playhead = isSongPlaying ? <Playhead clock={clock} /> : null;

	return (
		<div
			ref={layer}
			className={styles.layer}
			data-variant={variant}
			role="dialog"
			aria-labelledby={titleId}
			tabIndex={-1}
		>
			<LyricEditorHead
				isPhone={isPhone}
				titleId={titleId}
				target={target}
				view={view}
				changes={changes}
				canSave={canSave}
				onView={(next) => (next === "text" ? showText() : showLines())}
				onClose={requestClose}
				onUndo={undoLast}
				onSave={() => void save()}
			/>

			<div className={styles.body}>
				<div className={styles.main}>
					{other === null ? null : (
						<div className={styles.noticeRow}>
							<p className={styles.notice} role="status">
								<TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
								<span>
									<Trans
										phrase="lyrics.trackChanged"
										other={<b>{other}</b>}
										title={<b>{target.title}</b>}
									/>
								</span>
							</p>
						</div>
					)}
					<div className={styles.scroller}>
						{inLines ? (
							// biome-ignore lint/a11y/useSemanticElements: the rows are laid out with CSS grid, with the selected line's own controls under its words, which a table's layout cannot express
							<div
								className={styles.list}
								role="grid"
								aria-label={t("lyrics.editorLines")}
								aria-multiselectable="true"
							>
								{draft.headers.map((header, index) => (
									// biome-ignore lint/a11y/useSemanticElements: see the grid
									// biome-ignore lint/a11y/useFocusableInteractive: nothing selects a header, and a line's own button takes focus
									<div
										key={headerKey(draft.headers, index)}
										role="row"
										className={styles.row}
										data-header=""
									>
										{/* biome-ignore lint/a11y/useSemanticElements: see the grid */}
										{/* biome-ignore lint/a11y/useFocusableInteractive: see the row */}
										<div role="gridcell" className={styles.line}>
											<span className={styles.at}>{t("lyrics.header")}</span>
											<span className={styles.raw}>{header}</span>
										</div>
									</div>
								))}

								{draft.lines.map((line, index) => (
									<Fragment key={line.id}>
										{index === playheadSlot ? playhead : null}
										<LyricRow
											line={line}
											index={index}
											isSelected={isAll || index === cursor}
											field={field?.index === index ? field.value : null}
											ghost={ghosts[line.id] ?? null}
											onGhostEnd={dropGhost}
											tools={index === cursor ? tools : null}
											onSelect={onSelect}
											onEditWords={onEditWords}
											onFieldChange={onFieldChange}
											onFieldCommit={commitField}
											onFieldCancel={closeField}
											onRow={placeRow}
										/>
									</Fragment>
								))}
								{playheadSlot === draft.lines.length ? playhead : null}

								{hasLines ? null : (
									<div className={styles.empty}>{lineBelowButton}</div>
								)}
							</div>
						) : (
							<textarea
								className={styles.textarea}
								aria-label={t("lyrics.lyricText")}
								value={text}
								spellCheck={false}
								onChange={(event) => setText(event.target.value)}
							/>
						)}
					</div>
				</div>

				{isPhone ? null : (
					<LyricKeys
						canControlPlayback={canControlPlayback}
						isSongPlaying={isSongPlaying}
					/>
				)}
			</div>

			<LyricEditorDock
				isPhone={isPhone}
				clock={clock}
				snapshot={snapshot}
				notPlaying={notPlaying}
				canControlPlayback={canControlPlayback}
				canStamp={canEditLine}
				scope={scope}
				canChooseLine={cursor !== null}
				lineStepper={lineStepper}
				allStepper={allStepper}
				onScope={setPhoneScope}
				onStamp={stamp}
			/>
			{prompt}
		</div>
	);
}
