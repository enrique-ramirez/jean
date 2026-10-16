import type { PointerEvent as ReactPointerEvent } from "react";

import type { Column } from "./columns";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";

export interface TrackRenderProps {
	rows: TrackRows;
	source: LibrarySource;
	columns: Column[];
	template: string;
	heat: Float32Array;
	patina: Float32Array;
	activeIndex: number;
	isPlaying: boolean;
	cursor: number;
	selection: Set<number>;
	matches: Set<number> | null;
	onSelect: (index: number, event: ReactPointerEvent) => void;
	isCompactViewport: boolean;
}

export type ActiveDirection = "up" | "down" | null;

export interface ScrollToTrackOptions {
	animate?: boolean;
	align?: "center" | "auto";
	ifNeeded?: boolean;
}

export interface TrackListHandle {
	scrollToTrack: (index: number, options?: ScrollToTrackOptions) => void;
	whenRowMounted: (index: number, run: (row: HTMLElement) => void) => void;
}

export interface TrackBrowserHandle
	extends Pick<TrackListHandle, "scrollToTrack"> {
	play: (position: number) => void;
	preview: (position: number) => void;
}

export const ROW_HEIGHT = 46;
