import { type RefObject, useMemo, useRef } from "react";
import { useActiveItem } from "@/domain/player/usePlayer";
import { usePlayItem } from "@/domain/player/useTransport";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { trackRows } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { TrackPage } from "@/domain/track/TrackPage";
import { useFinder } from "@/domain/track/useFinder";
import { usePlaylistItems } from "@/domain/track/usePlaylistItems";
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
	const activeItem = useActiveItem(playlist?.id);
	const playItem = usePlayItem();

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
				{t("playlist.loadFailed", { message: error.message })}
			</p>
		);
	}

	return (
		<TrackPage
			browserRef={browserRef}
			rows={rows}
			source={source}
			viewKey={`playlist:${playlist.id}`}
			heat={heat}
			patina={patina}
			activeIndex={activeItem?.index ?? -1}
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
			eyebrow={t(activeItem ? "playlist.playingFrom" : "playlist.eyebrow")}
			title={playlist.title}
			stats={stats}
			mosaicSeed={playlist.id}
			toolbarLeading={finder.toolbarLeading}
		/>
	);
}
