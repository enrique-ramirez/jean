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
	canChangePlaylists,
	untitledPlaylistName,
	usePermissions,
	usePlaylistActions,
} from "@/domain/player/usePlayer";
import { ALL_MUSIC, withoutJeanPlaylists } from "@/domain/track/jeanPlaylists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { useSortableList } from "@/shared/hooks/useSortableList";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { mergeHandlers, type PropBag } from "@/shared/lib/mergeHandlers";
import { isRefusal } from "@/shared/lib/refusal";
import { plural } from "@/shared/lib/text";
import { ActionMenu, type ActionNode } from "@/shared/ui/ActionMenu";
import { useDragState } from "@/shared/ui/dnd";
import { pushToast } from "@/shared/ui/toastStore";
import { type PlayingRoute, ROUTE } from "./routes";
import styles from "./Sidebar.module.css";
import { sidebarFocusAnswered, useSidebarFocusAsked } from "./sidebarFocus";

function NavRow({
	icon: Icon,
	label,
	count,
	isPlaying,
	isCurrent,
	isNested,
	onClick,
	rowProps,
	itemProps,
	children,
}: {
	icon: LucideIcon;
	label: ReactNode;
	count?: ReactNode;
	isPlaying?: boolean;
	isCurrent?: boolean;
	isNested?: boolean;
	onClick?: () => void;
	rowProps?: PropBag;
	itemProps?: PropBag;
	children?: ReactNode;
}) {
	return (
		<div className={styles.row} data-nested={isNested} {...rowProps}>
			<button
				type="button"
				className={styles.item}
				aria-current={isCurrent}
				onClick={onClick}
				data-nav-row=""
				{...itemProps}
			>
				{isPlaying ? (
					<Volume2
						size={15}
						strokeWidth={2}
						className={styles.playing}
						aria-label="Playing from here"
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
	selectedId,
	onSelect,
	search,
	isSearchOpen,
	onOpenSearch,
	route,
	onOpenRoute,
	playingFrom,
	isOpen,
	isCollapsed,
	onDismiss,
}: {
	playlists: PlaylistInfo[];
	selectedId: string | null | undefined;
	onSelect: (id: string) => void;
	search: LibrarySearch;
	isSearchOpen: boolean;
	onOpenSearch: () => void;
	route: string;
	onOpenRoute: (route: string) => void;
	playingFrom: PlayingRoute | null;
	isOpen: boolean;
	isCollapsed: boolean;
	onDismiss: () => void;
}) {
	const permissions = usePermissions();
	const { create, rename, remove, move } = usePlaylistActions();
	const drag = useDragState();
	const autoPlaylists = useAutoPlaylists();
	const canEdit = canChangePlaylists(permissions);

	const menu = useContextMenu({ disabled: !canEdit });
	const [targetId, setTargetId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);

	const shown = useMemo(() => withoutJeanPlaylists(playlists), [playlists]);

	const playingRoute = playingFrom?.isPlaying ? playingFrom.route : null;

	const target = shown.find((entry) => entry.id === targetId) ?? null;
	const focusedIndex = shown.findIndex((entry) => entry.id === focusedId);

	const playerIndexOf = (position: number) =>
		playlists.findIndex((entry) => entry.id === shown[position].id);

	const reorder = (from: number, to: number) =>
		move.mutate(
			{ id: shown[from].id, index: playerIndexOf(to) },
			{ onError: refused("The player would not reorder that.") },
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

	const newPlaylist = () =>
		create.mutate(untitledPlaylistName(shown), {
			onSuccess: (playlist) => setRenamingId(playlist.id),
			onError: refused("The player would not create a playlist."),
		});

	const deletePlaylist = (playlist: PlaylistInfo) => {
		if (playlist.id === selectedId) {
			const at = shown.findIndex((entry) => entry.id === playlist.id);
			const next = shown[at + 1] ?? shown[at - 1];
			if (next) onSelect(next.id);
		}
		remove.mutate(playlist.id, {
			onError: refused(`${playlist.title} could not be deleted.`),
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: deletePlaylist's own captures, listed instead of it
	const actions = useMemo((): ActionNode[] => {
		if (!target) return [];

		return [
			{
				id: "rename",
				label: "Rename",
				icon: Pencil,
				onSelect: () => setRenamingId(target.id),
			},
			{ type: "separator" },
			{
				id: "delete",
				label: "Delete",
				icon: Trash2,
				danger: true,
				items: [
					{
						type: "message",
						text: `${target.title} will be removed from the player. Its ${target.itemCount.toLocaleString()} tracks stay where they are on disk.`,
					},
					{
						id: "confirm",
						label: "Delete playlist",
						icon: Trash2,
						danger: true,
						onSelect: () => deletePlaylist(target),
					},
					{ id: "cancel", label: "Keep it", icon: Undo2 },
				],
			},
		];
	}, [target, shown, selectedId]);

	return (
		<>
			{isOpen ? (
				<button
					type="button"
					className={styles.scrim}
					aria-label="Close menu"
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
				aria-label="Playlists"
				aria-hidden={isCollapsed}
				onKeyDown={onArrows}
			>
				{search.hasQuery || search.remembered ? (
					<>
						<p className={styles.heading}>Search</p>
						<NavRow
							icon={Search}
							label={search.query || search.remembered}
							count={search.hasQuery ? search.matchCount.toLocaleString() : ""}
							isPlaying={playingRoute === "search"}
							isCurrent={isSearchOpen}
							onClick={() => {
								if (!search.hasQuery) search.restore();
								onOpenSearch();
							}}
						/>
					</>
				) : null}

				<NavRow
					icon={Home}
					label="Home"
					isCurrent={route === "" || route === "home"}
					onClick={() => onOpenRoute("home")}
				/>

				<NavRow
					icon={Disc3}
					label={ALL_MUSIC}
					isPlaying={playingRoute === "all"}
					isCurrent={route === "all"}
					onClick={() => onOpenRoute("all")}
				/>

				<NavRow
					icon={Shapes}
					label="Genres"
					isNested
					isCurrent={route === ROUTE.genres}
					onClick={() => onOpenRoute(ROUTE.genres)}
				/>

				{playingFrom?.temporaryRow ? (
					<NavRow
						icon={Disc3}
						label={playingFrom.name}
						isPlaying={playingFrom.isPlaying}
						isCurrent={route === playingFrom.route}
						onClick={() => onOpenRoute(playingFrom.route)}
					/>
				) : null}

				<div className={styles.sectionHeader}>
					<p className={styles.heading}>Playlists</p>
					{canEdit ? (
						<button
							type="button"
							className={styles.add}
							aria-label="New playlist"
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
						isSelected={playlist.id === selectedId}
						isRenaming={playlist.id === renamingId}
						isAuto={autoPlaylists.has(playlist.id)}
						isDropTarget={canEdit && drag.isDragging}
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
						onSelect={() => onSelect(playlist.id)}
						onFocus={() => setFocusedId(playlist.id)}
						onBlur={() =>
							setFocusedId((current) =>
								current === playlist.id ? null : current,
							)
						}
						onRename={(title) => {
							setRenamingId(null);
							if (title && title !== playlist.title) {
								rename.mutate(
									{ id: playlist.id, title },
									{
										onError: refused(`${playlist.title} could not be renamed.`),
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
								subtitle: plural(target.itemCount, "track"),
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
	isSelected,
	isRenaming,
	isAuto,
	isDropTarget,
	isDropOver,
	canEdit,
	rowProps,
	dragProps,
	handleProps,
	menuProps,
	onSelect,
	onFocus,
	onBlur,
	onRename,
}: {
	playlist: PlaylistInfo;
	isSelected: boolean;
	isRenaming: boolean;
	isAuto: boolean;
	isDropTarget: boolean;
	isDropOver: boolean;
	canEdit: boolean;
	rowProps: PropBag;
	dragProps: PropBag;
	handleProps: PropBag;
	menuProps: PropBag;
	onSelect: () => void;
	onFocus: () => void;
	onBlur: () => void;
	onRename: (title: string | null) => void;
}) {
	const { style: pressableStyle, ...gestures } = menuProps;
	const { style: dragStyle, ref, ...rowState } = rowProps;

	if (isRenaming) {
		return (
			<div className={styles.row} ref={ref} style={dragStyle} {...rowState}>
				<RenameField title={playlist.title} onCommit={onRename} />
			</div>
		);
	}

	return (
		<NavRow
			icon={isAuto ? WandSparkles : ListMusic}
			label={playlist.title}
			count={playlist.itemCount.toLocaleString()}
			isPlaying={playlist.isCurrent}
			isCurrent={isSelected}
			onClick={onSelect}
			itemProps={{ onFocus, onBlur }}
			rowProps={{
				ref,
				style: { ...pressableStyle, ...dragStyle },
				"data-drop-target": isDropTarget ? playlist.id : undefined,
				"data-drop-over": isDropOver ? "true" : undefined,
				"data-drop-refuses": isAuto
					? "Autoplaylists fill themselves"
					: undefined,
				...rowState,
				// Merged rather than spread: both objects set onPointerDown, Move, Up and Cancel, and the second would win all four.
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
				aria-label={`Rename ${title}`}
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
