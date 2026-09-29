import type { ReactNode, RefObject } from "react";
import { useIsPlaying } from "@/domain/player/usePlayer";
import { useAvailableFields } from "./fieldAvailability";
import type { TrackBrowserHandle } from "./listTypes";
import { Mosaic } from "./Mosaic";
import { PlayActions } from "./PlayActions";
import type { TrackStats } from "./stats";
import { TrackBrowser, type TrackBrowserProps } from "./TrackBrowser";
import { ViewHeader } from "./ViewHeader";

type TrackPageProps = Omit<
	TrackBrowserProps,
	"ref" | "isPlaying" | "header"
> & {
	browserRef: RefObject<TrackBrowserHandle | null>;
	eyebrow?: ReactNode;
	title: ReactNode;
	tabs?: ReactNode;
	stats: TrackStats;
	allGenresHref?: string;
	mosaicSeed: string;
	canPlaySets?: boolean;
	actions?: ReactNode;
};

export function TrackPage({
	browserRef,
	eyebrow,
	title,
	tabs,
	stats,
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
				<ViewHeader
					eyebrow={eyebrow}
					title={title}
					tabs={tabs}
					stats={stats}
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
							canPlaySets={canPlaySets}
						>
							{actions}
						</PlayActions>
					}
				/>
			}
		/>
	);
}
