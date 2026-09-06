import { Search } from "lucide-react";
import type { RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { LibrarySetup } from "@/domain/library/LibrarySetup";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { useIsPlaying, usePermissions } from "@/domain/player/usePlayer";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { ViewHeader } from "@/domain/track/ViewHeader";
import type { PlaylistInfo } from "@/shared/api/types";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { plural } from "@/shared/lib/text";
import { Button } from "@/shared/ui/Button";
import { SavePlaylistButton } from "./SavePlaylistButton";
import styles from "./SearchResults.module.css";

// A view over the library, never a playlist: typing and refining write nothing, and a result set is materialised into the scratch playlist only when somebody asks to hear it.
export function SearchResults({
	search,
	library,
	playlists,
	scrollRef,
	isCompactViewport,
	onOpenPlaylist,
}: {
	search: LibrarySearch;
	library: Library;
	playlists: PlaylistInfo[];
	scrollRef: RefObject<HTMLElement | null>;
	isCompactViewport: boolean;
	onOpenPlaylist: (id: string) => void;
}) {
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const isPlaying = useIsPlaying();
	// A read-only instance gets a read-only Jean: no button that would 403, and no Shuffle, which without a scratch playlist would shuffle the whole library rather than these results.
	const canSavePlaylists = usePermissions().changePlaylists === true;

	const { rows, indices, heat, patina, playedCount } = search.results;
	const { hasPlayCounts } = useAvailableFields(rows);
	const stats = useMemo(
		() => summarise(rows, playedCount),
		[rows, playedCount],
	);

	const { playAt, activeIndex, scratch, holdsThisView } = useViewPlayback({
		library,
		playlists,
		kind: SCRATCH_KIND.search,
		label: search.query,
		indices,
	});

	useKeymap(
		SCOPE.search,
		{ saveSearch: () => setIsSaving(true) },
		{ enabled: canSavePlaylists && rows.length > 0 && !library.isLoading },
	);

	if (library.needsSetup) return <LibrarySetup playlists={playlists} />;

	if (library.error) {
		return (
			<p className={styles.notice}>
				Could not read your library -- {library.error.message}
			</p>
		);
	}

	if (!search.hasQuery) {
		return (
			<div className={styles.idle}>
				<Search size={26} strokeWidth={1.5} aria-hidden="true" />
				<h1 className={styles.idleTitle}>Search your library</h1>
				<p className={styles.idleBody}>
					{/* "Your library", never the name of whatever is standing in for it: with the media library API there is no playlist to name at all. */}
					{library.count.toLocaleString()} tracks in your library. Title, artist
					and album, as you type -- every word has to match, in any order.
				</p>
				<Button variant="primary" icon={Search} onClick={search.focus}>
					Start typing
				</Button>
			</div>
		);
	}

	return (
		<TrackBrowser
			ref={browserRef}
			rows={rows}
			indices={indices}
			source={library.source}
			viewKey={search.viewKey}
			heat={heat}
			patina={patina}
			activeIndex={activeIndex}
			isPlaying={isPlaying}
			isLoading={library.isLoading}
			loaded={library.loaded}
			total={library.total}
			scrollRef={scrollRef}
			isCompactViewport={isCompactViewport}
			keysEnabled={!search.isFocused}
			onPlay={playAt}
			// The library search is this list's filter, so `/` belongs to the field rather than to a second finder nested inside the results.
			onOpenFinder={search.focus}
			emptyNotice="Nothing in your library matches that."
			header={
				<ViewHeader
					eyebrow="Search results in your library"
					title={search.query}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					aside={
						<Mosaic
							source={library.source}
							rows={rows}
							indices={indices}
							seed={search.viewKey}
						/>
					}
					actions={
						<PlayActions
							browserRef={browserRef}
							trackCount={rows.length}
							canShuffle={canSavePlaylists}
						>
							{canSavePlaylists ? (
								<SavePlaylistButton
									search={search}
									library={library}
									scratch={scratch}
									holdsResults={holdsThisView}
									isOpen={isSaving}
									onOpenChange={setIsSaving}
									onOpenPlaylist={onOpenPlaylist}
								/>
							) : null}
						</PlayActions>
					}
				/>
			}
			toolbarLeading={
				<p className={styles.summary}>
					{library.isLoading
						? `Searching ${library.loaded.toLocaleString()} of ${library.total.toLocaleString()}...`
						: plural(search.matchCount, "match", "matches")}
				</p>
			}
		/>
	);
}
