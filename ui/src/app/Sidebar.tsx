import { Disc3, Home, ListMusic, Plus, Search, Shapes } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { useAutoPlaylists } from "@/domain/player/useAutoPlaylists";
import { withoutScratchPlaylist } from "@/domain/track/jeanPlaylists";
import { isSearchRoute, ROUTE } from "@/domain/track/routes";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import type { PlaylistInfo } from "@/shared/api/types";
import { useContextMenu } from "@/shared/hooks/useContextMenu";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useSortableList } from "@/shared/hooks/useSortableList";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { hintFor, SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { rovedIndex } from "@/shared/lib/rove";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { useDragState } from "@/shared/ui/dnd";
import { KIND_LABEL, type PlayingRoute } from "./routes";
import styles from "./Sidebar.module.css";
import { NavRow, PlaylistRow } from "./SidebarRows";
import { sidebarFocusAnswered, useSidebarFocusAsked } from "./sidebarFocus";
import { usePlaylistEditing } from "./usePlaylistEditing";

const PALETTE_HINT = hintFor("openPalette");

export type PlayableRow =
	| { kind: "all" }
	| { kind: "search" }
	| { kind: "playingFrom" }
	| { kind: "playlist"; id: string };

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
	const drag = useDragState();
	const autoPlaylists = useAutoPlaylists();

	const menu = useContextMenu({ disabled: !canEdit });
	const swipe = useSwipe({ onLeft: onDismiss });
	const [targetId, setTargetId] = useState<string | null>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);

	const shown = useMemo(() => withoutScratchPlaylist(playlists), [playlists]);

	const playingRoute = playingFrom?.isPlaying ? playingFrom.route : null;

	const playRow = (row: PlayableRow | null) =>
		onPlayRow && row !== null ? () => onPlayRow(row) : undefined;

	const target = shown.find((entry) => entry.id === targetId) ?? null;
	const focusedIndex = shown.findIndex((entry) => entry.id === focusedId);

	const {
		renamingId,
		pendingCreates,
		isCreating,
		newPlaylist,
		reorder,
		commitRename,
		actions,
	} = usePlaylistEditing({ playlists, shown, target, selectedId, onSelect });

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

		const rows = navRows();
		const next = rovedIndex(
			event.key,
			rows.indexOf(document.activeElement as HTMLElement),
			rows.length,
		);
		if (next === null) return;

		event.preventDefault();
		event.stopPropagation();
		rows[next]?.focus();
	};

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
							disabled={isCreating}
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
						onRename={(title) => commitRename(playlist, title)}
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
