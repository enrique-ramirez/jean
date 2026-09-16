import {
	ChevronUp,
	Keyboard,
	Moon,
	PanelLeft,
	Search,
	Settings,
	Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import { searchRoute } from "@/domain/library/searchRoute";
import { useLibrary } from "@/domain/library/useLibrary";
import { useLibrarySearch } from "@/domain/library/useLibrarySearch";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { usePlaySet } from "@/domain/library/usePlaySet";
import { usePlayerPoll } from "@/domain/player/playerPoll";
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
import { usePlayingPlaylist } from "@/domain/player/usePlayingPlaylist";
import { AlbumCrumb } from "@/domain/track/AlbumCrumb";
import { albumsOf, refsOfAlbum } from "@/domain/track/albums";
import { type ArtistTab, artistRoute } from "@/domain/track/artistRoute";
import { type ArtistTracks, refsOfArtist } from "@/domain/track/artists";
import {
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
import {
	isPlayingRoute,
	type PanelTab,
	panelOfRoute,
	playingRoute as routeOfPanel,
} from "@/features/now-playing/panelRoute";
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
import { bearer } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTheme } from "@/shared/hooks/useTheme";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { mnemonicOf } from "@/shared/keyboard/mnemonic";
import {
	SHORTCUTS_KEYBOARD,
	ShortcutSheet,
} from "@/shared/keyboard/ShortcutSheet";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { ArtworkAccessProvider } from "@/shared/ui/Artwork";
import { animateScrollTo } from "@/shared/ui/animateScroll";
import { Button } from "@/shared/ui/Button";
import { Crumb } from "@/shared/ui/Crumb";
import { DragGhost } from "@/shared/ui/DragGhost";
import { Tabs } from "@/shared/ui/Tabs";
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
import { useIsAtTop } from "./useIsAtTop";
import { useScrollMemory } from "./useScrollMemory";

const SEEK_STEP = 5;

const ARTIST_TABS = [
	{ value: "overview", label: "artist.overview" },
	{ value: "tracks", label: "artist.tracks" },
] as const satisfies readonly { value: ArtistTab; label: Phrase }[];

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
	const t = useTranslate();
	usePlayerStream();
	useDocumentIdentity();

	const { data: playlists = [], isSuccess: hasPlaylists } = usePlaylists();
	const { data: playerState, isSuccess: hasPlayer } = usePlayer();
	const activeItem = playerState?.player?.activeItem;
	const playingPlaylistId = usePlayingPlaylist(
		activeItem?.playlistGuid ?? null,
	);
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
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [tabDirection, setTabDirection] = useState(0);

	const scrollRef = useRef<HTMLDivElement | null>(null);

	const isNowPlaying = isPlayingRoute(route);
	const [openedFrom, setOpenedFrom] = useState("");
	const shellRoute = isNowPlaying ? openedFrom : route;

	const {
		shelf,
		searchQuery,
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

	const { discovery } = useFooJean();
	usePlayerPoll(
		discovery.origin,
		discovery.token,
		discovery.state.kind === "ready" ? discovery.state.capabilities : null,
	);
	const artworkAccess = useMemo(
		() =>
			discovery.origin && discovery.token
				? { origin: discovery.origin, headers: bearer(discovery.token) }
				: null,
		[discovery.origin, discovery.token],
	);

	const library = useLibrary();
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
		if (!shelf || snapshot.columns.trackCount === 0) return null;
		const built = buildShelves(albumsOf(allMusic)).find(
			(entry) => entry.id === shelf.id,
		);
		return built ? project(snapshot, refsOfShelf(built)) : null;
	}, [shelf, snapshot, allMusic]);

	const artistTracks = useMemo(
		() =>
			artist ? refsOfArtist(snapshot.columns, artist) : EMPTY_ARTIST_TRACKS,
		[artist, snapshot.columns],
	);

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
		() =>
			genre ? project(snapshot, refsOfGenre(snapshot.columns, genre)) : null,
		[genre, snapshot],
	);

	// The route carries the two halves normalised, so the record's own spelling comes back with its
	// rows and is what the header draws.
	const albumTracks = useMemo(
		() => (album ? refsOfAlbum(snapshot.columns, albumArtist, album) : null),
		[album, albumArtist, snapshot.columns],
	);

	const albumView = useMemo(
		() => (albumTracks ? project(snapshot, albumTracks.refs) : null),
		[albumTracks, snapshot],
	);

	const listView = shelf
		? {
				view: shelfView,
				kind: SCRATCH_KIND.shelf,
				label: t(shelf.title),
				eyebrow: t("route.shelf"),
				title: t(shelf.title),
			}
		: genre
			? {
					view: genreView,
					kind: SCRATCH_KIND.genre,
					label: genre,
					eyebrow: <Crumb href={GENRES_HREF}>{t("home.allGenres")}</Crumb>,
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
						eyebrow: t("home.yourLibrary"),
						title: t("library.allMusic"),
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
			{ route: ROUTE.all, title: t("library.allMusic") },
		],
		[playingFrom, t],
	);

	const playingRoute = playingFrom?.isPlaying
		? playingFrom.route
		: browsable.some((entry) => entry.id === playingPlaylistId)
			? playingPlaylistId
			: null;
	const routedId = browsable.some((entry) => entry.id === route) ? route : null;

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

	const place = isHome
		? t("route.home")
		: isGenres
			? t("home.allGenres")
			: isAll || shelf || genre || album
				? listView.title
				: isSearch
					? t("search.title")
					: artist
						? artist
						: (playlist?.title ?? "");

	const cancelScroll = useRef<(() => void) | null>(null);
	const backToTop = useCallback(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		cancelScroll.current?.();
		cancelScroll.current = animateScrollTo(scroller, () => 0);
	}, []);

	const isAtTop = useIsAtTop(scrollRef);

	const isCompactBarShut = isCompactViewport && !isSearchOpen;
	const isBrandShown = !isCompactViewport || isCompactBarShut;

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

	const openSearch = useCallback(
		(query?: string) => openRoute(query ? searchRoute(query) : ROUTE.search),
		[openRoute],
	);

	useEffect(() => {
		if (isSearch) setIsSearchOpen(true);
	}, [isSearch]);

	// Focus follows only a deliberate reveal (revealSearch), never this effect: arriving at the
	// results with the field already open must not raise a software keyboard over them.
	const { focus: focusSearch } = search;
	const focusOnReveal = useRef(false);
	useEffect(() => {
		if (!isSearchOpen || !focusOnReveal.current) return;
		focusOnReveal.current = false;
		focusSearch();
	}, [isSearchOpen, focusSearch]);

	const revealSearch = useCallback(() => {
		focusOnReveal.current = true;
		setIsSearchOpen(true);
	}, []);

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
					label={t("artist.views")}
					options={ARTIST_TABS.map((tab) => ({
						...tab,
						label: t(tab.label),
						mnemonic: mnemonicOf(t(tab.label), "switchArtistTab"),
					}))}
					onChange={showArtistTab}
				/>
			) : null,
		[artist, artistTab, showArtistTab, t],
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
			openSearch(query);
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
		if (activeItem?.playlistGuid && playingPlaylistId === undefined) return;
		resumed.current = true;
		if (route !== "" || !activeItem || activeItem.index < 0) return;

		if (playingRoute) {
			setOpenedFrom(playingRoute);
			if (playingRoute === playingPlaylistId)
				lastPlaylistId.current = playingRoute;
		}
		navigate(`/${ROUTE.playing}`);
	}, [
		route,
		hasPlayer,
		hasPlaylists,
		activeItem,
		playingRoute,
		playingPlaylistId,
		navigate,
	]);

	useEffect(() => {
		if (settingsSeen || !hasPlaylists) return;
		setIsSettingsOpen(true);
		setSettingsSeen(true);
	}, [settingsSeen, hasPlaylists, setSettingsSeen]);

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
			revealSearch();
			search.focus();
		},
		backToTop,
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
		<ArtworkAccessProvider value={artworkAccess}>
			<div className={styles.app}>
				<header className={styles.topbar}>
					<Button
						variant="ghost"
						icon={PanelLeft}
						aria-label={isSidebarShown ? t("sidebar.hide") : t("sidebar.show")}
						aria-expanded={
							isCompactViewport ? isSidebarOpen : !isSidebarCollapsed
						}
						onClick={toggleSidebar}
					/>

					{isBrandShown ? (
						<a className={styles.brand} href={`#/${ROUTE.home}`}>
							je<span>a</span>n
						</a>
					) : null}

					{isCompactBarShut && place ? (
						<button
							type="button"
							className={styles.place}
							data-at-top={isAtTop || undefined}
							onClick={backToTop}
							// Omitted at the top: an unlabelled control's accessible name falls back to its
							// visible text, and there is nowhere left for the label to promise going.
							aria-label={isAtTop ? undefined : t("view.backToTop", { place })}
						>
							<span className={styles.placeName}>{place}</span>
							{isAtTop ? null : (
								<ChevronUp size={14} strokeWidth={2.5} aria-hidden="true" />
							)}
						</button>
					) : null}

					{isCompactBarShut ? null : (
						<LibrarySearchField
							search={search}
							library={library}
							onChange={search.type}
							onSubmit={() => openSearch(search.commit().query)}
							onSelect={(suggestion) => {
								if (suggestion.kind !== "track") {
									search.revert();
									openRoute(routeOfSuggestion(suggestion));
									return;
								}

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
							onLeave={() => {
								if (!search.hasDraft) setIsSearchOpen(false);
							}}
							onDismiss={() => {
								search.clear();
								setIsSearchOpen(false);
								if (isSearch) navigate(`/${selectedId}`);
							}}
						/>
					)}

					<div className={styles.actions}>
						{isCompactBarShut ? (
							<Button
								variant="ghost"
								icon={Search}
								aria-label={t("search.yourLibrary")}
								aria-expanded={false}
								onClick={revealSearch}
							/>
						) : null}
						<Button
							variant="ghost"
							className={styles.shortcuts}
							icon={Keyboard}
							aria-label={t("shortcuts.title")}
							onClick={() => setIsSheetOpen(true)}
						/>
						<Button
							variant="ghost"
							icon={Settings}
							aria-label={t("settings.title")}
							aria-expanded={isSettingsOpen}
							onClick={() => setIsSettingsOpen(true)}
						/>
						{isCompactViewport ? null : (
							<Button
								variant="ghost"
								icon={theme === "dark" ? Sun : Moon}
								aria-label={
									theme === "dark" ? t("theme.toLight") : t("theme.toDark")
								}
								onClick={toggleTheme}
							/>
						)}
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
						route={shellRoute}
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
										? t("library.reading")
										: genre
											? t("library.noGenre", { genre })
											: album
												? t("library.noAlbum")
												: t("library.empty")
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
										eyebrow={t("artist.eyebrow")}
										title={artist}
										tabs={artistTabs}
										playlists={playlists}
										scrollRef={scrollRef}
										isCompactViewport={isCompactViewport}
										onOpenPlaylist={openPlaylist}
										emptyNotice={
											library.isLoading
												? t("library.reading")
												: t("library.noArtist", { artist })
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
						tab={panelOfRoute(route)}
						onSelectTab={selectPanel}
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
					{t(isPlaying ? "player.playing" : "player.paused")}
				</span>
			</div>
		</ArtworkAccessProvider>
	);
}
