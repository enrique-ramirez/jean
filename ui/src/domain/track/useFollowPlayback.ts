import { useEffect, useRef } from "react";
import {
	useCursorFollowsPlayback,
	usePlaybackFollowsCursor,
} from "./followSettings";
import { jumpAnswered, useJumpAsked } from "./jumpToPlaying";
import type { ScrollToTrackOptions } from "./listTypes";

export function useFollowPlayback({
	rowCount,
	viewKey,
	activeIndex,
	canFollowPlayback,
	cursor,
	play,
	moveCursorTo,
	scrollToTrack,
}: {
	rowCount: number;
	viewKey: string;
	activeIndex: number;
	canFollowPlayback: boolean;
	cursor: number;
	play: (position: number) => void;
	moveCursorTo: (position: number) => void;
	scrollToTrack: (position: number, options?: ScrollToTrackOptions) => void;
}) {
	const [cursorFollowsPlayback] = useCursorFollowsPlayback();
	const [playbackFollowsCursor] = usePlaybackFollowsCursor();

	const jumpAsked = useJumpAsked();
	useEffect(() => {
		if (!jumpAsked) return;
		if (activeIndex < 0 || activeIndex >= rowCount) return;
		jumpAnswered();
		moveCursorTo(activeIndex);
		scrollToTrack(activeIndex, {
			align: "center",
			animate: jumpAsked.animate,
		});
	}, [jumpAsked, activeIndex, rowCount, moveCursorTo, scrollToTrack]);

	const cursorAt = useRef(cursor);
	cursorAt.current = cursor;

	const followedIndex = useRef(-1);
	const followedView = useRef<string | null>(null);

	useEffect(() => {
		if (!canFollowPlayback) return;
		if (activeIndex < 0 || activeIndex >= rowCount) return;

		const arrived = followedView.current !== viewKey;
		followedView.current = viewKey;
		if (!arrived && followedIndex.current === activeIndex) return;

		const wasPlaying = followedIndex.current;
		followedIndex.current = activeIndex;

		// Must run before the cursor moves below, or there is nothing left to compare. Excluding
		// `wasPlaying` stops the two follow settings looping, since with both on the cursor sits on the
		// track that just ended; excluding `arrived` stops navigation reading as a track change.
		const at = cursorAt.current;
		if (
			playbackFollowsCursor &&
			!arrived &&
			at !== activeIndex &&
			at !== wasPlaying &&
			at >= 0 &&
			at < rowCount
		) {
			play(at);
			return;
		}

		if (!cursorFollowsPlayback) return;
		moveCursorTo(activeIndex);

		scrollToTrack(activeIndex, {
			align: "center",
			animate: true,
			ifNeeded: true,
		});
	}, [
		activeIndex,
		rowCount,
		viewKey,
		canFollowPlayback,
		cursorFollowsPlayback,
		playbackFollowsCursor,
		play,
		moveCursorTo,
		scrollToTrack,
	]);
}
