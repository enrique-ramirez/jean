import type { ReactNode, RefObject } from "react";
import { useMemo, useRef } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { SCRATCH_KIND, type ScratchKind } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import type { TrackView } from "@/domain/track/project";
import { href, ROUTE } from "@/domain/track/routes";
import { summarise } from "@/domain/track/stats";
import { TrackPage } from "@/domain/track/TrackPage";
import { useFinder } from "@/domain/track/useFinder";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { CreateAutoPlaylist } from "./CreateAutoPlaylist";

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
	kind: ScratchKind;
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

	const isGenre = kind === SCRATCH_KIND.genre;

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
		<TrackPage
			browserRef={browserRef}
			rows={view}
			source={library.source}
			viewKey={`${kind}:${label}`}
			heat={heat}
			patina={patina}
			activeIndex={activeIndex}
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
			eyebrow={eyebrow}
			title={title}
			tabs={tabs}
			stats={stats}
			allGenresHref={kind === SCRATCH_KIND.all ? href(ROUTE.genres) : undefined}
			mosaicSeed={`${kind}:${label}`}
			canPlaySets={canPlaySets}
			actions={
				isGenre && label && onOpenPlaylist ? (
					<CreateAutoPlaylist genre={label} onOpenPlaylist={onOpenPlaylist} />
				) : null
			}
		/>
	);
}
