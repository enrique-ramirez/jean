import type { LucideIcon } from "lucide-react";
import {
	Disc3,
	GripVertical,
	Home,
	ListMusic,
	Pencil,
	Plus,
	Search,
	Shapes,
	Trash2,
	Undo2,
	Volume2,
	WandSparkles,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { useAutoPlaylists } from "@/domain/player/useAutoPlaylists";
import {
	untitledPlaylistName,
	usePlaylistActions,
} from "@/domain/player/usePlayer";
import { withoutScratchPlaylist } from "@/domain/track/jeanPlaylists";
import { isSearchRoute, ROUTE } from "@/domain/track/routes";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import type { PlaylistInfo } from "@/shared/api/types";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useSortableList } from "@/shared/hooks/useSortableList";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { hintFor, matchesBinding, SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { mergeHandlers, type PropBag } from "@/shared/lib/mergeHandlers";
import { randomId } from "@/shared/lib/randomId";
import { isRefusal } from "@/shared/lib/refusal";
import { ActionMenu, type ActionNode } from "@/shared/ui/ActionMenu";
import { useDragState } from "@/shared/ui/dnd";
import { pushToast } from "@/shared/ui/toastStore";
import { KIND_LABEL, type PlayingRoute } from "./routes";
import styles from "./Sidebar.module.css";
import { sidebarFocusAnswered, useSidebarFocusAsked } from "./sidebarFocus";

const PALETTE_HINT = hintFor("openPalette");

export type PlayableRow =
	| { kind: "all" }
	| { kind: "search" }
	| { kind: "playingFrom" }
	| { kind: "playlist"; id: string };

const hasFinePointer = () => window.matchMedia("(pointer: fine)").matches;

function NavRow({
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
	const t = useTranslate();
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
						aria-label={t("sidebar.playingFromHere")}
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

export function Sidebar({
	playlists,
	playingPlaylistId,
	selectedId,
	onSelect,
	search,
	isSearchOpen,
	onOpenSearch,
	route,
	onOpenRoute,
	onPlayRow,
	playingFrom,
	isOpen,
	isCollapsed,
	onDismiss,
}: {
	playlists: PlaylistInfo[];
	playingPlaylistId: string | null;
	selectedId: string | null | undefined;
	onSelect: (id: string) => void;
	search: LibrarySearch;
	isSearchOpen: boolean;
	onOpenSearch: (query?: string) => void;
	route: string;
	onOpenRoute: (route: string) => void;
	onPlayRow?: (row: PlayableRow) => void;
	playingFrom: PlayingRoute | null;
	isOpen: boolean;
	isCollapsed: boolean;
	onDismiss: () => void;
}) {
	const t = useTranslate();
	const format = useFormats();
	const { discovery } = useFooJean();
	const canEdit = permitsPlaylistWrites(discovery);
	const { create, rename, remove, move } = usePlaylistActions();
	const drag = useDragState();
	const autoPlaylists = useAutoPlaylists();

	const menu = useContextMenu({ disabled: !canEdit });
	const swipe = useSwipe({ onLeft: onDismiss });
	const [targetId, setTargetId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [pendingCreates, setPendingCreates] = useState(
		new Map<string, Promise<string | null>>(),
	);

	const shown = useMemo(() => withoutScratchPlaylist(playlists), [playlists]);

	const playingRoute = playingFrom?.isPlaying ? playingFrom.route : null;

	const playRow = (row: PlayableRow | null) =>
		onPlayRow && row !== null ? () => onPlayRow(row) : undefined;

	const target = shown.find((entry) => entry.id === targetId) ?? null;
	const focusedIndex = shown.findIndex((entry) => entry.id === focusedId);

	const playerIndexOf = (position: number) =>
		playlists.findIndex((entry) => entry.id === shown[position].id);

	const reorder = (from: number, to: number) =>
		move.mutate(
			{ id: shown[from].id, index: playerIndexOf(to) },
			{ onError: refused(t("playlist.reorderRefused")) },
		);

	const sortable = useSortableList({
		keys: shown.map((entry) => entry.id),
		disabled: !canEdit,
		onReorder: reorder,
	});

	const moveFocused = (delta: number) => {
		const to = focusedIndex + delta;
		if (focusedIndex < 0 || to < 0 || to >= shown.length) return;
		reorder(focusedIndex, to);
	};

	useKeymap(
		SCOPE.sidebar,
		{
			movePlaylistUp: () => moveFocused(-1),
			movePlaylistDown: () => moveFocused(1),
		},
		{ enabled: canEdit && focusedIndex >= 0 },
	);

	const navRows = useCallback(
		() => [
			...(sortable.scrollRef.current?.querySelectorAll<HTMLElement>(
				"[data-nav-row]",
			) ?? []),
		],
		[sortable.scrollRef],
	);

	const focusAsked = useSidebarFocusAsked();
	useEffect(() => {
		if (!focusAsked) return;
		sidebarFocusAnswered();

		const rows = navRows();
		const current = rows.find(
			(row) => row.getAttribute("aria-current") === "true",
		);
		(current ?? rows[0])?.focus();
	}, [focusAsked, navRows]);

	const onArrows = (event: ReactKeyboardEvent) => {
		if (event.altKey) return;

		// Stopped rather than prevented: the default here is the click a focused button gets, and the track list binds Enter to playing its cursor row with a preventDefault that would cancel it.
		if (event.key === "Enter") {
			event.stopPropagation();
			return;
		}

		const delta =
			event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (delta === 0) return;

		event.preventDefault();
		event.stopPropagation();

		const rows = navRows();
		const at = rows.indexOf(document.activeElement as HTMLElement);
		const next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : at + delta;
		rows[Math.min(Math.max(next, 0), rows.length - 1)]?.focus();
	};

	const refused = (message: string) => (error: unknown) =>
		pushToast({
			tone: "error",
			message: isRefusal(error) ? error.message : message,
		});

	const newPlaylist = () => {
		const id = `pending:${randomId()}`;
		const title = untitledPlaylistName(shown);
		setRenamingId(id);

		const landed = create.mutateAsync({ id, title }).then(
			(playlist) => {
				setRenamingId((current) => (current === id ? playlist.id : current));
				return playlist.id;
			},
			(error) => {
				refused(t("playlist.createRefused"))(error);
				return null;
			},
		);

		setPendingCreates((current) => new Map(current).set(id, landed));
		landed.finally(() =>
			setPendingCreates((current) => {
				if (!current.has(id)) return current;
				const next = new Map(current);
				next.delete(id);
				return next;
			}),
		);
	};

	const deletePlaylist = (playlist: PlaylistInfo) => {
		if (playlist.id === selectedId) {
			const at = shown.findIndex((entry) => entry.id === playlist.id);
			const next = shown[at + 1] ?? shown[at - 1];
			if (next) onSelect(next.id);
		}
		remove.mutate(playlist.id, {
			onError: refused(
				t("playlist.deleteFailed", { playlist: playlist.title }),
			),
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: deletePlaylist's own captures, listed instead of it
	const actions = useMemo((): ActionNode[] => {
		if (!target) return [];

		return [
			{
				id: "rename",
				label: t("action.rename"),
				icon: Pencil,
				onSelect: () => setRenamingId(target.id),
			},
			{ type: "separator" },
			{
				id: "delete",
				label: t("action.delete"),
				icon: Trash2,
				danger: true,
				items: [
					{
						type: "message",
						text: t("playlist.deleteWarning", {
							playlist: target.title,
							count: target.itemCount,
						}),
					},
					{
						id: "confirm",
						label: t("playlist.delete"),
						icon: Trash2,
						danger: true,
						onSelect: () => deletePlaylist(target),
					},
					{ id: "cancel", label: t("playlist.keepIt"), icon: Undo2 },
				],
			},
		];
	}, [target, shown, selectedId, t]);

	return (
		<>
			{isOpen ? (
				<button
					type="button"
					className={styles.scrim}
					aria-label={t("sidebar.closeMenu")}
					onClick={onDismiss}
				/>
			) : null}
			<nav
				className={styles.sidebar}
				ref={sortable.scrollRef}
				data-open={isOpen}
				data-collapsed={isCollapsed}
				data-reordering={sortable.isDragging ? "true" : undefined}
				data-drop-scroller=""
				data-receiving={drag.isDragging ? "true" : undefined}
				aria-label={t("sidebar.playlists")}
				aria-hidden={isCollapsed}
				onKeyDown={onArrows}
				{...swipe}
			>
				<NavRow
					icon={Home}
					label={t("sidebar.home")}
					isCurrent={route === "" || route === "home"}
					onClick={() => onOpenRoute("home")}
				/>

				<NavRow
					icon={Disc3}
					label={t("library.allMusic")}
					isPlaying={playingRoute === "all"}
					isCurrent={route === "all"}
					onClick={() => onOpenRoute("all")}
					onPlay={playRow({ kind: "all" })}
				/>

				<NavRow
					icon={Shapes}
					label={t("home.genres")}
					isCurrent={route === ROUTE.genres}
					onClick={() => onOpenRoute(ROUTE.genres)}
				/>

				{search.hasQuery || search.remembered ? (
					<>
						<p className={styles.heading}>{t("search.title")}</p>
						<NavRow
							icon={Search}
							label={search.query || search.remembered}
							count={search.hasQuery ? format.number(search.matchCount) : ""}
							isPlaying={playingRoute !== null && isSearchRoute(playingRoute)}
							isCurrent={isSearchOpen}
							onClick={() =>
								onOpenSearch(search.query || search.remembered || undefined)
							}
							onPlay={playRow(search.hasQuery ? { kind: "search" } : null)}
						/>
					</>
				) : null}

				{playingFrom?.temporaryRow ? (
					<>
						<p className={styles.heading}>
							{t(KIND_LABEL[playingFrom.kind] ?? "playlist.playingFrom")}
						</p>
						<NavRow
							icon={Disc3}
							label={playingFrom.name}
							count={format.number(playingFrom.itemCount)}
							isPlaying={playingFrom.isPlaying}
							isCurrent={route === playingFrom.route}
							onClick={() => onOpenRoute(playingFrom.route)}
							onPlay={playRow({ kind: "playingFrom" })}
						/>
					</>
				) : null}

				<div className={styles.sectionHeader}>
					<p className={styles.heading}>
						{t("sidebar.playlists")}
						{PALETTE_HINT ? (
							<kbd className={styles.hint}>{PALETTE_HINT}</kbd>
						) : null}
					</p>
					{canEdit ? (
						<button
							type="button"
							className={styles.add}
							aria-label={t("playlist.new")}
							disabled={create.isPending}
							onClick={newPlaylist}
						>
							<Plus size={15} strokeWidth={2.4} aria-hidden="true" />
						</button>
					) : null}
				</div>
				{shown.map((playlist, index) => (
					<PlaylistRow
						key={playlist.id}
						playlist={playlist}
						isPlaying={playlist.id === playingPlaylistId}
						isSelected={playlist.id === selectedId}
						isRenaming={playlist.id === renamingId}
						isPending={pendingCreates.has(playlist.id)}
						isAuto={autoPlaylists.has(playlist.id)}
						isDropTarget={
							canEdit && drag.isDragging && !pendingCreates.has(playlist.id)
						}
						isDropOver={drag.over === playlist.id}
						canEdit={canEdit}
						rowProps={sortable.itemProps(index)}
						dragProps={sortable.dragProps(index)}
						handleProps={sortable.handleProps(index)}
						menuProps={{
							...menu.triggerProps,
							onPointerDown: (event: ReactPointerEvent) => {
								setTargetId(playlist.id);
								menu.triggerProps.onPointerDown(event);
							},
							onContextMenu: (event: ReactMouseEvent) => {
								setTargetId(playlist.id);
								menu.triggerProps.onContextMenu(event);
							},
						}}
						onSelect={
							pendingCreates.has(playlist.id)
								? undefined
								: () => onSelect(playlist.id)
						}
						onPlay={playRow({ kind: "playlist", id: playlist.id })}
						onFocus={() => setFocusedId(playlist.id)}
						onBlur={() =>
							setFocusedId((current) =>
								current === playlist.id ? null : current,
							)
						}
						onRename={(title) => {
							setRenamingId(null);

							const pending = pendingCreates.get(playlist.id);
							if (pending) {
								if (title) {
									pending.then((id) => {
										if (id && title !== playlist.title)
											rename.mutate(
												{ id, title },
												{
													onError: refused(
														t("playlist.renameFailed", { playlist: title }),
													),
												},
											);
									});
								}
								return;
							}

							if (title && title !== playlist.title) {
								rename.mutate(
									{ id: playlist.id, title },
									{
										onError: refused(
											t("playlist.renameFailed", { playlist: playlist.title }),
										),
									},
								);
							}
						}}
					/>
				))}
			</nav>

			<ActionMenu
				isOpen={menu.isOpen && target !== null}
				anchor={menu.anchor}
				header={
					target
						? {
								icon: ListMusic,
								title: target.title,
								subtitle: t("view.trackCount", {
									count: target.itemCount,
									total: target.itemCount,
								}),
							}
						: null
				}
				actions={actions}
				onDismiss={menu.close}
			/>
		</>
	);
}

function PlaylistRow({
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
