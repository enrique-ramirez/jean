import type { PointerEvent as ReactPointerEvent } from "react";

import type { TrackColumns } from "@/shared/api/types";
import type { Column } from "./columns";
import type { LibrarySource } from "./librarySource";
import type { Refs } from "./project";

// `indices` is the seam showing through where it has to: a row's place in the view is not the ref the source addresses it by, and null means they are the same.
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

// Which way the playing track lies relative to the viewport, or null when it is on screen.
export type ActiveDirection = "up" | "down" | null;

// Matches the virtualiser's own alignment vocabulary, because that is where these end up.
export interface ScrollToTrackOptions {
	animate?: boolean;
	align?: "start" | "center" | "end" | "auto";
	ifNeeded?: boolean;
}

// Scrolling is by track index even in album mode, where the virtualiser's own items are groups.
export interface TrackListHandle {
	scrollToTrack: (index: number, options?: ScrollToTrackOptions) => void;
}

export interface TrackBrowserHandle extends TrackListHandle {
	play: (position: number) => void;
	preview: (position: number) => void;
}
