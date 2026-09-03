import type { ReactNode, RefObject } from "react";
import { useMemo, useRef } from "react";
import type { Library } from "@/domain/library/useLibrary";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { useIsPlaying, usePermissions } from "@/domain/player/usePlayer";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import type { TrackView } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { useFinder } from "@/domain/track/useFinder";
import { ViewHeader } from "@/domain/track/ViewHeader";
import type { PlaylistInfo } from "@/shared/api/types";
import styles from "./LibraryListView.module.css";

// What the finder button calls the list it is searching.
const FINDER_LABEL: Record<string, string> = {
	[SCRATCH_KIND.all]: "Find in all music",
	[SCRATCH_KIND.shelf]: "Find in this shelf",
	[SCRATCH_KIND.genre]: "Find in this genre",
};

// One list, whatever filtered it: All music is the no-filter view and a shelf is the same thing with a preset.
// Neither is a playlist; playback is materialised into the scratch only when somebody presses play, which is what keeps browsing free.
export function LibraryListView({
	library,
	view,
	kind,
	label,
	title,
	eyebrow,
	playlists,
	scrollRef,
	isCompactViewport,
	emptyNotice,
}: {
	library: Library;
	view: TrackView;
	kind: string;
	label: string | null;
	title: ReactNode;
	eyebrow?: ReactNode;
	playlists: PlaylistInfo[];
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	emptyNotice?: ReactNode;
}) {
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const { rows, indices, heat, patina, playedCount } = view;

	const isPlaying = useIsPlaying();
	// Strictly true, not merely "not false": without the permission there is no scratch playlist to make, so Shuffle would shuffle the whole library rather than this view.
	const canWrite = usePermissions().changePlaylists === true;

	const isGenre = kind === SCRATCH_KIND.genre;

	const { hasPlayCounts } = useAvailableFields(rows);
	// No genre chips on a genre, where there is exactly one of them and it is at 100%.
	const stats = useMemo(
		() => summarise(rows, playedCount, isGenre ? { genres: 0 } : undefined),
		[rows, playedCount, isGenre],
	);

	// Named for what it is searching, because the top bar has its own search: that one filters the library down to matches, this one jumps to a row without changing the list.
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
			// Unlike search, these rows do not change under every keystroke, so following playback is safe.
			canFollowPlayback
			onPlay={playAt}
			onOpenFinder={finder.open}
			toolbarLeading={finder.toolbarLeading}
			emptyNotice={emptyNotice}
			header={
				<ViewHeader
					eyebrow={eyebrow}
					title={title}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					aside={
						<Mosaic
							source={library.source}
							trackCount={rows.length}
							indices={indices}
							seed={`${kind}:${label}`}
						/>
					}
					actions={
						<PlayActions
							browserRef={browserRef}
							trackCount={rows.length}
							canShuffle={canWrite}
						/>
					}
				/>
			}
		/>
	);
}
