import { Keyboard, Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import { useLibrary } from "@/domain/library/useLibrary";
import { useLibrarySearch } from "@/domain/library/useLibrarySearch";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { usePlaySet } from "@/domain/library/usePlaySet";
import { queueShown, useShowQueueAsked } from "@/domain/player/showQueue";
import { useAudibleVolume } from "@/domain/player/useListener";
import {
	useIsPlaying,
	usePlaybackOrder,
	usePlayer,
	usePlayerStream,
	usePlaylists,
	usePlayPause,
	useSeekBy,
} from "@/domain/player/usePlayer";
import { AlbumCrumb } from "@/domain/track/AlbumCrumb";
import { albumsOf, refsOfAlbum } from "@/domain/track/albums";
import { type ArtistTab, artistRoute } from "@/domain/track/artistRoute";
import { type ArtistTracks, refsOfArtist } from "@/domain/track/artists";
import {
	ALL_MUSIC,
	SCRATCH_KIND,
	withoutJeanPlaylists,
} from "@/domain/track/jeanPlaylists";
import { askToJump } from "@/domain/track/jumpToPlaying";
import {
	EMPTY_VIEW,
	project,
	type Refs,
	refsOfGenre,
	wholeLibrary,
} from "@/domain/track/project";
import { askToReveal } from "@/domain/track/revealTrack";
import { useRateShortcut } from "@/domain/track/useRateShortcut";
import { TagWriterProvider } from "@/domain/track/useTagWriter";
import { ArtistView } from "@/features/artist/ArtistView";
import { GenresView } from "@/features/genres/GenresView";
import { HomeView } from "@/features/home/HomeView";
import { buildShelves, refsOfShelf } from "@/features/home/shelves";
import { useHomePlayback } from "@/features/home/useHomePlayback";
import { LibraryListView } from "@/features/library/LibraryListView";
import { NowPlaying } from "@/features/now-playing/NowPlaying";
import { StatusBar } from "@/features/now-playing/StatusBar";
import { useNowPlayingRating } from "@/features/now-playing/useNowPlayingRating";
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
import { useSwipe } from "@/shared/hooks/useSwipe";
import { SCOPE } from "@/shared/keyboard/keymap";
import { mnemonicOf } from "@/shared/keyboard/mnemonic";
import {
	SHORTCUTS_KEYBOARD,
	ShortcutSheet,
} from "@/shared/keyboard/ShortcutSheet";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { Crumb } from "@/shared/ui/Crumb";
import { DragGhost } from "@/shared/ui/DragGhost";
import { type TabOption, Tabs } from "@/shared/ui/Tabs";
import { Toasts } from "@/shared/ui/Toasts";
import styles from "./App.module.css";
import { CommandPalette } from "./CommandPalette";
import {
	ROUTE,
	resolveRoute,
	routeOfPlayingSet,
	routeOfSuggestion,
} from "./routes";
import { Sidebar } from "./Sidebar";
import { askToFocusSidebar } from "./sidebarFocus";
import { useDocumentIdentity } from "./useDocumentIdentity";
import { useHashRoute } from "./useHashRoute";
import { useScrollMemory } from "./useScrollMemory";
import { useTheme } from "./useTheme";

const SEEK_STEP = 5;

const ARTIST_TABS: TabOption<ArtistTab>[] = [
	{
		value: "overview",
		label: "Overview",
		mnemonic: mnemonicOf("Overview", "switchArtistTab"),
	},
	{ value: "tracks", label: "Tracks" },
];

const EMPTY_ARTIST_TRACKS: ArtistTracks = {
	own: new Int32Array(0),
	guest: new Int32Array(0),
	all: new Int32Array(0),
};

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
	const { data: playerState, isSuccess: hasPlayer } = usePlayer();
	const activeItem = playerState?.player?.activeItem;
	const isPlaying = useIsPlaying();
	const playPause = usePlayPause();
	const seekBy = useSeekBy();
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
	const [isQueueDocked, setIsQueueDocked] = useStoredState(
		"jean.queueOpen",
		false,
	);
	const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
	const [tabDirection, setTabDirection] = useState(0);

	const scrollRef = useRef<HTMLDivElement | null>(null);

	const isNowPlaying = route === ROUTE.playing;
	const [openedFrom, setOpenedFrom] = useState("");
	const shellRoute = isNowPlaying ? openedFrom : route;

	const {
		shelf,
		genre,
		album,
		albumArtist,
		artist,
		artistTab,
		isGenres,
		isSearch,
		isAll,
		isHome,
		isLibrary,
	} = resolveRoute(shellRoute);

	const library = useLibrary(playlists, {
		wanted:
			isHome ||
			isAll ||
			isGenres ||
			Boolean(shelf) ||
			Boolean(genre) ||
			Boolean(album) ||
			Boolean(artist),
	});
	const search = useLibrarySearch(library, playlists);
	const { play: playSet } = usePlaySet({ library, playlists });
	const playbackOrder = usePlaybackOrder();
	const home = useHomePlayback({ library, playlists, navigate });

	const { write: ratePlaying } = useNowPlayingRating();
	const rateShortcut = useRateShortcut(ratePlaying);
	const playing = usePlayingFrom();
	const playingFrom = useMemo(() => routeOfPlayingSet(playing), [playing]);

	const { snapshot } = library;
	const allMusic = useMemo(() => wholeLibrary(snapshot), [snapshot]);
	const shelfView = useMemo(() => {
		if (!shelf || snapshot.rows.length === 0) return null;
		const built = buildShelves(albumsOf(snapshot.rows)).find(
			(entry) => entry.id === shelf.id,
		);
		return built ? project(snapshot, refsOfShelf(built)) : null;
	}, [shelf, snapshot]);

	const artistTracks = useMemo(
		() => (artist ? refsOfArtist(snapshot.rows, artist) : EMPTY_ARTIST_TRACKS),
		[artist, snapshot.rows],
	);

	// Every way of starting an artist fills the same scratch under the same label, so the sidebar row
	// and the status bar cannot disagree about where the sound came from.
	const playArtist = useCallback(
		(refs: Refs, position: number) =>
			void playSet({
				kind: SCRATCH_KIND.artist,
				label: artist ?? "",
				refs,
				position,
			}),
		[playSet, artist],
	);

	const artistView = useMemo(
		() => (artist ? project(snapshot, artistTracks.all) : null),
		[artist, snapshot, artistTracks.all],
	);

	const genreView = useMemo(
		() => (genre ? project(snapshot, refsOfGenre(snapshot.rows, genre)) : null),
		[genre, snapshot],
	);

	// The route carries the two halves normalised, so the record's own spelling comes back with its
	// rows and is what the header draws.
	const albumTracks = useMemo(
		() => (album ? refsOfAlbum(snapshot.rows, albumArtist, album) : null),
		[album, albumArtist, snapshot.rows],
	);

	const albumView = useMemo(
		() => (albumTracks ? project(snapshot, albumTracks.refs) : null),
		[albumTracks, snapshot],
	);

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
					eyebrow: <Crumb href={GENRES_HREF}>All genres</Crumb>,
					title: genre,
				}
			: albumTracks
				? {
						view: albumView,
						kind: SCRATCH_KIND.album,
						label: albumTracks.album,
						eyebrow: <AlbumCrumb artist={albumTracks.artist} />,
						title: albumTracks.album,
					}
				: {
						view: allMusic,
						kind: SCRATCH_KIND.all,
						label: "",
						eyebrow: "Your library",
						title: ALL_MUSIC,
					};

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

	const paletteViews = useMemo(
		() => [
			...(playingFrom?.temporaryRow
				? [{ route: playingFrom.route, title: playingFrom.name }]
				: []),
			{ route: ROUTE.all, title: ALL_MUSIC },
		],
		[playingFrom],
	);

	const playingRoute = playingFrom?.isPlaying
		? playingFrom.route
		: activeItem &&
				browsable.some((entry) => entry.id === activeItem.playlistId)
			? activeItem.playlistId
			: null;
	const routedId = browsable.some((entry) => entry.id === route) ? route : null;

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

	const lastPlaylistId = useRef<string | null>(null);
	useEffect(() => {
		if (routedId) lastPlaylistId.current = routedId;
	}, [routedId]);

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

	const showQueueAsked = useShowQueueAsked();
	useEffect(() => {
		if (!showQueueAsked) return;
		queueShown();
		setQueueOpen(true);
	}, [showQueueAsked, setQueueOpen]);

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

	const openFromPalette = useCallback(
		(next: string) => {
			openRoute(next);
			setIsPaletteOpen(false);
		},
		[openRoute],
	);

	const openPlayingFrom = useCallback(
		(next: string) => {
			jumpTo.current = next;
			openRoute(next);
		},
		[openRoute],
	);

	const openSearch = useCallback(() => openRoute(ROUTE.search), [openRoute]);

	const showArtistTab = useCallback(
		(tab: ArtistTab) => {
			if (!artist) return;
			// Set here rather than derived from the route: a history navigation is not a swipe and has no
			// direction to play, so it falls through with none.
			setTabDirection(tab === "tracks" ? 1 : -1);
			openRoute(artistRoute(artist, tab));
		},
		[artist, openRoute],
	);

	const artistTabs = useMemo(
		() =>
			artist ? (
				<Tabs
					value={artistTab}
					label="Artist views"
					options={ARTIST_TABS}
					onChange={showArtistTab}
				/>
			) : null,
		[artist, artistTab, showArtistTab],
	);

	// Left is the next tab, as it is on the now-playing panels. Touch only, and on `main` rather than
	// a wrapper of its own: the track list takes its scroll element from there.
	const artistSwipe = useSwipe({
		onLeft: () => showArtistTab("tracks"),
		onRight: () => showArtistTab("overview"),
	});

	useKeymap(
		SCOPE.artist,
		{
			switchArtistTab: () =>
				showArtistTab(artistTab === "tracks" ? "overview" : "tracks"),
		},
		{ enabled: Boolean(artist) },
	);

	const searchFor = useCallback(
		(query: string) => {
			search.commit(query);
			openSearch();
		},
		[search.commit, openSearch],
	);

	// `history.back()` is wrong: a reload can land straight on `#/playing` with no entry behind it, and back would leave Jean.
	useEffect(() => {
		if (!isNowPlaying) setOpenedFrom(route);
	}, [isNowPlaying, route]);

	const resumed = useRef(false);
	useEffect(() => {
		if (resumed.current || !hasPlayer || !hasPlaylists) return;
		resumed.current = true;
		// `index` is -1 whenever the player is stopped.
		if (route !== "" || !activeItem || activeItem.index < 0) return;

		if (playingRoute) {
			setOpenedFrom(playingRoute);
			if (playingRoute === activeItem.playlistId)
				lastPlaylistId.current = playingRoute;
		}
		navigate(`/${ROUTE.playing}`);
	}, [route, hasPlayer, hasPlaylists, activeItem, playingRoute, navigate]);

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
		globalSearch: () => search.focus(),
		openPalette: () => setIsPaletteOpen(true),
		toggleSidebar: () => {
			toggleSidebar();
			if (!isSidebarShown) return askToFocusSidebar();

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
					onChange={search.type}
					onSubmit={() => {
						search.commit();
						openSearch();
					}}
					onSelect={(suggestion) => {
						if (suggestion.kind !== "track") {
							// A place the query was only ever a way of reaching, so the query is not promoted
							// and the field goes back to whatever search is actually on screen.
							search.revert();
							openRoute(routeOfSuggestion(suggestion));
							return;
						}

						// A track does not move you: the results are materialised so it has somewhere to play
						// from, and the status bar and the sidebar say where the sound is coming from.
						const { query, refs } = search.commit();
						const position = refs ? refs.indexOf(suggestion.ref) : -1;
						if (refs && position >= 0)
							void playSet({
								kind: SCRATCH_KIND.search,
								label: query,
								refs,
								position,
							});
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

				<main
					className={styles.main}
					ref={scrollRef}
					{...(artist ? artistSwipe : null)}
				>
					{isHome ? (
						<HomeView
							library={library}
							playlists={playlists}
							onPlayAlbum={home.playShelf}
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
					) : isAll || shelf || genre || album ? (
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
										: album
											? "That record is not in your library."
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
					) : artist ? (
						<div
							key={artistTab}
							className={styles.artistTab}
							data-direction={tabDirection}
						>
							{artistTab === "tracks" ? (
								<LibraryListView
									library={library}
									view={artistView ?? EMPTY_VIEW}
									kind={SCRATCH_KIND.artist}
									label={artist}
									eyebrow="Artist"
									title={artist}
									tabs={artistTabs}
									playlists={playlists}
									scrollRef={scrollRef}
									isCompactViewport={isCompactViewport}
									onOpenPlaylist={openPlaylist}
									emptyNotice={
										library.isLoading
											? "Reading your library..."
											: `Nothing by ${artist} in your library.`
									}
								/>
							) : (
								<ArtistView
									tabs={artistTabs}
									name={artist}
									library={library}
									tracks={artistTracks}
									onPlay={playArtist}
									onShuffle={(refs) => {
										playbackOrder.enableShuffle();
										playArtist(refs, Math.floor(Math.random() * refs.length));
									}}
									// Opens the tracks, lands on the record and starts it -- played inside the
									// artist rather than alone, so the rest of them follow it.
									onOpenAlbum={(refs) => {
										const at = Array.prototype.indexOf.call(
											artistTracks.all,
											refs[0],
										);
										askToReveal(refs[0]);
										showArtistTab("tracks");
										if (at >= 0) playArtist(artistTracks.all, at);
									}}
									canPlay={home.canPlay}
									canShuffle={home.canShuffle}
								/>
							)}
						</div>
					) : (
						<PlaylistView
							playlist={playlist}
							scrollRef={scrollRef}
							isCompactViewport={isCompactViewport}
						/>
					)}
				</main>

				<NowPlaying
					isOpen={isNowPlaying}
					isCompactViewport={isCompactViewport}
					isQueueOpen={isQueueOpen}
					onToggleQueue={toggleQueue}
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

			<Toasts />

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
