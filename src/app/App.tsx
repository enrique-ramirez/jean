import { Keyboard, Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "@/domain/library/useLibrary";
import { useLibrarySearch } from "@/domain/library/useLibrarySearch";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { queueShown, useShowQueueAsked } from "@/domain/player/showQueue";
import { useAudibleVolume } from "@/domain/player/useListener";
import {
	useIsPlaying,
	usePlayer,
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
import { askToJump } from "@/domain/track/jumpToPlaying";
import {
	EMPTY_VIEW,
	project,
	refsOfGenre,
	wholeLibrary,
} from "@/domain/track/project";
import { useRateShortcut } from "@/domain/track/useRateShortcut";
import { TagWriterProvider } from "@/domain/track/useTagWriter";
import { GenreCrumb } from "@/features/genres/GenreCrumb";
import { GenresView } from "@/features/genres/GenresView";
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
import {
	SHORTCUTS_KEYBOARD,
	ShortcutSheet,
} from "@/shared/keyboard/ShortcutSheet";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { DragGhost } from "@/shared/ui/DragGhost";
import { Toasts } from "@/shared/ui/Toasts";
import styles from "./App.module.css";
import { CommandPalette } from "./CommandPalette";
import { ROUTE, resolveRoute, routeOfPlayingSet } from "./routes";
import { Sidebar } from "./Sidebar";
import { askToFocusSidebar } from "./sidebarFocus";
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
	// The player's own state rather than the audible copy: what this reads is whether there is a track at all, which the stream's lag does not change.
	const { data: playerState, isSuccess: hasPlayer } = usePlayer();
	const activeItem = playerState?.player?.activeItem;
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

	const { shelf, genre, isGenres, isSearch, isAll, isHome, isLibrary } =
		resolveRoute(shellRoute);

	// Loaded for the views that show it. Search asks separately, on focus, because reaching for the field is the ask and the route cannot know.
	const library = useLibrary(playlists, {
		wanted: isHome || isAll || isGenres || Boolean(shelf) || Boolean(genre),
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
					// The eyebrow is the way back. A genre is the one view in Jean reached from an index of
					// its own, and without this the only route out of `Alternative Folk` is the browser's
					// Back button -- which is not there at all on a phone in standalone mode.
					eyebrow: <GenreCrumb />,
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

	const palettePlaylists = useMemo(
		() =>
			browsable.map((playlist) => ({
				route: playlist.id,
				title: playlist.title,
				count: playlist.itemCount,
			})),
		[browsable],
	);

	// The two library rows the sidebar keeps above the playlists, in the palette for the same reason they are there: a playlist can be reached by name and a shelf cannot.
	// `temporaryRow` is the whole test -- a genre or a shelf has no permanent row anywhere, where a playing playlist is already in the list below and All music is already in this one.
	const paletteViews = useMemo(
		() => [
			...(playingFrom?.temporaryRow
				? [{ route: playingFrom.route, title: playingFrom.name }]
				: []),
			{ route: ROUTE.all, title: ALL_MUSIC },
		],
		[playingFrom],
	);

	// Where the sound is coming from, as a route to open: the set Jean materialised for it, or the playlist the player holds the track in. Null for the queue's holding playlist and anything else with nowhere to browse to.
	const playingRoute = playingFrom?.isPlaying
		? playingFrom.route
		: activeItem &&
				browsable.some((entry) => entry.id === activeItem.playlistId)
			? activeItem.playlistId
			: null;
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

	// The set the now-playing screen was sent back to, until its route lands. The ask is raised on arrival rather than at
	// the click because the playing track is locatable from more than one view -- All music finds a row the search results
	// are playing -- so the view being left would answer an ask meant for the one being opened.
	const jumpTo = useRef<string | null>(null);
	const arrivingAtPlayingTrack = jumpTo.current === route;

	useEffect(() => {
		// Cleared on every landing, matched or not — otherwise a jump abandoned by a second, faster
		// navigation would sit armed and fire on whatever ordinary visit next reached that route.
		if (jumpTo.current === route) askToJump();
		jumpTo.current = null;
	}, [route]);

	// Each result set is its own view, so refining a query starts at the top while stepping back into a playlist returns to the row it left.
	// The route underneath, not the route: the now-playing screen is a layer over a view that has not changed, and keyed on `#/playing` opening it would scroll the list behind it to the top and closing it would restore the offset a jump had just replaced.
	useScrollMemory(
		scrollRef,
		isSearch
			? search.viewKey
			: isLibrary
				? `library:${shellRoute}`
				: `playlist:${selectedId}`,
		{ restore: !arrivingAtPlayingTrack },
	);

	const isQueueOpen = isCompactViewport ? isQueueDrawerOpen : isQueueDocked;

	const setQueueOpen = useCallback(
		(open: boolean) => {
			if (isCompactViewport) setIsQueueDrawerOpen(open);
			else setIsQueueDocked(open);
		},
		[isCompactViewport, setIsQueueDocked],
	);

	const toggleQueue = useCallback(
		() => setQueueOpen(!isQueueOpen),
		[setQueueOpen, isQueueOpen],
	);

	// Queueing a track asks for the panel, because the panel is what says the track was queued.
	const showQueueAsked = useShowQueueAsked();
	useEffect(() => {
		if (!showQueueAsked) return;
		queueShown();
		setQueueOpen(true);
	}, [showQueueAsked, setQueueOpen]);

	// One question, two pieces of state: a phone slides a drawer over the app and a desktop collapses a column, and nothing outside here should have to know which.
	const isSidebarShown = isCompactViewport
		? isSidebarOpen
		: !isSidebarCollapsed;

	const showSidebar = useCallback(
		(shown: boolean) => {
			if (isCompactViewport) setIsSidebarOpen(shown);
			else setIsSidebarCollapsed(!shown);
		},
		[isCompactViewport, setIsSidebarCollapsed],
	);

	const toggleSidebar = () => showSidebar(!isSidebarShown);

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

	// Everything the palette lists is a hash route, playlist or view, so it needs no branch on which was picked.
	const openFromPalette = useCallback(
		(next: string) => {
			openRoute(next);
			setIsPaletteOpen(false);
		},
		[openRoute],
	);

	// The way back to the set, from the now-playing screen. The route alone lands at the top of a long list, or wherever
	// that view was last left, so the row is asked for as well and whichever list resolves the route answers it.
	const openPlayingFrom = useCallback(
		(next: string) => {
			jumpTo.current = next;
			openRoute(next);
		},
		[openRoute],
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

	// Landing on the front door with a track already loaded opens what it is playing from, and the screen over it: Jean opens where the sound is rather than at a page nobody chose.
	// Once per load and only from `#/` — `#/home` is somewhere the user asked to be. It waits for the player and the playlists, neither of which has answered on the first render.
	const resumed = useRef(false);
	useEffect(() => {
		if (resumed.current || !hasPlayer || !hasPlaylists) return;
		// Spent on the first settled answer whatever it says, so this is the moment the app loaded and never a later return to the front door.
		resumed.current = true;
		// `index` is -1 whenever the player is stopped, which is the whole of "nothing is playing".
		if (route !== "" || !activeItem || activeItem.index < 0) return;

		if (playingRoute) {
			// Set before the hash, so the screen has the set to be dismissed to rather than the front door. `useHashRoute` reads the new hash in the same render, so the effect above sees `#/playing` and leaves this alone.
			setOpenedFrom(playingRoute);
			// Which playlist the view underneath resolves to, since the route itself now names the screen. `isCurrent` is the playlist selected in foobar rather than the one playing, so it is the wrong thing to fall back to here.
			if (playingRoute === activeItem.playlistId)
				lastPlaylistId.current = playingRoute;
		}
		navigate(`/${ROUTE.playing}`);
	}, [route, hasPlayer, hasPlaylists, activeItem, playingRoute, navigate]);

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

	// Registered apart from the rest, which go quiet while an overlay holds the keyboard. Each of these must survive the one it opens.
	useKeymap(
		SCOPE.global,
		{ openSettings: () => setIsSettingsOpen((current) => !current) },
		{ owner: SETTINGS_KEYBOARD },
	);

	useKeymap(
		SCOPE.global,
		{ showShortcuts: () => setIsSheetOpen((current) => !current) },
		{ owner: SHORTCUTS_KEYBOARD },
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
		// Shown by a key rather than a click, so it is being shown in order to be used: the hand is already on the keyboard and the next press is almost always an arrow. A click leaves the caret where it was, because the pointer is the thing that is going to choose.
		toggleSidebar: () => {
			toggleSidebar();
			if (!isSidebarShown) return askToFocusSidebar();

			// Hidden with the caret on a row: every key after it would land on something nobody can see.
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused.closest("[data-nav-row]"))
				focused.blur();
		},
		focusSidebar: () => {
			showSidebar(true);
			askToFocusSidebar();
		},
		toggleQueue,
		toggleNowPlaying,
		goToPlayingFrom: () => {
			if (playingRoute) openPlayingFrom(playingRoute);
		},
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
					) : isGenres ? (
						<GenresView library={library} onOpenRoute={openRoute} />
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
							onOpenPlaylist={openPlaylist}
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
					// Only for a set with somewhere to go: opening the route is what dismisses the screen, so there is nothing else for the header to do.
					onOpenPlayingFrom={
						playingRoute ? () => openPlayingFrom(playingRoute) : undefined
					}
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
					views={paletteViews}
					playlists={palettePlaylists}
					onSelect={openFromPalette}
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
