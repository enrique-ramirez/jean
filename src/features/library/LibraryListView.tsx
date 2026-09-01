import type { ReactNode, RefObject } from "react";
import { useMemo, useRef } from "react";
import { useActivePosition } from "@/domain/library/useActivePosition";
import type { Library } from "@/domain/library/useLibrary";
import { usePlaySet } from "@/domain/library/usePlaySet";
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

// One list, whatever filtered it. All music is the no-filter view; a shelf is
// the same thing with a preset. Both are shells over the library array and
// neither is a playlist -- playback is materialised into the scratch only when
// somebody presses play, which is what keeps browsing free.
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
	// Strictly true, not merely "not false": without the permission there is no
	// scratch playlist to make, so Shuffle would be shuffling the whole library
	// rather than this view. Better absent until the player has said yes.
	const canWrite = usePermissions().changePlaylists === true;

	const { hasPlayCounts } = useAvailableFields(rows);
	const stats = useMemo(
		() => summarise(rows, playedCount),
		[rows, playedCount],
	);

	// Named for what it is searching, because the top bar has a search of its own
	// two centimetres above and the two do different things: that one filters the
	// library down to matches, this one walks you to a track without disturbing a
	// row. All music is where it matters most -- a whole library is not something
	// anyone scrolls looking for a record.
	const finder = useFinder({
		rows,
		browserRef,
		label:
			kind === SCRATCH_KIND.all ? "Find in all music" : "Find in this shelf",
	});

	const { play, scratch } = usePlaySet({ library, playlists });
	const holdsThisView = scratch.holdsView(kind, label, indices.length);

	const activeIndex = useActivePosition({
		source: library.source,
		indices,
		scratch,
		holdsThisView,
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
			// Unlike search, these rows do not change under every keystroke, so
			// following playback is safe -- and it is what makes opening a shelf land
			// on the track it just started.
			canFollowPlayback
			onPlay={(position) => play({ kind, label, refs: indices, position })}
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
