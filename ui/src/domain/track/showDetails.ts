import type { TrackAddress } from "@/shared/api/types";
import { createAsk } from "@/shared/lib/ask";

export interface DetailsTrack {
	addresses: TrackAddress[];
	title: string;
	artist: string;
	returnFocus: HTMLElement | null;
}

export interface DetailsAsked extends DetailsTrack {
	// A second ask for the same track is still a new opening, so the panel reads and focuses again.
	id: number;
}

const show = createAsk<DetailsAsked>();

let asks = 0;

export const askToShowDetails = (track: DetailsTrack) =>
	show.ask({ ...track, id: ++asks });

export const { answered: detailsShown, useAsked: useShowDetailsAsked } = show;
