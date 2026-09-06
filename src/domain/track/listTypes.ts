import type { PointerEvent as ReactPointerEvent } from "react";

import type { TrackColumns } from "@/shared/api/types";
import type { Column } from "./columns";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

export interface TrackRenderProps {
	rows: TrackColumns[];
	indices: Refs | null;
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
	align?: "start" | "center" | "end" | "auto";
	ifNeeded?: boolean;
}

export interface TrackListHandle {
	scrollToTrack: (index: number, options?: ScrollToTrackOptions) => void;
}

export interface TrackBrowserHandle extends TrackListHandle {
	play: (position: number) => void;
	preview: (position: number) => void;
}
