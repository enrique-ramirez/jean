import type { ReactNode, RefObject } from "react";
import { NO_WAIT, type Wait } from "@/domain/library/useOverdue";
import { useIsPlaying } from "@/domain/player/usePlayer";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useAvailableFields } from "./fieldAvailability";
import { coverIdentity, FIELD, value } from "./fields";
import { LibraryCards } from "./LibraryCards";
import type { TrackBrowserHandle } from "./listTypes";
import { PlayActions } from "./PlayActions";
import type { TrackStats } from "./stats";
import { TrackBrowser, type TrackBrowserProps } from "./TrackBrowser";
import { ViewHeader } from "./ViewHeader";

export interface PageHeading {
	eyebrow?: ReactNode;
	title: ReactNode;
	showsCover?: boolean;
}

type TrackPageProps = Omit<
	TrackBrowserProps,
	"ref" | "isPlaying" | "header"
> & {
	browserRef: RefObject<TrackBrowserHandle | null>;
	heading?: PageHeading;
	stats: TrackStats | null;
	wait?: Wait;
	mosaicSeed: string;
	canPlaySets?: boolean;
	actions?: ReactNode;
	countsGenres?: boolean;
	allGenresHref?: string;
};

export function TrackPage({
	browserRef,
	heading,
	stats,
	wait = NO_WAIT,
	mosaicSeed,
	canPlaySets,
	actions,
	countsGenres = true,
	allGenresHref,
	...browser
}: TrackPageProps) {
	const isPlaying = useIsPlaying();
	const { hasPlayCounts } = useAvailableFields();
	const t = useTranslate();
	const { source, rows } = browser;
	const first = heading?.showsCover && rows.length > 0 ? rows.at(0) : null;
	const cover = first
		? {
				src: source.artworkUrl(rows.ref(0)),
				identity: coverIdentity(first),
				alt: t("album.coverAlt", { album: value(first, FIELD.album) ?? "" }),
			}
		: undefined;

	return (
		<TrackBrowser
			{...browser}
			ref={browserRef}
			isPlaying={isPlaying}
			header={
				<>
					{heading ? (
						<ViewHeader
							eyebrow={heading.eyebrow}
							title={heading.title}
							stats={stats}
							isStatsPending={wait.isOverdue}
							cover={cover}
							covers={{
								source: browser.source,
								rows: browser.rows,
								seed: mosaicSeed,
							}}
							actions={
								<PlayActions
									browserRef={browserRef}
									trackCount={browser.rows.length}
									wait={wait}
									canPlaySets={canPlaySets}
								>
									{actions}
								</PlayActions>
							}
						/>
					) : null}
					<LibraryCards
						stats={stats}
						rows={browser.rows}
						hasPlayCounts={hasPlayCounts}
						countsGenres={countsGenres}
						allGenresHref={allGenresHref}
						isOverdue={wait.isOverdue}
					/>
				</>
			}
		/>
	);
}
