import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { useIsPlaying } from "@/domain/player/usePlayer";
import { useAvailableFields } from "@/domain/track/fieldAvailability";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import type { TrackView } from "@/domain/track/project";
import { revealed, useRevealAsked } from "@/domain/track/revealTrack";
import { href, ROUTE } from "@/domain/track/routes";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useFinder } from "@/domain/track/useFinder";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { CreateAutoPlaylist } from "@/features/genres/CreateAutoPlaylist";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";

type FinderPhrase = Extract<Phrase, `finder.in${string}`>;

const FINDER_LABEL: Record<string, FinderPhrase> = {
	[SCRATCH_KIND.all]: "finder.inAllMusic",
	[SCRATCH_KIND.shelf]: "finder.inShelf",
	[SCRATCH_KIND.genre]: "finder.inGenre",
	[SCRATCH_KIND.album]: "finder.inAlbum",
	[SCRATCH_KIND.artist]: "finder.inArtist",
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
	const t = useTranslate();
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const { indices, heat, patina, playedCount } = view;

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

	const isGenre = kind === SCRATCH_KIND.genre;

	const { hasPlayCounts } = useAvailableFields();
	const stats = useMemo(
		() => summarise(view, playedCount, isGenre ? { genres: 0 } : undefined),
		[view, playedCount, isGenre],
	);

	const finder = useFinder({
		rows: view,
		browserRef,
		label: t(FINDER_LABEL[kind] ?? "finder.inList"),
	});

	const { playAt, activeIndex, canPlaySets } = useViewPlayback({
		library,
		playlists,
		kind,
		label,
		indices,
	});

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);
	const readingText = isReading
		? readingNotice(status, "library.reading", t)
		: undefined;

	return (
		<TrackBrowser
			ref={browserRef}
			rows={view}
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
			loadingNotice={readingText}
			progressLabel={readingText}
			header={
				<ViewHeader
					eyebrow={eyebrow}
					title={title}
					tabs={tabs}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					allGenresHref={
						kind === SCRATCH_KIND.all ? href(ROUTE.genres) : undefined
					}
					aside={
						<Mosaic
							source={library.source}
							rows={view}
							seed={`${kind}:${label}`}
						/>
					}
					actions={
						<>
							<PlayActions
								browserRef={browserRef}
								trackCount={view.length}
								canPlaySets={canPlaySets}
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
