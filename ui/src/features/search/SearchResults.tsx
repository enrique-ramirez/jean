import { Search } from "lucide-react";
import type { RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { LibrarySetup } from "@/domain/library/LibrarySetup";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
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
import { summarise } from "@/domain/track/stats";
import { TrackBrowser } from "@/domain/track/TrackBrowser";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { ViewHeader } from "@/domain/track/ViewHeader";
import type { PlaylistInfo } from "@/shared/api/types";
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
	const canSavePlaylists = canChangePlaylists(usePermissions());

	const results = search.results;
	const { indices, heat, patina, playedCount } = results;
	const { hasPlayCounts } = useAvailableFields(results.columns);
	const stats = useMemo(
		() => summarise(results, playedCount),
		[results, playedCount],
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
		{ enabled: canSavePlaylists && results.length > 0 && !library.isLoading },
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
				<h1 className={styles.idleTitle}>{t("search.yourLibrary")}</h1>
				<p className={styles.idleBody}>
					{t("search.idle", { count: library.count })}
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
						? t("search.reading", {
								loaded: library.loaded,
								total: library.total,
							})
						: t("search.matchCount", { count: search.matchCount })}
				</p>
			}
		/>
	);
}
