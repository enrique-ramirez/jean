import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "@/domain/library/useLibrary";
import {
	type Suggestion,
	useLibrarySearch,
} from "@/domain/library/useLibrarySearch";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { usePlaySet } from "@/domain/library/usePlaySet";
import { useConnection } from "@/domain/player/connection";
import { usePlayerPoll } from "@/domain/player/playerPoll";
import { queueShown, useShowQueueAsked } from "@/domain/player/showQueue";
import { useOutputs } from "@/domain/player/useOutputs";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useIsPlaying, usePlayer } from "@/domain/player/usePlayer";
import {
	usePlaylists,
	useResolvedPlaylistId,
} from "@/domain/player/usePlaylists";
import { usePlayItem } from "@/domain/player/useTransport";
import {
	isScratchPlaylist,
	SCRATCH_KIND,
	withoutScratchPlaylist,
} from "@/domain/track/jeanPlaylists";
import { askToJump } from "@/domain/track/jumpToPlaying";
import {
	isPlayingRoute,
	type PanelTab,
	panelOfRoute,
	ROUTE,
	playingRoute as routeOfPanel,
	searchRoute,
} from "@/domain/track/routes";
import { TagWriterProvider } from "@/domain/track/useTagWriter";
import { useHomePlayback } from "@/features/home/useHomePlayback";
import { NowPlaying } from "@/features/now-playing/NowPlaying";
import { StatusBar } from "@/features/now-playing/StatusBar";
import { QueuePanel } from "@/features/queue/QueuePanel";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { permitsPlaybackControl } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useTheme } from "@/shared/hooks/useTheme";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { ShortcutSheet } from "@/shared/keyboard/ShortcutSheet";
import { animateScrollTo } from "@/shared/ui/animateScroll";
import { DragGhost } from "@/shared/ui/DragGhost";
import { Toasts } from "@/shared/ui/Toasts";
import styles from "./App.module.css";
import { CommandPalette } from "./CommandPalette";
import { ConnectionNotice } from "./ConnectionNotice";
import { MainView } from "./MainView";
import { resolveRoute, routeOfPlayingSet, routeOfSuggestion } from "./routes";
import { type PlayableRow, Sidebar } from "./Sidebar";
import { askToFocusSidebar } from "./sidebarFocus";
import { TopBar } from "./TopBar";
import { useDocumentIdentity } from "./useDocumentIdentity";
import { useFrontDoor } from "./useFrontDoor";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useHashRoute } from "./useHashRoute";
import { useIsAtTop } from "./useIsAtTop";
import { useModals } from "./useModals";
import { useResponsivePanel } from "./useResponsivePanel";
import { useRouteView } from "./useRouteView";
import { useScrollMemory } from "./useScrollMemory";
import { useSearchBar } from "./useSearchBar";
import { useSelectedPlaylist } from "./useSelectedPlaylist";

export function App() {
	return (
		<TagWriterProvider>
			<Shell />
		</TagWriterProvider>
	);
}

function Shell() {
	const t = useTranslate();
	useDocumentIdentity();

	const { data: playlists = [], isSuccess: hasPlaylists } = usePlaylists();
	const { data: playerState } = usePlayer();
	const playingPlaylistId = useResolvedPlaylistId(
		playerState?.player?.activeItem?.playlistGuid ?? null,
	);
	const isPlaying = useIsPlaying();
	const { toggle: toggleTheme } = useTheme();
	const isCompactViewport = useIsCompactViewport();
	const [route, navigate] = useHashRoute();
	const sidebar = useResponsivePanel("sidebar");
	const queue = useResponsivePanel("queue");
	const modals = useModals();
	const [settingsSeen, setSettingsSeen] = useStoredState(
		"jean.settingsSeen",
		false,
	);

	const scrollRef = useRef<HTMLDivElement | null>(null);

	const isNowPlaying = isPlayingRoute(route);
	const [openedFrom, setOpenedFrom] = useState("");
	// `history.back()` is wrong: a reload can land straight on `#/playing` with no entry behind it, and back would leave Jean.
	if (!isNowPlaying && openedFrom !== route) setOpenedFrom(route);
	const shellRoute = isNowPlaying ? openedFrom : route;
	const view = useMemo(() => resolveRoute(shellRoute), [shellRoute]);
	const isLibrary = view.kind !== "playlist";
	const isSearch = view.kind === "search";
	const searchQuery = isSearch ? view.query : null;

	const { discovery } = useFooJean();
	const canControlPlayback = permitsPlaybackControl(discovery);
	const connection = useConnection();
	usePlayerPoll(
		discovery.origin,
		discovery.state.kind === "ready" ? discovery.state.capabilities : null,
	);
	// Kept observed here so the list's first read happens when the component is found, whether or
	// not a caret, a cog or the Playing on panel is drawn: every host below reads the same cache.
	useOutputs();

	const library = useLibrary();
	const search = useLibrarySearch(library, playlists);
	const { play: playSet } = usePlaySet({ library, playlists });
	const playbackMode = usePlaybackOrder();
	const home = useHomePlayback({ library, playlists, navigate });
	const page = useRouteView(view, library);

	const playing = usePlayingFrom();
	const playingFrom = useMemo(() => routeOfPlayingSet(playing), [playing]);

	const browsable = useMemo(
		() => withoutScratchPlaylist(playlists),
		[playlists],
	);

	const palettePlaylists = useMemo(
		() =>
			browsable.map((playlist) => ({
				route: playlist.id,
				title: playlist.title,
				count: playlist.itemCount,
			})),
		[browsable],
	);

	const paletteViews = useMemo(
		() => [
			...(playingFrom?.temporaryRow
				? [{ route: playingFrom.route, title: playingFrom.name }]
				: []),
			{ route: ROUTE.all, title: t("library.allMusic") },
		],
		[playingFrom, t],
	);

	const playingRoute = playingFrom?.isPlaying
		? playingFrom.route
		: browsable.some((entry) => entry.id === playingPlaylistId)
			? (playingPlaylistId ?? null)
			: null;

	const { selectedId, playlist, remember } = useSelectedPlaylist({
		route,
		view,
		isLayered: isNowPlaying,
		browsable,
		playingPlaylistId,
		navigate,
	});

	const restoredSearch = useRef(false);
	const {
		hasQuery,
		query: committedQuery,
		commit: commitSearch,
		remembered: rememberedQuery,
		restore: restoreSearch,
	} = search;

	useEffect(() => {
		if (!searchQuery || searchQuery === committedQuery) return;
		commitSearch(searchQuery);
	}, [searchQuery, committedQuery, commitSearch]);

	useEffect(() => {
		if (
			restoredSearch.current ||
			!isSearch ||
			hasQuery ||
			searchQuery ||
			!rememberedQuery
		)
			return;
		restoredSearch.current = true;
		restoreSearch();
	}, [isSearch, hasQuery, searchQuery, rememberedQuery, restoreSearch]);

	const place =
		view.kind === "home"
			? t("route.home")
			: view.kind === "genres"
				? t("home.allGenres")
				: page.list
					? page.list.title
					: isSearch
						? t("search.title")
						: (page.artist?.name ?? playlist?.title ?? "");

	const cancelScroll = useRef<(() => void) | null>(null);
	const backToTop = useCallback(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		cancelScroll.current?.();
		cancelScroll.current = animateScrollTo(scroller, () => 0);
	}, []);

	const isAtTop = useIsAtTop(scrollRef);

	const jumpTo = useRef<string | null>(null);
	const arrivingAtPlayingTrack = jumpTo.current === route;

	useEffect(() => {
		if (jumpTo.current === route) askToJump();
		jumpTo.current = null;
	}, [route]);

	useScrollMemory(
		scrollRef,
		isSearch
			? search.viewKey
			: isLibrary
				? `library:${shellRoute}`
				: `playlist:${selectedId}`,
		{ restore: !arrivingAtPlayingTrack },
	);

	const showQueueAsked = useShowQueueAsked();
	const { setOpen: setQueueOpen } = queue;
	useEffect(() => {
		if (!showQueueAsked) return;
		queueShown();
		setQueueOpen(true);
	}, [showQueueAsked, setQueueOpen]);

	const { closeDrawer: closeSidebarDrawer } = sidebar;

	const openPlaylist = (id: string) => {
		navigate(`/${id}`);
		closeSidebarDrawer();
		modals.close("palette");
	};

	const openRoute = useCallback(
		(next: string) => {
			navigate(`/${next}`);
			closeSidebarDrawer();
		},
		[navigate, closeSidebarDrawer],
	);

	const { close: closeModal } = modals;
	const openFromPalette = useCallback(
		(next: string) => {
			openRoute(next);
			closeModal("palette");
		},
		[openRoute, closeModal],
	);

	const openPlayingFrom = useCallback(
		(next: string) => {
			jumpTo.current = next;
			openRoute(next);
		},
		[openRoute],
	);

	const playItem = usePlayItem();
	const playFromTop = (playlistId: string | undefined) => {
		if (playlistId) playItem.mutate({ playlistId, index: 0 });
	};
	const playRow = (row: PlayableRow) => {
		switch (row.kind) {
			case "all":
				return void home.playEverything(page.allMusic.indices);
			case "search":
				if (search.results.indices.length === 0) return;
				return void playSet({
					kind: SCRATCH_KIND.search,
					label: search.query,
					refs: search.results.indices,
					position: 0,
				});
			case "playingFrom":
				return playFromTop(playlists.find(isScratchPlaylist)?.id);
			case "playlist":
				return playFromTop(row.id);
		}
	};

	const openSearch = useCallback(
		(query?: string) => openRoute(query ? searchRoute(query) : ROUTE.search),
		[openRoute],
	);

	const searchBar = useSearchBar(isSearch, search.focus);

	const searchFor = useCallback(
		(query: string) => {
			search.commit(query);
			openSearch(query);
		},
		[search.commit, openSearch],
	);

	const selectSuggestion = (suggestion: Suggestion) => {
		if (suggestion.kind !== "track") {
			search.revert();
			openRoute(routeOfSuggestion(suggestion));
			return;
		}

		const { query, refs } = search.commit();
		const position = refs ? refs.indexOf(suggestion.ref) : -1;
		if (refs && position >= 0)
			void playSet({ kind: SCRATCH_KIND.search, label: query, refs, position });
	};

	const arriveFrom = useCallback(
		(from: string) => {
			setOpenedFrom(from);
			if (from === playingPlaylistId) remember(from);
		},
		[playingPlaylistId, remember],
	);

	useFrontDoor({
		route,
		playingRoute,
		playingPlaylistId,
		navigate,
		onArrive: arriveFrom,
	});

	const { open: openModal } = modals;
	useEffect(() => {
		if (settingsSeen || !hasPlaylists) return;
		openModal("settings");
		setSettingsSeen(true);
	}, [settingsSeen, hasPlaylists, setSettingsSeen, openModal]);

	// Replaced rather than pushed: the panel behind a track is not somewhere the reader asked to
	// travel back through, and the track settling picks one on its own.
	const selectPanel = useCallback(
		(tab: PanelTab) => navigate(`/${routeOfPanel(tab)}`, { replace: true }),
		[navigate],
	);

	const closeNowPlaying = useCallback(
		() => navigate(`/${openedFrom}`),
		[navigate, openedFrom],
	);

	const toggleNowPlaying = useCallback(
		() => (isNowPlaying ? closeNowPlaying() : navigate(`/${ROUTE.playing}`)),
		[isNowPlaying, closeNowPlaying, navigate],
	);

	useGlobalShortcuts({
		toggleSettings: () => modals.toggle("settings"),
		toggleShortcuts: () => modals.toggle("shortcuts"),
		globalSearch: () => {
			searchBar.reveal();
			search.focus();
		},
		backToTop,
		openPalette: () => modals.open("palette"),
		toggleSidebar: () => {
			sidebar.toggle();
			if (!sidebar.isOpen) return askToFocusSidebar();

			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused.closest("[data-nav-row]"))
				focused.blur();
		},
		focusSidebar: () => {
			sidebar.setOpen(true);
			askToFocusSidebar();
		},
		toggleQueue: queue.toggle,
		toggleNowPlaying,
		goToPlaying: () => {
			if (!playingRoute) return;
			if (
				shellRoute === playingRoute ||
				shellRoute.startsWith(`${playingRoute}/`)
			)
				askToJump({ animate: true });
			else openPlayingFrom(playingRoute);
		},
		toggleTheme,
	});

	return (
		<div className={styles.app}>
			<TopBar
				isSidebarShown={sidebar.isOpen}
				onToggleSidebar={sidebar.toggle}
				place={place}
				isAtTop={isAtTop}
				onBackToTop={backToTop}
				search={search}
				library={library}
				isSearchOpen={searchBar.isOpen}
				onRevealSearch={searchBar.reveal}
				onCloseSearch={searchBar.close}
				onSubmitSearch={() => openSearch(search.commit().query)}
				onSelectSuggestion={selectSuggestion}
				onDismissSearch={() => {
					search.clear();
					searchBar.close();
					if (isSearch) navigate(`/${selectedId}`);
				}}
				isSettingsOpen={modals.isOpen.settings}
				onOpenSettings={() => modals.open("settings")}
				onOpenShortcuts={() => modals.open("shortcuts")}
			/>

			<div className={styles.body} data-collapsed={sidebar.isCollapsed}>
				<Sidebar
					playlists={playlists}
					playingPlaylistId={playingPlaylistId ?? null}
					selectedId={isLibrary ? null : selectedId}
					onSelect={openPlaylist}
					search={search}
					isSearchOpen={isSearch}
					onOpenSearch={openSearch}
					route={shellRoute}
					onOpenRoute={openRoute}
					onPlayRow={canControlPlayback ? playRow : undefined}
					playingFrom={playingFrom}
					isOpen={sidebar.isDrawerOpen}
					isCollapsed={sidebar.isCollapsed}
					onDismiss={closeSidebarDrawer}
				/>

				<MainView
					route={view}
					page={page}
					library={library}
					search={search}
					playlists={playlists}
					playlist={playlist}
					scrollRef={scrollRef}
					isCompactViewport={isCompactViewport}
					home={home}
					playSet={playSet}
					playbackMode={playbackMode}
					onOpenPlaylist={openPlaylist}
					onOpenRoute={openRoute}
					onSearch={searchFor}
				/>

				<NowPlaying
					isOpen={isNowPlaying}
					tab={panelOfRoute(route)}
					onSelectTab={selectPanel}
					isCompactViewport={isCompactViewport}
					isQueueOpen={queue.isOpen}
					onToggleQueue={queue.toggle}
					onOpenPlayingFrom={
						playingRoute ? () => openPlayingFrom(playingRoute) : undefined
					}
					onDismiss={closeNowPlaying}
				/>

				<QueuePanel
					isOpen={queue.isOpen}
					isCompactViewport={isCompactViewport}
					onDismiss={() => queue.setOpen(false)}
				/>
			</div>

			<Toasts
				pinned={
					connection === "connected" ? null : (
						<ConnectionNotice state={connection} />
					)
				}
			/>

			{isCompactViewport && isNowPlaying ? null : (
				<StatusBar
					isQueueOpen={queue.isOpen}
					onToggleQueue={queue.toggle}
					onOpenNowPlaying={toggleNowPlaying}
					onRevealNowPlaying={() => navigate(`/${ROUTE.playing}`)}
				/>
			)}

			<DragGhost />

			{modals.isOpen.palette ? (
				<CommandPalette
					views={paletteViews}
					playlists={palettePlaylists}
					onSelect={openFromPalette}
					onDismiss={() => modals.close("palette")}
				/>
			) : null}

			{modals.isOpen.shortcuts ? (
				<ShortcutSheet onDismiss={() => modals.close("shortcuts")} />
			) : null}

			{modals.isOpen.settings ? (
				<SettingsDialog onDismiss={() => modals.close("settings")} />
			) : null}

			<span className="visually-hidden" aria-live="polite">
				{t(isPlaying ? "player.playing" : "player.paused")}
			</span>
		</div>
	);
}
