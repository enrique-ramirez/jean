import {
	Check,
	FileText,
	List,
	Play,
	Plus,
	Trash2,
	TriangleAlert,
	Undo2,
	X,
} from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import {
	KEY_SEEK_SECONDS,
	usePlayPause,
	useSeek,
	useSeekBy,
} from "@/domain/player/useTransport";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { Trans } from "@/shared/i18n/Trans";
import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { KeyCap } from "./KeyCap";
import styles from "./LyricEditor.module.css";
import { LyricKeys } from "./LyricKeys";
import { LyricRow, Playhead } from "./LyricRow";
import { type Scope, ScopeSwitch, Stepper } from "./LyricStepper";
import { EditorClock, EditorTransport, StampButton } from "./LyricTransport";
import {
	clockOf,
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
import { useDiscardGuard } from "./useDiscardGuard";
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
const DOUBLE_CLICK_MS = 300;

type View = "lines" | "text";

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

interface Field {
	index: number;
	value: string;
}

export function LyricEditor({
	opening,
	variant,
	snapshot,
	onClose,
}: {
	opening: EditorOpening;
	variant: "gatefold" | "screen";
	snapshot: PlayerSnapshot | null | undefined;
	onClose: () => void;
}) {
	const t = useTranslate();
	const say = useSpoken();
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
	const [view, setView] = useState<View>("lines");
	const [text, setText] = useState("");
	const [field, setFieldState] = useState<Field | null>(null);
	const fieldRef = useRef<Field | null>(null);
	const [phoneScope, setPhoneScope] = useState<Scope>("line");
	const [isSaving, setIsSaving] = useState(false);
	const [held] = useState(() => serialiseDraft(draftFromText(opening.held)));

	const setField = useCallback((next: Field | null) => {
		fieldRef.current = next;
		setFieldState(next);
	}, []);

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
	const rows = useRef<(HTMLDivElement | null)[]>([]);
	const hasPlaced = useRef(false);

	const [opener] = useState(() => document.activeElement as HTMLElement | null);
	useEffect(() => {
		layer.current?.focus();
		return () => {
			if (opener?.isConnected) opener.focus();
		};
	}, [opener]);

	const playheadSlot = useAudibleValue(
		clock,
		(seconds) =>
			draft.lines.findLastIndex(
				(line) => line.at !== null && line.at <= wholeTenths(seconds),
			) + 1,
	);

	const selectedId = cursor === null ? null : (draft.lines[cursor]?.id ?? null);

	// A browser drops the focus to the page when the focused element is removed.
	const seen = useRef({ id: selectedId, index: cursor });
	const refocus = useRef(false);
	if (seen.current.id !== selectedId) {
		refocus.current =
			(rows.current[seen.current.index ?? -1]?.contains(
				document.activeElement,
			) ??
				false) &&
			!(document.activeElement instanceof HTMLInputElement);
		seen.current = { id: selectedId, index: cursor };
	}

	const fromPointer = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new selection fires this, it is not read here
	useEffect(() => {
		const row = rows.current[cursor ?? -1];
		const reveal = () =>
			row?.scrollIntoView({ block: hasPlaced.current ? "nearest" : "center" });
		const wasPointer = fromPointer.current;
		fromPointer.current = false;
		if (refocus.current && !fieldRef.current)
			row?.querySelector("button")?.focus();
		refocus.current = false;
		if (!wasPointer) {
			reveal();
			hasPlaced.current = true;
			return undefined;
		}
		hasPlaced.current = true;
		const timer = setTimeout(reveal, DOUBLE_CLICK_MS);
		return () => clearTimeout(timer);
	}, [selectedId, cursor]);

	const [ghosts, setGhosts] = useState<Record<number, number>>({});
	const dropGhost = useCallback(
		(id: number) =>
			setGhosts((current) => {
				const { [id]: _gone, ...rest } = current;
				return rest;
			}),
		[],
	);

	const onSelect = useCallback(
		(index: number) => {
			const left = seen.current;
			const tools =
				rows.current[left.index ?? -1]?.querySelector<HTMLElement>(
					"[data-tools]",
				);
			if (tools && left.id !== null && index !== left.index) {
				const { id } = left;
				setGhosts((current) => ({ ...current, [id]: tools.offsetHeight }));
			}
			const chosen = draftRef.current.lines[index]?.id;
			if (chosen !== undefined) dropGhost(chosen);
			fromPointer.current = index !== left.index;
			select({ cursor: index, isAll: false });
			setPhoneScope("line");
		},
		[select, dropGhost],
	);

	const placeRow = useCallback(
		(index: number, element: HTMLDivElement | null) => {
			rows.current[index] = element;
		},
		[],
	);

	const commitField = useCallback(() => {
		const open = fieldRef.current;
		if (!open) return;
		setField(null);
		change((from) => {
			const line = from.draft.lines[open.index];
			if (!line || line.text === open.value) return null;
			return {
				draft: setLineText(from.draft, open.index, open.value),
				selection: from.selection,
			};
		});
	}, [change, setField]);

	const openField = useCallback(
		(index: number, value: string) => setField({ index, value }),
		[setField],
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

	const onFieldChange = useCallback(
		(value: string) => {
			if (fieldRef.current) setField({ ...fieldRef.current, value });
		},
		[setField],
	);

	const onFieldCancel = useCallback(() => setField(null), [setField]);

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
		setField(null);
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
		setField(null);
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
				if (!handBackToControl(event)) playPause.mutate();
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

	const toolsOf = (): ReactNode =>
		canEditLine ? (
			<div className={styles.tools} data-tools="">
				{isPhone ? null : lineStepper}
				{playFromAt === null ? null : (
					<Button
						icon={Play}
						aria-disabled={isSongPlaying ? undefined : "true"}
						aria-label={
							isSongPlaying
								? say("lyrics.playFrom", { time: clockOf(playFromAt) })
								: say("lyrics.inertName", {
										control: say("lyrics.playFrom", {
											time: clockOf(playFromAt),
										}),
										title: target.title,
									})
						}
						onClick={isSongPlaying ? playFrom : undefined}
					>
						{t(isPhone ? "lyrics.playFromShort" : "lyrics.playFrom", {
							time: clockOf(playFromAt),
						})}
					</Button>
				)}
				<span className={styles.spacer} />
				{lineBelowButton}
				<Button
					variant="ghost"
					icon={Trash2}
					className={styles.remove}
					aria-label={isPhone ? t("lyrics.removeLine") : undefined}
					onClick={removeSelected}
				>
					{isPhone ? null : t("lyrics.removeLine")}
				</Button>
			</div>
		) : null;

	const playhead = isSongPlaying ? <Playhead clock={clock} /> : null;

	const views = (
		<Segmented<View>
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
			onChange={(next) => (next === "text" ? showText() : showLines())}
		/>
	);

	const changeCount =
		changes > 0 ? (
			<span className={styles.changes}>
				{t("lyrics.editorChanges", { count: changes })}
			</span>
		) : null;

	return (
		<div
			ref={layer}
			className={styles.layer}
			data-variant={variant}
			role="dialog"
			aria-labelledby={titleId}
			tabIndex={-1}
		>
			<header className={styles.head}>
				<button
					type="button"
					className={styles.close}
					aria-label={t("lyrics.editorClose")}
					onClick={requestClose}
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
						disabled={changes === 0 || !inLines}
						onClick={undoLast}
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
						onClick={() => void save()}
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
											tools={index === cursor ? toolsOf() : null}
											onSelect={onSelect}
											onEditWords={onEditWords}
											onFieldChange={onFieldChange}
											onFieldCommit={commitField}
											onFieldCancel={onFieldCancel}
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

			{isPhone ? (
				<div className={styles.dock}>
					<div className={styles.dockRow}>
						<ScopeSwitch
							scope={scope}
							canChooseLine={cursor !== null}
							onChange={setPhoneScope}
						/>
						<EditorClock
							clock={clock}
							snapshot={snapshot}
							showsBar={false}
							notPlaying={notPlaying}
						/>
					</div>
					{scope === "line" ? lineStepper : allStepper}
					<div className={styles.transport}>
						<EditorTransport
							snapshot={snapshot}
							canControlPlayback={canControlPlayback}
							notPlaying={notPlaying}
						/>
						<StampButton
							size="large"
							disabled={!canEditLine}
							notPlaying={notPlaying}
							onStamp={stamp}
						/>
					</div>
				</div>
			) : (
				<div className={styles.foot}>
					<EditorClock
						clock={clock}
						snapshot={snapshot}
						showsBar
						notPlaying={notPlaying}
					/>
					<div className={styles.transport}>
						<EditorTransport
							snapshot={snapshot}
							canControlPlayback={canControlPlayback}
							notPlaying={notPlaying}
						/>
						<StampButton
							size="inline"
							disabled={!canEditLine}
							notPlaying={notPlaying}
							onStamp={stamp}
						/>
					</div>
					<div className={styles.whole}>{allStepper}</div>
				</div>
			)}
			{prompt}
		</div>
	);
}
