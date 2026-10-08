import { type RefObject, useCallback, useMemo, useState } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import type { usePlaySet } from "@/domain/library/usePlaySet";
import type { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { Refs } from "@/domain/track/project";
import { type ArtistTab, artistRoute } from "@/domain/track/routes";
import type { PageHeading } from "@/domain/track/TrackPage";
import { ArtistView, type SlideDirection } from "@/features/artist/ArtistView";
import { GenresView } from "@/features/genres/GenresView";
import { HomeView } from "@/features/home/HomeView";
import type { useHomePlayback } from "@/features/home/useHomePlayback";
import { LibraryListView } from "@/features/library/LibraryListView";
import { PlaylistView } from "@/features/playlist/PlaylistView";
import { SearchResults } from "@/features/search/SearchResults";
import type { PlaylistInfo } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Tabs } from "@/shared/ui/Tabs";
import styles from "./App.module.css";
import type { RouteView } from "./routes";
import type { ArtistPage, ListPage, useRouteView } from "./useRouteView";

const ARTIST_TABS = [
	{ value: "overview", label: "artist.overview" },
	{ value: "tracks", label: "artist.tracks" },
] as const satisfies readonly { value: ArtistTab; label: Phrase }[];

interface TabMotion {
	tab: ArtistTab;
	direction: SlideDirection;
}

interface MainViewProps {
	route: RouteView;
	page: ReturnType<typeof useRouteView>;
	library: Library;
	search: LibrarySearch;
	playlists: PlaylistInfo[];
	playlist: PlaylistInfo | null;
	scrollRef: RefObject<HTMLDivElement | null>;
	isCompactViewport: boolean;
	home: ReturnType<typeof useHomePlayback>;
	playSet: ReturnType<typeof usePlaySet>["play"];
	playbackMode: ReturnType<typeof usePlaybackOrder>;
	onOpenPlaylist: (id: string) => void;
	onOpenRoute: (route: string) => void;
	onSearch: (query: string) => void;
	onEditAutoPlaylist: (playlist: PlaylistInfo) => void;
}

export function MainView({
	route,
	page,
	library,
	search,
	playlists,
	playlist,
	scrollRef,
	isCompactViewport,
	home,
	playSet,
	playbackMode,
	onOpenPlaylist,
	onOpenRoute,
	onSearch,
	onEditAutoPlaylist,
}: MainViewProps) {
	const t = useTranslate();
	const { allMusic, list, artist } = page;
	const artistName = artist?.name ?? null;
	const artistTab = artist?.tab ?? "overview";
	const [swipe, setSwipe] = useState<TabMotion | null>(null);
	const [shownTab, setShownTab] = useState<TabMotion>({
		tab: artistTab,
		direction: 0,
	});
	if (shownTab.tab !== artistTab) {
		setShownTab({
			tab: artistTab,
			direction: swipe?.tab === artistTab ? swipe.direction : 0,
		});
		setSwipe(null);
	}

	const showArtistTab = useCallback(
		(tab: ArtistTab) => {
			if (!artistName) return;
			setSwipe({ tab, direction: tab === "tracks" ? 1 : -1 });
			onOpenRoute(artistRoute(artistName, tab));
		},
		[artistName, onOpenRoute],
	);

	const artistTabs = useMemo(
		() =>
			artistName ? (
				<Tabs
					value={artistTab}
					label={t("artist.views")}
					options={ARTIST_TABS.map((tab) => ({
						...tab,
						label: t(tab.label),
					}))}
					onChange={showArtistTab}
				/>
			) : null,
		[artistName, artistTab, showArtistTab, t],
	);

	const artistSwipe = useSwipe({
		onLeft: () => showArtistTab("tracks"),
		onRight: () => showArtistTab("overview"),
	});

	const stepArtistTab = (delta: number) => {
		const at = ARTIST_TABS.findIndex((tab) => tab.value === artistTab);
		const next = ARTIST_TABS[at + delta];
		if (next) showArtistTab(next.value);
	};

	useKeymap(
		SCOPE.artist,
		{
			previousTab: () => stepArtistTab(-1),
			nextTab: () => stepArtistTab(1),
		},
		{ enabled: Boolean(artistName) },
	);

	const playArtist = useCallback(
		(refs: Refs, position: number) =>
			void playSet({
				kind: SCRATCH_KIND.artist,
				label: artistName ?? "",
				refs,
				position,
			}),
		[playSet, artistName],
	);

	const listPage = (
		shown: Omit<ListPage, "heading">,
		heading?: PageHeading,
	) => (
		<LibraryListView
			library={library}
			view={shown.view}
			kind={shown.kind}
			label={shown.label}
			heading={heading}
			playlists={playlists}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			onOpenPlaylist={onOpenPlaylist}
			emptyNotice={shown.emptyNotice}
		/>
	);

	const artistPage = (shown: ArtistPage) => (
		<ArtistView
			name={shown.name}
			library={library}
			tracks={shown.tracks}
			tab={shown.tab}
			direction={shownTab.direction}
			tabs={artistTabs}
			tracksPanel={listPage({
				view: shown.view,
				kind: SCRATCH_KIND.artist,
				label: shown.name,
				emptyNotice: t("library.noArtist", { artist: shown.name }),
			})}
			onPlay={playArtist}
			onShuffle={(refs) => {
				playbackMode.enableShuffle();
				playArtist(refs, Math.floor(Math.random() * refs.length));
			}}
			canPlay={home.canPlay}
			canShuffle={home.canShuffle}
		/>
	);

	return (
		<main
			className={styles.main}
			ref={scrollRef}
			{...(artist ? artistSwipe : null)}
		>
			{route.kind === "home" ? (
				<HomeView
					library={library}
					onPlayAlbum={home.playShelf}
					onPlayTrack={(ref) => home.playTrack(allMusic.indices, ref)}
					onPlayEverything={() => home.playEverything(allMusic.indices)}
					onShuffleEverything={() => home.shuffleEverything(allMusic.indices)}
					onSearch={onSearch}
					canPlay={home.canPlay}
					canShuffle={home.canShuffle}
				/>
			) : route.kind === "genres" ? (
				<GenresView library={library} onOpenRoute={onOpenRoute} />
			) : list ? (
				listPage(list, list.heading)
			) : route.kind === "search" ? (
				<SearchResults
					search={search}
					library={library}
					playlists={playlists}
					scrollRef={scrollRef}
					isCompactViewport={isCompactViewport}
					onOpenPlaylist={onOpenPlaylist}
				/>
			) : artist ? (
				artistPage(artist)
			) : (
				<PlaylistView
					playlist={playlist}
					scrollRef={scrollRef}
					isCompactViewport={isCompactViewport}
					onEditAutoPlaylist={onEditAutoPlaylist}
				/>
			)}
		</main>
	);
}
