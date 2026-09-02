import { useMemo } from "react";
import { LibrarySetup } from "@/domain/library/LibrarySetup";
import type { Library } from "@/domain/library/useLibrary";
import type { PlaylistInfo } from "@/shared/api/types";
import { albumsOf, type CoveredAlbum } from "./albums";
import { GenreBars } from "./GenreBars";
import { HomeHeader } from "./HomeHeader";
import styles from "./HomeView.module.css";
import { libraryStats } from "./libraryStats";
import { ShelfRow } from "./ShelfRow";
import { ShelfTabs } from "./ShelfTabs";
import { buildShelves, type FilledShelf } from "./shelves";
import { TopTracks } from "./TopTracks";
import { topTracksOf } from "./tracks";

// The shelf that stays a row of its own. Every other one is behind a tab: this
// is the one worth finding by scrolling rather than by looking, because it is
// the only shelf whose answer changes between one visit and the next.
const FREE_SHELF = "recent";

// Ten is what fits beside the genre block without either half of the band
// dragging the other one's length. `GENRE_BARS` in `libraryStats.ts` is set
// against this, so the two move together.
const TOP_TRACKS = 10;

// Rows, not one big carousel. Cover Flow was removed from iTunes because it
// could not browse: one album at a time across two thousand is a flick-fest.
// Each row here is a *reason* instead -- a small set with a sentence attached,
// which is a thing to press play on rather than a thing to page through.
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

	// The two halves of the closing band. Either can be absent -- no play counts
	// is no track list, no genre tag is no bars -- and the survivor takes the
	// whole width rather than sitting in half of it beside a hole.
	const hasBand = tracks.length > 0 || stats.topGenres.length > 0;

	// Deliberately not a spinner over an empty screen: the first chunk paints in
	// well under a second and the shelves appear under the heading as they fill.
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

			{/* Last, and that ordering is the whole argument: what a library *is* is
          interesting, and what is in it is what somebody came for. Anything
          actionable outranks anything merely true. */}
			{hasBand ? (
				<div className={styles.band}>
					<TopTracks tracks={tracks} onPlayTrack={onPlayTrack} />
					<GenreBars genres={stats.topGenres} />
				</div>
			) : null}
		</div>
	);
}
