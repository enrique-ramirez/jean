import { Keyboard, Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "@/domain/library/useLibrary";
import { useLibrarySearch } from "@/domain/library/useLibrarySearch";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { useAudibleVolume } from "@/domain/player/useListener";
import {
	useIsPlaying,
	usePlayerStream,
	usePlaylists,
	usePlayPause,
	useSeekBy,
} from "@/domain/player/usePlayer";
import {
	ALL_MUSIC,
	SCRATCH_KIND,
	withoutJeanPlaylists,
} from "@/domain/track/jeanPlaylists";
import {
	EMPTY_VIEW,
	project,
	refsOfGenre,
	wholeLibrary,
} from "@/domain/track/project";
import { useRateShortcut } from "@/domain/track/useRateShortcut";
import { TagWriterProvider } from "@/domain/track/useTagWriter";
import { albumsOf } from "@/features/home/albums";
import { HomeView } from "@/features/home/HomeView";
import { buildShelves, refsOfShelf } from "@/features/home/shelves";
import { useHomePlayback } from "@/features/home/useHomePlayback";
import { LibraryListView } from "@/features/library/LibraryListView";
import { NowPlaying } from "@/features/now-playing/NowPlaying";
import { StatusBar } from "@/features/now-playing/StatusBar";
import { PlaylistView } from "@/features/playlist/PlaylistView";
import { QueuePanel } from "@/features/queue/QueuePanel";
import { LibrarySearchField } from "@/features/search/LibrarySearchField";
import { SearchResults } from "@/features/search/SearchResults";
import {
	SETTINGS_KEYBOARD,
	SettingsDialog,
} from "@/features/settings/SettingsDialog";
import { nextTrack, previousTrack, stop } from "@/shared/api/beefweb";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { SCOPE } from "@/shared/keyboard/keymap";
import { ShortcutSheet } from "@/shared/keyboard/ShortcutSheet";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { DragGhost } from "@/shared/ui/DragGhost";
import { Toasts } from "@/shared/ui/Toasts";
import styles from "./App.module.css";
import { CommandPalette } from "./CommandPalette";
import { ROUTE, resolveRoute, routeOfPlayingSet } from "./routes";
import { Sidebar } from "./Sidebar";
import { useDocumentIdentity } from "./useDocumentIdentity";
import { useHashRoute } from "./useHashRoute";
import { useScrollMemory } from "./useScrollMemory";
import { useTheme } from "./useTheme";

const SEEK_STEP = 5;

// Wraps the shell so the control in a row and the screen that configures it read one resolution.
export function App() {
	return (
		<TagWriterProvider>
			<Shell />
		</TagWriterProvider>
	);
}

function Shell() {
	usePlayerStream();
	useDocumentIdentity();

	const { data: playlists = [], isSuccess: hasPlaylists } = usePlaylists();
	const isPlaying = useIsPlaying();
	const playPause = usePlayPause();
	const seekBy = useSeekBy();
	// The audible fader, not the player's: while a stream is attached the player's volume sits before the capture and moves nothing anyone can hear.
	const volume = useAudibleVolume();
	const { theme, toggle: toggleTheme } = useTheme();
	const isCompactViewport = useIsCompactViewport();
	const [route, navigate] = useHashRoute();
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useStoredState(
		"jean.sidebarCollapsed",
		false,
	);
	const [isPaletteOpen, setIsPaletteOpen] = useState(false);
	const [isSheetOpen, setIsSheetOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsSeen, setSettingsSeen] = useStoredState(
		"jean.settingsSeen",
		false,
	);
	// Restored on a desktop, where it is furniture; not on a phone, where it covers the app.
	const [isQueueDocked, setIsQueueDocked] = useStoredState(
		"jean.queueOpen",
		false,
	);
	const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);

	const scrollRef = useRef<HTMLDivElement | null>(null);

	// Now playing is a layer, so the shell keeps resolving the route underneath for it to slide over.
	const isNowPlaying = route === ROUTE.playing;
	const [openedFrom, setOpenedFrom] = useState("");
	const shellRoute = isNowPlaying ? openedFrom : route;

	const { shelf, genre, isSearch, isAll, isHome, isLibrary } =
		resolveRoute(shellRoute);

	// Loaded for the views that show it. Search asks separately, on focus, because reaching for the field is the ask and the route cannot know.
	const library = useLibrary(playlists, {
		wanted: isHome || isAll || Boolean(shelf) || Boolean(genre),
	});
	const search = useLibrarySearch(library, playlists);
	const home = useHomePlayback({ library, playlists, navigate });

	const rateShortcut = useRateShortcut();
	const playing = usePlayingFrom();
	const playingFrom = useMemo(() => routeOfPlayingSet(playing), [playing]);

	// Keyed on the snapshot rather than on `library`, which is rebuilt every render: keyed on the latter these never hit and a full pass over every row runs on each of App's renders.
	const { snapshot } = library;
	const allMusic = useMemo(() => wholeLibrary(snapshot), [snapshot]);
	const shelfView = useMemo(() => {
		if (!shelf || snapshot.rows.length === 0) return null;
		const built = buildShelves(albumsOf(snapshot.rows)).find(
			(entry) => entry.id === shelf.id,
		);
		return built ? project(snapshot, refsOfShelf(built)) : null;
	}, [shelf, snapshot]);

	// A genre is a filter over rows Jean already holds, so opening one costs a pass and no request.
	const genreView = useMemo(
		() => (genre ? project(snapshot, refsOfGenre(snapshot.rows, genre)) : null),
		[genre, snapshot],
	);

	// One description of the library view on screen, so `kind` and `label` cannot disagree across five props.
	const listView = shelf
		? {
				view: shelfView,
				kind: SCRATCH_KIND.shelf,
				label: shelf.title,
				eyebrow: "Shelf",
				title: shelf.title,
			}
		: genre
			? {
					view: genreView,
					kind: SCRATCH_KIND.genre,
					label: genre,
					eyebrow: "Genre",
					title: genre,
				}
			: {
					view: allMusic,
					kind: SCRATCH_KIND.all,
					label: "",
					eyebrow: "Your library",
					title: ALL_MUSIC,
				};

	// Jean's own scratch playlists are not somewhere to browse to: playing search results makes one current, and landing there would show them stripped of the search that made them.
	const browsable = useMemo(() => withoutJeanPlaylists(playlists), [playlists]);
	const routedId = browsable.some((entry) => entry.id === route) ? route : null;

	// A reload lands on #/search with the query gone, since it was only ever in memory. The playlist the player holds is named after it.
	// Once per mount: clearing the search navigates away, but not before a render where both conditions still hold.
	const restoredSearch = useRef(false);
	const {
		hasQuery,
		remembered: rememberedQuery,
		restore: restoreSearch,
	} = search;
	useEffect(() => {
		if (restoredSearch.current || !isSearch || hasQuery || !rememberedQuery)
			return;
		restoredSearch.current = true;
		restoreSearch();
	}, [isSearch, hasQuery, rememberedQuery, restoreSearch]);

	// Where leaving the search returns to. Held rather than derived: while results are on screen the route no longer names a playlist.
	const lastPlaylistId = useRef<string | null>(null);
	useEffect(() => {
		if (routedId) lastPlaylistId.current = routedId;
	}, [routedId]);

	// Checked against the live list rather than trusted: a remembered playlist can have been deleted, here or on the desktop.
	const selectedId =
		routedId ??
		(browsable.some((entry) => entry.id === lastPlaylistId.current)
			? lastPlaylistId.current
			: null) ??
		browsable.find((entry) => entry.isCurrent)?.id ??
		browsable[0]?.id;

	const playlist = useMemo(
		() => browsable.find((entry) => entry.id === selectedId) ?? null,
		[browsable, selectedId],
	);

	// Each result set is its own view, so refining a query starts at the top while stepping back into a playlist returns to the row it left.
	useScrollMemory(
		scrollRef,
		isSearch
			? search.viewKey
			: isLibrary
				? `library:${route}`
				: `playlist:${selectedId}`,
	);

	const isQueueOpen = isCompactViewport ? isQueueDrawerOpen : isQueueDocked;

	const toggleQueue = useCallback(() => {
		if (isCompactViewport) setIsQueueDrawerOpen((current) => !current);
		else setIsQueueDocked((current) => !current);
	}, [isCompactViewport, setIsQueueDocked]);

	const toggleSidebar = () => {
		if (isCompactViewport) setIsSidebarOpen((current) => !current);
		else setIsSidebarCollapsed((current) => !current);
	};

	const openPlaylist = (id: string) => {
		navigate(`/${id}`);
		setIsSidebarOpen(false);
		setIsPaletteOpen(false);
	};

	const openRoute = useCallback(
		(next: string) => {
			navigate(`/${next}`);
			setIsSidebarOpen(false);
		},
		[navigate],
	);

	const openSearch = useCallback(() => openRoute(ROUTE.search), [openRoute]);

	// For callers that are already anchors to `#/search`: what this adds is the query itself, and closing the drawer on a phone.
	const searchFor = useCallback(
		(query: string) => {
			search.setQuery(query);
			openSearch();
		},
		[search.setQuery, openSearch],
	);

	// Where dismissing the screen goes. `history.back()` is wrong: a reload lands directly on `#/playing` with no entry behind it, and back would leave Jean altogether.
	useEffect(() => {
		if (!isNowPlaying) setOpenedFrom(route);
	}, [isNowPlaying, route]);

	// Waits for the library: an install with no `#Jean Library` has a setup step on screen, and that is the one thing to do first.
	useEffect(() => {
		if (settingsSeen || !hasPlaylists || library.needsSetup) return;
		setIsSettingsOpen(true);
		setSettingsSeen(true);
	}, [settingsSeen, hasPlaylists, library.needsSetup, setSettingsSeen]);

	const closeNowPlaying = useCallback(
		() => navigate(`/${openedFrom}`),
		[navigate, openedFrom],
	);

	const toggleNowPlaying = useCallback(
		() => (isNowPlaying ? closeNowPlaying() : navigate(`/${ROUTE.playing}`)),
		[isNowPlaying, closeNowPlaying, navigate],
	);

	// Registered apart from the rest, which go quiet while settings holds the keyboard. This one must survive the dialog it opens.
	useKeymap(
		SCOPE.global,
		{ openSettings: () => setIsSettingsOpen((current) => !current) },
		{ owner: SETTINGS_KEYBOARD },
	);

	useKeymap(SCOPE.global, {
		playPause: () => playPause.mutate(),
		nextTrack: () => nextTrack(),
		previousTrack: () => previousTrack(),
		stop: () => stop(),
		seekBack: () => seekBy.mutate(-SEEK_STEP),
		seekForward: () => seekBy.mutate(SEEK_STEP),
		volumeUp: () => volume.up(),
		volumeDown: () => volume.down(),
		toggleMute: () => volume.toggleMute(),
		globalSearch: () => {
			search.focus();
			if (search.hasQuery) openSearch();
		},
		openPalette: () => setIsPaletteOpen(true),
		toggleSidebar,
		toggleQueue,
		toggleNowPlaying,
		showShortcuts: () => setIsSheetOpen((current) => !current),
		toggleTheme,
		rate0: () => rateShortcut(0),
		rate1: () => rateShortcut(1),
		rate2: () => rateShortcut(2),
		rate3: () => rateShortcut(3),
		rate4: () => rateShortcut(4),
		rate5: () => rateShortcut(5),
	});

	return (
		<div className={styles.app}>
			<header className={styles.topbar}>
				<Button
					variant="ghost"
					icon={PanelLeft}
					aria-label={
						isSidebarCollapsed || !isSidebarOpen
							? "Show playlists"
							: "Hide playlists"
					}
					aria-expanded={
						isCompactViewport ? isSidebarOpen : !isSidebarCollapsed
					}
					onClick={toggleSidebar}
				/>

				{isCompactViewport ? null : (
					<p className={styles.brand}>
						je<span>a</span>n
					</p>
				)}

				<LibrarySearchField
					search={search}
					library={library}
					onChange={(value) => {
						search.setQuery(value);
						// Typing is the navigation; waiting for Enter would filter a page nobody is looking at.
						if (value.trim()) openSearch();
					}}
					onDismiss={() => {
						search.clear();
						if (isSearch) navigate(`/${selectedId}`);
					}}
				/>

				<div className={styles.actions}>
					<Button
						variant="ghost"
						className={styles.shortcuts}
						icon={Keyboard}
						aria-label="Keyboard shortcuts"
						onClick={() => setIsSheetOpen(true)}
					/>
					<Button
						variant="ghost"
						icon={Settings}
						aria-label="Settings"
						aria-expanded={isSettingsOpen}
						onClick={() => setIsSettingsOpen(true)}
					/>
					<Button
						variant="ghost"
						icon={theme === "dark" ? Sun : Moon}
						aria-label={
							theme === "dark"
								? "Switch to light theme"
								: "Switch to dark theme"
						}
						onClick={toggleTheme}
					/>
				</div>
			</header>

			<div
				className={styles.body}
				data-collapsed={!isCompactViewport && isSidebarCollapsed}
			>
				<Sidebar
					playlists={playlists}
					// Only a playlist route selects a playlist: `selectedId` falls back to a remembered one, which would otherwise light a playlist row while Home is showing.
					selectedId={isLibrary ? null : selectedId}
					onSelect={openPlaylist}
					search={search}
					isSearchOpen={isSearch}
					onOpenSearch={openSearch}
					route={route}
					onOpenRoute={openRoute}
					playingFrom={playingFrom}
					isOpen={isSidebarOpen}
					isCollapsed={!isCompactViewport && isSidebarCollapsed}
					onDismiss={() => setIsSidebarOpen(false)}
				/>

				<main className={styles.main} ref={scrollRef}>
					{isHome ? (
						<HomeView
							library={library}
							playlists={playlists}
							onPlayAlbum={home.playShelf}
							// The front door plays exactly the set the All music route shows, so it must be exactly the same refs.
							onPlayTrack={(ref) => home.playTrack(allMusic.indices, ref)}
							onPlayEverything={() => home.playEverything(allMusic.indices)}
							onShuffleEverything={() =>
								home.shuffleEverything(allMusic.indices)
							}
							onSearch={searchFor}
							canPlay={home.canPlay}
							canShuffle={home.canShuffle}
						/>
					) : isAll || shelf || genre ? (
						<LibraryListView
							library={library}
							view={listView.view ?? EMPTY_VIEW}
							kind={listView.kind}
							label={listView.label}
							eyebrow={listView.eyebrow}
							title={listView.title}
							playlists={playlists}
							scrollRef={scrollRef}
							isCompactViewport={isCompactViewport}
							emptyNotice={
								library.isLoading
									? "Reading your library..."
									: genre
										? `Nothing tagged ${genre} in your library.`
										: "Nothing in your library yet."
							}
						/>
					) : isSearch ? (
						<SearchResults
							search={search}
							library={library}
							playlists={playlists}
							scrollRef={scrollRef}
							isCompactViewport={isCompactViewport}
							onOpenPlaylist={openPlaylist}
						/>
					) : (
						<PlaylistView
							playlist={playlist}
							scrollRef={scrollRef}
							isCompactViewport={isCompactViewport}
						/>
					)}
				</main>

				{/* A sibling of `main` inside `.body`, as the queue panel is, so it can slide over the view it was opened from. */}
				<NowPlaying
					isOpen={isNowPlaying}
					isCompactViewport={isCompactViewport}
					isQueueOpen={isQueueOpen}
					onToggleQueue={toggleQueue}
					onDismiss={closeNowPlaying}
				/>

				<QueuePanel
					isOpen={isQueueOpen}
					isCompactViewport={isCompactViewport}
					onDismiss={() =>
						isCompactViewport
							? setIsQueueDrawerOpen(false)
							: setIsQueueDocked(false)
					}
				/>
			</div>

			{/* A sibling of the body, sharing its grid cell, which puts it above the status bar without anyone knowing how tall that is. */}
			<Toasts />

			{/* On a phone the now-playing screen is the whole viewport and carries its own transport, so the strip below it would be a second Play button. */}
			{isCompactViewport && isNowPlaying ? null : (
				<StatusBar
					isQueueOpen={isQueueOpen}
					onToggleQueue={toggleQueue}
					onOpenNowPlaying={toggleNowPlaying}
					onRevealNowPlaying={() => navigate(`/${ROUTE.playing}`)}
				/>
			)}

			<DragGhost />

			{isPaletteOpen ? (
				<CommandPalette
					playlists={browsable}
					onSelect={openPlaylist}
					onDismiss={() => setIsPaletteOpen(false)}
				/>
			) : null}

			{isSheetOpen ? (
				<ShortcutSheet onDismiss={() => setIsSheetOpen(false)} />
			) : null}

			{isSettingsOpen ? (
				<SettingsDialog onDismiss={() => setIsSettingsOpen(false)} />
			) : null}

			<span className="visually-hidden" aria-live="polite">
				{isPlaying ? "Playing" : "Paused"}
			</span>
		</div>
	);
}
