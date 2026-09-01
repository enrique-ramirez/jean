import { useMemo } from "react";
import { LibrarySetup } from "@/domain/library/LibrarySetup";
import type { Library } from "@/domain/library/useLibrary";
import type { PlaylistInfo } from "@/shared/api/types";
import { albumsOf, type CoveredAlbum } from "./albums";
import { HomeHeader } from "./HomeHeader";
import styles from "./HomeView.module.css";
import { libraryStats } from "./libraryStats";
import { ShelfRow } from "./ShelfRow";
import { buildShelves, type FilledShelf } from "./shelves";

// Rows, not one big carousel. Cover Flow was removed from iTunes because it
// could not browse: one album at a time across two thousand is a flick-fest.
// Each row here is a *reason* instead -- a small set with a sentence attached,
// which is a thing to press play on rather than a thing to page through.
export function HomeView({
	library,
	playlists,
	onPlayAlbum,
	onPlayEverything,
	onShuffleEverything,
	canPlay,
	canShuffle,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	onPlayAlbum: (shelf: FilledShelf<CoveredAlbum>, album: CoveredAlbum) => void;
	onPlayEverything: () => void;
	onShuffleEverything: () => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	// Once per library, not per render: the aggregation is a pass over every row
	// and the shelves are sorts over the result. The header counts albums and
	// artists off the same pass rather than making its own.
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
		() => libraryStats({ rows: library.rows, albums, playlists }),
		[library.rows, albums, playlists],
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

	// Deliberately not a spinner over an empty screen: the first chunk paints in
	// well under a second and the shelves appear under the heading as they fill.
	return (
		<div className={styles.home}>
			<HomeHeader
				stats={stats}
				isLoading={library.isLoading}
				onPlayEverything={onPlayEverything}
				onShuffleEverything={onShuffleEverything}
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
					{shelves.map((shelf) => (
						<ShelfRow key={shelf.id} shelf={shelf} onPlayAlbum={onPlayAlbum} />
					))}
				</div>
			)}
		</div>
	);
}
