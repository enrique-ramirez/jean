import { SquarePen } from "lucide-react";
import { type RefObject, useRef } from "react";
import { isEditableAutoPlaylist } from "@/domain/player/editableAutoPlaylist";
import { useActiveItem } from "@/domain/player/usePlayer";
import { usePlayItem } from "@/domain/player/useTransport";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { PendingRows } from "@/domain/track/PendingRows";
import { TrackPage } from "@/domain/track/TrackPage";
import { useFinder } from "@/domain/track/useFinder";
import {
	usePlaylistItems,
	usePlaylistWindows,
} from "@/domain/track/usePlaylistItems";
import { usePlaylistRowEdits } from "@/domain/track/usePlaylistRowEdits";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./PlaylistView.module.css";
import { SortMenu } from "./SortMenu";

export function PlaylistView({
	playlist,
	scrollRef,
	isCompactViewport,
	onEditAutoPlaylist,
}: {
	playlist: PlaylistInfo | null;
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	onEditAutoPlaylist: (playlist: PlaylistInfo) => void;
}) {
	const t = useTranslate();
	const { discovery } = useFooJean();
	const { origin } = discovery;
	const windowed = usePlaylistWindows(playlist?.id);
	const { drawn, onReorder, onNudge, onRemove, sort } = usePlaylistRowEdits({
		playlist,
		windowed,
	});
	const { isOpening, failure, rows, groups, hasDiscs, stats } =
		usePlaylistItems(windowed, playlist, drawn);

	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const activeItem = useActiveItem(playlist?.id);
	const playItem = usePlayItem();

	const finder = useFinder({
		rows,
		over:
			playlist && origin && windowed
				? {
						kind: "playlist",
						origin,
						id: playlist.id,
						structure: playlist.structure,
						revision: playlist.revision,
						length: playlist.itemCount,
						windowed,
					}
				: null,
		browserRef,
		label: t("shortcut.openFinder"),
	});

	if (!playlist)
		return <p className={styles.notice}>{t("playlist.chooseOne")}</p>;
	if (!windowed) return <PendingRows />;

	if (failure)
		return (
			<p className={styles.notice}>
				{t("playlist.loadFailed", { message: failure })}
			</p>
		);

	const canEditQuery =
		permitsPlaylistWrites(discovery) && isEditableAutoPlaylist(playlist);

	return (
		<TrackPage
			browserRef={browserRef}
			rows={rows}
			source={windowed.source}
			runGroups={{ groups, hasDiscs }}
			viewKey={`playlist:${playlist.id}`}
			heat={rows.heat}
			patina={rows.patina}
			activeIndex={activeItem?.index ?? -1}
			matches={finder.matches}
			isLoading={isOpening}
			loaded={0}
			total={playlist.itemCount}
			hasPendingRows={isOpening}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			keysEnabled={!finder.isFinding}
			canFollowPlayback
			onPlay={(index) => playItem.mutate({ playlistId: playlist.id, index })}
			onOpenFinder={finder.open}
			onReorder={onReorder}
			onNudge={onNudge}
			onRemove={onRemove}
			actions={
				canEditQuery ? (
					<Button icon={SquarePen} onClick={() => onEditAutoPlaylist(playlist)}>
						{t("autoplaylist.edit")}
					</Button>
				) : sort && rows.length >= 2 ? (
					<SortMenu onSort={sort} />
				) : null
			}
			emptyNotice={t("playlist.empty")}
			heading={{
				eyebrow: t(activeItem ? "playlist.playingFrom" : "playlist.eyebrow"),
				title: playlist.title,
			}}
			stats={stats}
			trackCount={playlist.itemCount}
			mosaicSeed={playlist.id}
			toolbarLeading={finder.toolbarLeading}
		/>
	);
}
