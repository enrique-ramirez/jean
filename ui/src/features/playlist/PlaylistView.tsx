import { type RefObject, useMemo, useRef } from "react";
import {
	useActiveItem,
	useIsPlaying,
	usePlayItem,
} from "@/domain/player/usePlayer";
import { useAvailableFields } from "@/domain/track/fieldAvailability";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import { trackRows } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useFinder } from "@/domain/track/useFinder";
import { usePlaylistItems } from "@/domain/track/usePlaylistItems";
import { ViewHeader } from "@/domain/track/ViewHeader";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
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
	const t = useTranslate();
	const { discovery } = useFooJean();
	const { origin } = discovery;
	const {
		columns,
		paths,
		subsongs,
		loaded,
		total,
		isLoading,
		error,
		heat,
		patina,
		playedCount,
	} = usePlaylistItems(
		origin,
		playlist?.id,
		playlist?.structure,
		playlist?.revision,
		playlist?.itemCount,
	);

	const rows = useMemo(() => trackRows(columns), [columns]);

	const source = useMemo(() => {
		const options = {
			kind: "playlist" as const,
			playlistId: playlist?.id as string,
			origin,
			structure: playlist?.structure,
		};

		return paths && subsongs
			? librarySourceOf({ ...options, paths, subsongs })
			: librarySourceOf(options);
	}, [playlist?.id, playlist?.structure, origin, paths, subsongs]);

	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const isPlaying = useIsPlaying();
	const activeItem = useActiveItem(playlist?.id);
	const playItem = usePlayItem();
	const { hasPlayCounts } = useAvailableFields();

	const finder = useFinder({
		rows,
		browserRef,
		label: t("shortcut.openFinder"),
	});

	const stats = useMemo(
		() => ({
			...summarise(rows, playedCount),
			trackCount: playlist?.itemCount ?? rows.length,
		}),
		[rows, playedCount, playlist?.itemCount],
	);

	if (!playlist)
		return <p className={styles.notice}>{t("playlist.chooseOne")}</p>;

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
			onPlay={(index) => playItem.mutate({ playlistId: playlist.id, index })}
			onOpenFinder={finder.open}
			emptyNotice={t("playlist.empty")}
			header={
				<ViewHeader
					eyebrow={t(activeItem ? "playlist.playingFrom" : "playlist.eyebrow")}
					title={playlist.title}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					aside={<Mosaic source={source} rows={rows} seed={playlist.id} />}
					actions={
						<PlayActions browserRef={browserRef} trackCount={rows.length} />
					}
				/>
			}
			toolbarLeading={finder.toolbarLeading}
		/>
	);
}
