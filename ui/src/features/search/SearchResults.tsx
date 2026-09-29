import { Search } from "lucide-react";
import type { RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import { isLibraryReading } from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { useViewPlayback } from "@/domain/library/useViewPlayback";
import { useIsPlaying } from "@/domain/player/usePlayer";
import { useAvailableFields } from "@/domain/track/fieldAvailability";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { TrackBrowserHandle } from "@/domain/track/listTypes";
import { Mosaic } from "@/domain/track/Mosaic";
import { PlayActions } from "@/domain/track/PlayActions";
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { SavePlaylistButton } from "./SavePlaylistButton";
import styles from "./SearchResults.module.css";

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
	const t = useTranslate();
	const browserRef = useRef<TrackBrowserHandle | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const isPlaying = useIsPlaying();
	const { discovery } = useFooJean();
	const canWritePlaylists = permitsPlaylistWrites(discovery);

	const results = search.results;
	const { indices, heat, patina, playedCount } = results;
	const { hasPlayCounts } = useAvailableFields();
	const stats = useMemo(
		() => summarise(results, playedCount),
		[results, playedCount],
	);

	const { playAt, activeIndex, scratch, holdsThisView, canPlaySets } =
		useViewPlayback({
			library,
			playlists,
			kind: SCRATCH_KIND.search,
			label: search.query,
			indices,
		});

	useKeymap(
		SCOPE.search,
		{ saveSearch: () => setIsSaving(true) },
		{ enabled: canWritePlaylists && results.length > 0 && !library.isLoading },
	);

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);
	const readingText =
		status.kind === "reading" && status.loaded > 0
			? t("search.reading", { loaded: status.loaded, total: status.total })
			: t("library.reading");

	if (!search.hasQuery) {
		return (
			<div className={styles.idle}>
				<Search size={26} strokeWidth={1.5} aria-hidden="true" />
				<h1 className={styles.idleTitle}>{t("search.yourLibrary")}</h1>
				<p className={styles.idleBody}>
					{t("search.idle", { count: library.total })}
				</p>
				<Button variant="primary" icon={Search} onClick={search.focus}>
					{t("search.startTyping")}
				</Button>
			</div>
		);
	}

	return (
		<TrackBrowser
			ref={browserRef}
			rows={results}
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
			onOpenFinder={search.focus}
			emptyNotice={t("search.noMatch")}
			loadingNotice={isReading ? "" : undefined}
			progressLabel={isReading ? readingText : undefined}
			header={
				<ViewHeader
					eyebrow={t("search.resultsEyebrow")}
					title={search.query}
					stats={stats}
					hasPlayCounts={hasPlayCounts}
					aside={
						<Mosaic
							source={library.source}
							rows={results}
							seed={search.viewKey}
						/>
					}
					actions={
						<PlayActions
							browserRef={browserRef}
							trackCount={results.length}
							canPlaySets={canPlaySets}
						>
							<SavePlaylistButton
								search={search}
								library={library}
								scratch={scratch}
								holdsResults={holdsThisView}
								canWritePlaylists={canWritePlaylists}
								isOpen={isSaving}
								onOpenChange={setIsSaving}
								onOpenPlaylist={onOpenPlaylist}
							/>
						</PlayActions>
					}
				/>
			}
			toolbarLeading={
				<p className={styles.summary}>
					{isReading
						? readingText
						: t("search.matchCount", { count: search.matchCount })}
				</p>
			}
		/>
	);
}
