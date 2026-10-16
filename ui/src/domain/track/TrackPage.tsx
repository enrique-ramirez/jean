import type { ReactNode, RefObject } from "react";
import { NO_WAIT, type Wait } from "@/domain/library/useOverdue";
import { useIsPlaying } from "@/domain/player/usePlayer";
import { useAvailableFields } from "./fieldAvailability";
import type { TrackBrowserHandle } from "./listTypes";
import { Mosaic } from "./Mosaic";
import { PlayActions } from "./PlayActions";
import type { TrackStats } from "./stats";
import { TrackBrowser, type TrackBrowserProps } from "./TrackBrowser";
import { ViewHeader } from "./ViewHeader";

export interface PageHeading {
	eyebrow?: ReactNode;
	title: ReactNode;
}

type TrackPageProps = Omit<
	TrackBrowserProps,
	"ref" | "isPlaying" | "header"
> & {
	browserRef: RefObject<TrackBrowserHandle | null>;
	heading?: PageHeading;
	stats: TrackStats | null;
	wait?: Wait;
	allGenresHref?: string;
	mosaicSeed: string;
	canPlaySets?: boolean;
	actions?: ReactNode;
};

export function TrackPage({
	browserRef,
	heading,
	stats,
	wait = NO_WAIT,
	allGenresHref,
	mosaicSeed,
	canPlaySets,
	actions,
	...browser
}: TrackPageProps) {
	const isPlaying = useIsPlaying();
	const { hasPlayCounts } = useAvailableFields();

	return (
		<TrackBrowser
			{...browser}
			ref={browserRef}
			isPlaying={isPlaying}
			header={
				heading ? (
					<ViewHeader
						eyebrow={heading.eyebrow}
						title={heading.title}
						stats={stats}
						isStatsPending={wait.isOverdue}
						hasPlayCounts={hasPlayCounts}
						allGenresHref={allGenresHref}
						aside={
							<Mosaic
								source={browser.source}
								rows={browser.rows}
								seed={mosaicSeed}
							/>
						}
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
				) : undefined
			}
		/>
	);
}
