import type { LucideIcon } from "lucide-react";
import { GripVertical, ListMusic, Volume2, WandSparkles } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { PlaylistInfo } from "@/shared/api/types";
import {
	useFormats,
	useSpoken,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { matchesBinding } from "@/shared/keyboard/keymap";
import { mergeHandlers, type PropBag } from "@/shared/lib/mergeHandlers";
import styles from "./Sidebar.module.css";

const hasFinePointer = () => window.matchMedia("(pointer: fine)").matches;

export function NavRow({
	icon: Icon,
	label,
	count,
	isPlaying,
	isCurrent,
	onClick,
	onPlay,
	rowProps,
	itemProps,
	children,
}: {
	icon: LucideIcon;
	label: ReactNode;
	count?: ReactNode;
	isPlaying?: boolean;
	isCurrent?: boolean;
	onClick?: () => void;
	onPlay?: () => void;
	rowProps?: PropBag;
	itemProps?: PropBag;
	children?: ReactNode;
}) {
	const say = useSpoken();
	return (
		<div className={styles.row} {...rowProps}>
			<button
				type="button"
				className={styles.item}
				aria-current={isCurrent}
				onClick={onClick}
				onDoubleClick={
					onPlay
						? () => {
								if (hasFinePointer()) onPlay();
							}
						: undefined
				}
				onKeyDown={
					onPlay
						? (event) => {
								if (!matchesBinding(event.nativeEvent, "playAll")) return;
								event.preventDefault();
								event.stopPropagation();
								onPlay();
							}
						: undefined
				}
				data-nav-row=""
				{...itemProps}
			>
				{isPlaying ? (
					<Volume2
						size={15}
						strokeWidth={2}
						className={styles.playing}
						aria-label={say("sidebar.playingFromHere")}
					/>
				) : (
					<Icon size={15} strokeWidth={2} aria-hidden="true" />
				)}
				<span className={styles.label}>{label}</span>
				{count == null ? null : <span className={styles.count}>{count}</span>}
			</button>
			{children}
		</div>
	);
}

export function PlaylistRow({
	playlist,
	isPlaying,
	isSelected,
	isRenaming,
	isPending,
	isAuto,
	isDropTarget,
	isDropOver,
	canEdit,
	rowProps,
	dragProps,
	handleProps,
	menuProps,
	onSelect,
	onPlay,
	onFocus,
	onBlur,
	onRename,
}: {
	playlist: PlaylistInfo;
	isPlaying: boolean;
	isSelected: boolean;
	isRenaming: boolean;
	isPending: boolean;
	isAuto: boolean;
	isDropTarget: boolean;
	isDropOver: boolean;
	canEdit: boolean;
	rowProps: PropBag;
	dragProps: PropBag;
	handleProps: PropBag;
	menuProps: PropBag;
	onSelect?: () => void;
	onPlay?: () => void;
	onFocus: () => void;
	onBlur: () => void;
	onRename: (title: string | null) => void;
}) {
	const t = useTranslate();
	const format = useFormats();
	const { style: pressableStyle, ...gestures } = menuProps;
	const { style: dragStyle, ref, ...rowState } = rowProps;

	if (isRenaming) {
		return (
			<div className={styles.row} ref={ref} style={dragStyle} {...rowState}>
				<RenameField title={playlist.title} onCommit={onRename} />
			</div>
		);
	}

	if (isPending) {
		return (
			<NavRow
				icon={isAuto ? WandSparkles : ListMusic}
				label={playlist.title}
				count={format.number(playlist.itemCount)}
				rowProps={{ ref, style: dragStyle, ...rowState }}
			/>
		);
	}

	return (
		<NavRow
			icon={isAuto ? WandSparkles : ListMusic}
			label={playlist.title}
			count={format.number(playlist.itemCount)}
			isPlaying={isPlaying}
			isCurrent={isSelected}
			onClick={onSelect}
			onPlay={onPlay}
			itemProps={{ onFocus, onBlur }}
			rowProps={{
				ref,
				style: { ...pressableStyle, ...dragStyle },
				"data-drop-target": isDropTarget ? playlist.id : undefined,
				"data-drop-over": isDropOver ? "true" : undefined,
				"data-drop-refuses": isAuto ? t("playlist.autoRefuses") : undefined,
				...rowState,
				...mergeHandlers(gestures, dragProps),
			}}
		>
			{canEdit ? (
				<span
					className={styles.grip}
					aria-hidden="true"
					onPointerDown={(event) => {
						event.stopPropagation();
						handleProps.onPointerDown?.(event);
					}}
				>
					<GripVertical size={15} strokeWidth={2} />
				</span>
			) : null}
		</NavRow>
	);
}

function RenameField({
	title,
	onCommit,
}: {
	title: string;
	onCommit: (title: string | null) => void;
}) {
	const t = useTranslate();
	const [value, setValue] = useState(title);
	const cancelled = useRef(false);

	return (
		<form
			className={styles.renameForm}
			onSubmit={(event) => {
				event.preventDefault();
				onCommit(value.trim());
			}}
		>
			<input
				className={styles.renameInput}
				value={value}
				aria-label={t("playlist.renameOne", { playlist: title })}
				spellCheck="false"
				autoComplete="off"
				// biome-ignore lint/a11y/noAutofocus: rename is the state
				autoFocus
				onFocus={(event) => event.target.select()}
				onChange={(event) => setValue(event.target.value)}
				onBlur={() =>
					cancelled.current ? onCommit(null) : onCommit(value.trim())
				}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					cancelled.current = true;
					event.stopPropagation();
					event.currentTarget.blur();
				}}
			/>
		</form>
	);
}
