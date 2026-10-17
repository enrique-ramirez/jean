import { useMemo } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import {
	atStructure,
	useLibrarySummary,
} from "@/domain/library/useLibrarySummary";
import { libraryArtworkUrl } from "@/shared/api/artwork";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import { type CoveredAlbum, covered } from "./cover";
import { GenreBars } from "./GenreBars";
import { type HeaderFigures, HomeHeader, NO_FIGURES } from "./HomeHeader";
import styles from "./HomeView.module.css";
import { hasBandOf, useKeptLayout } from "./keptLayout";
import { ShelfRow } from "./ShelfRow";
import { ShelfTabs } from "./ShelfTabs";
import { catalogueEntry, type DrawnShelf } from "./shelves";
import { type TopTrack, TopTracks } from "./TopTracks";

const FREE_SHELVES = ["added", "recent"];

export function HomeView({
	library,
	onPlayAlbum,
	onPlayTrack,
	onPlayEverything,
	onShuffleEverything,
	onSearch,
	canPlay,
	canShuffle,
}: {
	library: Library;
	onPlayAlbum: (shelf: DrawnShelf<CoveredAlbum>, album: CoveredAlbum) => void;
	onPlayTrack: (ref: number) => void;
	onPlayEverything: () => void;
	onShuffleEverything: () => void;
	onSearch: (query: string) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const t = useTranslate();
	const { origin, structure } = library;
	const hasTracks = library.columns.trackCount > 0;

	const held = useLibrarySummary(library);
	const summary = atStructure(held, structure);
	const isWaiting = hasTracks && summary === null;

	const kept = useKeptLayout(summary);

	const laidOut = useMemo(
		(): DrawnShelf<CoveredAlbum>[] =>
			isWaiting
				? kept.shelves.flatMap((id) => {
						const entry = catalogueEntry(id);
						return entry ? [{ ...entry, albums: [], isPending: true }] : [];
					})
				: (summary?.shelves ?? []).flatMap((shelf) => {
						const entry = catalogueEntry(shelf.id);
						return entry
							? [
									{
										...entry,
										albums: shelf.albums.map((album) => covered(origin, album)),
										isPending: false,
									},
								]
							: [];
					}),
		[isWaiting, kept, summary, origin],
	);

	const figures = useMemo((): HeaderFigures | null => {
		if (!summary) return hasTracks ? null : NO_FIGURES;
		const { topAlbum, topArtist } = summary;
		return {
			...summary,
			topAlbum: topAlbum && covered(origin, topAlbum),
			topArtist: topArtist && {
				name: topArtist.name,
				cover: covered(origin, topArtist.cover),
			},
		};
	}, [summary, hasTracks, origin]);

	const tracks = useMemo(
		(): TopTrack[] =>
			(summary?.topTracks ?? []).map((track) => ({
				ref: track.ordinal,
				title: track.title ?? t("track.unknownTitle"),
				artist: track.artist,
				plays: track.plays,
				artworkUrl:
					track.cover === null ? null : libraryArtworkUrl(origin, track.cover),
			})),
		[summary, origin, t],
	);

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);

	const free = laidOut.filter((shelf) => FREE_SHELVES.includes(shelf.id));
	const tabbed = laidOut.filter((shelf) => !free.includes(shelf));

	const hasBand = isWaiting
		? kept.band
		: summary !== null && hasBandOf(summary);

	return (
		<div className={styles.home}>
			<HomeHeader
				figures={figures}
				isLoading={library.isLoading}
				onPlayEverything={onPlayEverything}
				onShuffleEverything={onShuffleEverything}
				onSearch={onSearch}
				canPlay={canPlay && hasTracks}
				canShuffle={canShuffle && hasTracks}
			/>

			{laidOut.length === 0 ? (
				<p className={styles.notice}>
					{isReading
						? readingNotice(status, "home.reading", t)
						: t("home.nothingYet")}
				</p>
			) : (
				<div className={styles.shelves}>
					{free.map((shelf) => (
						<ShelfRow key={shelf.id} shelf={shelf} onPlayAlbum={onPlayAlbum} />
					))}
					{tabbed.length > 0 ? (
						<ShelfTabs shelves={tabbed} onPlayAlbum={onPlayAlbum} />
					) : null}
				</div>
			)}

			{hasBand ? (
				<div className={styles.band} {...busyProps(isWaiting)}>
					{isWaiting ? (
						<>
							<Skeleton className={styles.bandPlaceholder} />
							<Skeleton className={styles.bandPlaceholder} />
							<BusyNote />
						</>
					) : (
						<>
							<TopTracks tracks={tracks} onPlayTrack={onPlayTrack} />
							<GenreBars genres={summary?.topGenres ?? []} />
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
