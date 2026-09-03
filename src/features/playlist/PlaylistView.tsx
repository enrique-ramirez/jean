import { type RefObject, useMemo, useRef } from "react";
import { useActiveItem, useIsPlaying } from "@/domain/player/usePlayer";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { useFinder } from "@/domain/track/useFinder";
import { usePlaylistItems } from "@/domain/track/usePlaylistItems";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { playItem } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import styles from "./PlaylistView.module.css";

export function PlaylistView({
	playlist,
	scrollRef,
	isCompactViewport,
}: {
	playlist: PlaylistInfo | null;
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
}) {
	const { rows, loaded, total, isLoading, error, heat, patina, playedCount } =
		usePlaylistItems(playlist?.id, playlist?.itemCount);

	// A playlist is addressed by index whatever the media library situation is; the library source only ever stands in for the library.
	const source = useMemo(
		() =>
			librarySourceOf({ kind: "playlist", playlistId: playlist?.id as string }),
		[playlist?.id],
	);

	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const isPlaying = useIsPlaying();
	const activeItem = useActiveItem(playlist?.id);
	const { hasPlayCounts } = useAvailableFields(rows);

	const finder = useFinder({
		rows,
		browserRef,
		label: "Find in this playlist",
	});

	const stats = useMemo(
		// itemCount rather than rows.length: the header states what the playlist holds, not how much of it has arrived.
		() => ({
			...summarise(rows, playedCount),
			trackCount: playlist?.itemCount ?? rows.length,
		}),
		[rows, playedCount, playlist?.itemCount],
	);

	if (!playlist)
		return <p className={styles.notice}>Select a playlist to begin.</p>;

	if (error) {
		return (
			<p className={styles.notice}>
				Could not load this playlist -- {error.message}
			</p>
		);
	}

	return (
		<TrackBrowser
			ref={browserRef}
			rows={rows}
			source={source}
			viewKey={`playlist:${playlist.id}`}
			heat={heat}
			patina={patina}
			activeIndex={activeItem?.index ?? -1}
			isPlaying={isPlaying}
			matches={finder.matches}
			isLoading={isLoading}
			loaded={loaded}
			total={total}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			keysEnabled={!finder.isFinding}
			canFollowPlayback
			// In place, by index. Nothing is written: the playlist already is the set.
			onPlay={(index) => playItem(playlist.id, index)}
			onOpenFinder={finder.open}
			emptyNotice="This playlist is empty."
			header={
				<ViewHeader
					eyebrow={playlist.isCurrent ? "Playing from" : "Playlist"}
					title={playlist.title}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					aside={
						<Mosaic
							source={source}
							trackCount={stats.trackCount}
							seed={playlist.id}
						/>
					}
					actions={
						<PlayActions browserRef={browserRef} trackCount={rows.length} />
					}
				/>
			}
			toolbarLeading={finder.toolbarLeading}
		/>
	);
}
