import { useMemo } from "react";
import { LibrarySetup } from "@/domain/library/LibrarySetup";
import type { Library } from "@/domain/library/useLibrary";
import { albumsOf, type CoveredAlbum } from "@/domain/track/albums";
import type { PlaylistInfo } from "@/shared/api/types";
import { GenreBars } from "./GenreBars";
import { HomeHeader } from "./HomeHeader";
import styles from "./HomeView.module.css";
import { libraryStats } from "./libraryStats";
import { ShelfRow } from "./ShelfRow";
import { ShelfTabs } from "./ShelfTabs";
import { buildShelves, type FilledShelf } from "./shelves";
import { TopTracks } from "./TopTracks";
import { topTracksOf } from "./tracks";

const FREE_SHELF = "recent";

const TOP_TRACKS = 10;

export function HomeView({
	library,
	playlists,
	onPlayAlbum,
	onPlayTrack,
	onPlayEverything,
	onShuffleEverything,
	onSearch,
	canPlay,
	canShuffle,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
	onPlayTrack: (ref: number) => void;
	onPlayEverything: () => void;
	onShuffleEverything: () => void;
	onSearch: (query: string) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const albums = useMemo(
		() =>
			library.rows.length === 0
				? []
				: albumsOf(library.rows).map((album) => ({
						...album,
						artworkUrl: library.source.artworkUrl(album.refs[0]),
					})),
		[library.rows, library.source],
	);

	const shelves = useMemo(() => buildShelves(albums), [albums]);

	const stats = useMemo(
		() => libraryStats({ rows: library.rows, albums }),
		[library.rows, albums],
	);

	const tracks = useMemo(
		() => topTracksOf(library.rows, TOP_TRACKS, library.source.artworkUrl),
		[library.rows, library.source],
	);

	if (library.needsSetup) {
		return <LibrarySetup playlists={playlists} />;
	}

	if (library.error) {
		return (
			<p className={styles.notice}>
				Could not read your library -- {library.error.message}
			</p>
		);
	}

	const free = shelves.find((shelf) => shelf.id === FREE_SHELF) ?? null;
	const tabbed = shelves.filter((shelf) => shelf !== free);

	const hasBand = tracks.length > 0 || stats.topGenres.length > 0;

	return (
		<div className={styles.home}>
			<HomeHeader
				stats={stats}
				isLoading={library.isLoading}
				onPlayEverything={onPlayEverything}
				onShuffleEverything={onShuffleEverything}
				onSearch={onSearch}
				canPlay={canPlay && library.rows.length > 0}
				canShuffle={canShuffle && library.rows.length > 0}
			/>

			{shelves.length === 0 ? (
				<p className={styles.notice}>
					{library.isLoading
						? "Reading your library..."
						: "Nothing to show from your library yet."}
				</p>
			) : (
				<div className={styles.shelves}>
					{free ? <ShelfRow shelf={free} onPlayAlbum={onPlayAlbum} /> : null}
					{tabbed.length > 0 ? (
						<ShelfTabs shelves={tabbed} onPlayAlbum={onPlayAlbum} />
					) : null}
				</div>
			)}

			{hasBand ? (
				<div className={styles.band}>
					<TopTracks tracks={tracks} onPlayTrack={onPlayTrack} />
					<GenreBars genres={stats.topGenres} />
				</div>
			) : null}
		</div>
	);
}
