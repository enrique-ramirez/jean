import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import type { Library } from "@/domain/library/useLibrary";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import {
	canChangePlaylists,
	useIsPlaying,
	usePermissions,
} from "@/domain/player/usePlayer";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import type { TrackView } from "@/domain/track/project";
import { revealed, useRevealAsked } from "@/domain/track/revealTrack";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { useFinder } from "@/domain/track/useFinder";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { CreateAutoPlaylist } from "@/features/genres/CreateAutoPlaylist";
import type { PlaylistInfo } from "@/shared/api/types";
import styles from "./LibraryListView.module.css";

const FINDER_LABEL: Record<string, string> = {
	[SCRATCH_KIND.all]: "Find in all music",
	[SCRATCH_KIND.shelf]: "Find in this shelf",
	[SCRATCH_KIND.genre]: "Find in this genre",
	[SCRATCH_KIND.artist]: "Find in this artist",
};

export function LibraryListView({
	library,
	view,
	kind,
	label,
	title,
	eyebrow,
	tabs,
	playlists,
	scrollRef,
	isCompactViewport,
	emptyNotice,
	onOpenPlaylist,
}: {
	library: Library;
	view: TrackView;
	kind: string;
	label: string | null;
	title: ReactNode;
	eyebrow?: ReactNode;
	tabs?: ReactNode;
	playlists: PlaylistInfo[];
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	emptyNotice?: ReactNode;
	onOpenPlaylist?: (id: string) => void;
}) {
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const { rows, indices, heat, patina, playedCount } = view;

	// Asked from somewhere with no list of its own -- an album on the artist's overview, which opens
	// the tracks tab and expects to land on that record.
	const revealing = useRevealAsked();
	useEffect(() => {
		if (revealing === null) return;
		const position = Array.prototype.indexOf.call(indices, revealing);
		if (position < 0) return;

		revealed();
		browserRef.current?.scrollToTrack(position, {
			align: "start",
			animate: true,
		});
	}, [revealing, indices]);

	const isPlaying = useIsPlaying();
	const canWrite = canChangePlaylists(usePermissions());

	const isGenre = kind === SCRATCH_KIND.genre;

	const { hasPlayCounts } = useAvailableFields(rows);
	const stats = useMemo(
		() => summarise(rows, playedCount, isGenre ? { genres: 0 } : undefined),
		[rows, playedCount, isGenre],
	);

	const finder = useFinder({
		rows,
		browserRef,
		label: FINDER_LABEL[kind] ?? "Find in this list",
	});

	const { playAt, activeIndex } = useViewPlayback({
		library,
		playlists,
		kind,
		label,
		indices,
	});

	if (library.error) {
		return (
			<p className={styles.notice}>
				Could not read your library -- {library.error.message}
			</p>
		);
	}

	return (
		<TrackBrowser
			ref={browserRef}
			rows={rows}
			indices={indices}
			source={library.source}
			viewKey={`${kind}:${label}`}
			heat={heat}
			patina={patina}
			activeIndex={activeIndex}
			isPlaying={isPlaying}
			matches={finder.matches}
			keysEnabled={!finder.isFinding}
			isLoading={library.isLoading}
			loaded={library.loaded}
			total={library.total}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			canFollowPlayback
			onPlay={playAt}
			onOpenFinder={finder.open}
			toolbarLeading={finder.toolbarLeading}
			emptyNotice={emptyNotice}
			header={
				<ViewHeader
					eyebrow={eyebrow}
					title={title}
					tabs={tabs}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					allGenresHref={kind === SCRATCH_KIND.all ? GENRES_HREF : undefined}
					aside={
						<Mosaic
							source={library.source}
							rows={rows}
							indices={indices}
							seed={`${kind}:${label}`}
						/>
					}
					actions={
						<>
							<PlayActions
								browserRef={browserRef}
								trackCount={rows.length}
								canShuffle={canWrite}
							/>
							{isGenre && label && onOpenPlaylist ? (
								<CreateAutoPlaylist
									genre={label}
									onOpenPlaylist={onOpenPlaylist}
								/>
							) : null}
						</>
					}
				/>
			}
		/>
	);
}
