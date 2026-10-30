import type { ReactNode, RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import { QuestionFailure } from "@/domain/library/QuestionFailure";
import type { QuestionFailed } from "@/domain/library/questionFailed";
import type { Library } from "@/domain/library/useLibrary";
import { byWait, NO_WAIT, type Wait } from "@/domain/library/useOverdue";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { SCRATCH_KIND, type ScratchKind } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import type { ListedRows } from "@/domain/track/project";
import { type HeaderStats, statsOfFigures } from "@/domain/track/stats";
import { type PageHeading, TrackPage } from "@/domain/track/TrackPage";
import { useFinder } from "@/domain/track/useFinder";
import type { SetFigures } from "@/shared/api/libraryQuestions";
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

function useKeptStats(pageKey: string, counted: HeaderStats | null) {
	const [held, setHeld] = useState<{ key: string; stats: HeaderStats } | null>(
		null,
	);
	if (counted && (held?.key !== pageKey || held.stats !== counted))
		setHeld({ key: pageKey, stats: counted });
	return held?.key === pageKey ? held.stats : null;
}

export function LibraryListView({
	library,
	pageKey,
	view,
	kind,
	label,
	heading,
	playlists,
	scrollRef,
	isCompactViewport,
	emptyNotice,
	wait = NO_WAIT,
	figures = null,
	isAwaitingColumns = false,
	failure = null,
	onOpenPlaylist,
}: {
	library: Library;
	pageKey: string;
	view: ListedRows;
	kind: ScratchKind;
	label: string | null;
	heading?: PageHeading;
	playlists: PlaylistInfo[];
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	emptyNotice?: ReactNode;
	wait?: Wait;
	figures?: SetFigures | null;
	isAwaitingColumns?: boolean;
	failure?: QuestionFailed | null;
	onOpenPlaylist?: (id: string) => void;
}) {
	const t = useTranslate();
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const { heat, patina } = view;
	const { source } = library;

	const isGenre = kind === SCRATCH_KIND.genre;

	const answered = useMemo(
		() => (figures ? statsOfFigures(figures) : null),
		[figures],
	);
	const counted = wait.isWaiting ? null : answered;
	const kept = useKeptStats(pageKey, counted);
	const stats = counted ?? (wait.isOverdue ? null : kept);

	const finder = useFinder({
		rows: view,
		over: { kind: "library", ...library },
		browserRef,
		label: t(FINDER_LABEL[kind] ?? "finder.inList"),
	});

	const { playAt, activeIndex, canPlaySets } = useViewPlayback({
		library,
		source,
		playlists,
		kind,
		label,
		indices: view.indices,
		length: view.length,
	});

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);
	const readingText = isReading
		? readingNotice(status, "library.reading", t)
		: byWait(wait, {
				settled: undefined,
				quiet: undefined,
				reading: t("library.reading"),
			});
	const loadingNotice = byWait(wait, {
		settled: readingText,
		quiet: "",
		reading: isAwaitingColumns && !isReading ? "" : readingText,
	});

	return (
		<TrackPage
			browserRef={browserRef}
			rows={view}
			source={source}
			viewKey={`${kind}:${label}`}
			heat={heat}
			patina={patina}
			activeIndex={activeIndex}
			matches={finder.matches}
			keysEnabled={!finder.isFinding}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			canFollowPlayback
			onPlay={playAt}
			onOpenFinder={finder.open}
			toolbarLeading={finder.toolbarLeading}
			emptyNotice={emptyNotice}
			loadingNotice={loadingNotice}
			failureNotice={failure ? <QuestionFailure {...failure} /> : undefined}
			hasPendingRows={isAwaitingColumns && wait.isWaiting && !isReading}
			heading={heading}
			stats={stats}
			wait={wait}
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
