import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// A live search mints a key per query, so the map is capped rather than left to grow for the life of the tab.
const MAX_REMEMBERED = 50;

// Rows stream in a chunk at a time, so the content is often too short to hold the offset at the moment the view is restored.
const RESTORE_FRAMES = 60;

// The app has exactly one scroll container, so remembering where each view was left is one listener and a map.
export function useScrollMemory(
	scrollRef: RefObject<HTMLElement | null>,
	viewKey: string,
	// Off for a view being opened to be taken somewhere in particular: where it was last left is not what was asked for, and the two would fight for as long as rows keep arriving -- the restore re-forces its offset on every frame that grows the list.
	{ restore = true }: { restore?: boolean } = {},
) {
	const offsets = useRef(new Map<string, number>());
	const activeKey = useRef(viewKey);

	// Through a ref: this describes the view change rather than the render, and as a dependency the restore would re-run the moment it went back to true and undo the scroll it stood aside for.
	const restoring = useRef(restore);
	restoring.current = restore;

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return undefined;

		const onScroll = () => {
			const key = activeKey.current;
			if (!key) return;
			offsets.current.set(key, element.scrollTop);
			if (offsets.current.size > MAX_REMEMBERED) {
				offsets.current.delete(offsets.current.keys().next().value as string);
			}
		};

		element.addEventListener("scroll", onScroll, { passive: true });
		return () => element.removeEventListener("scroll", onScroll);
	}, [scrollRef]);

	useLayoutEffect(() => {
		activeKey.current = viewKey;

		const element = scrollRef.current;
		if (!element) return undefined;

		// The top, rather than the offset held for the view being left: what is asked for next may take a moment to arrive.
		if (!restoring.current) {
			element.scrollTop = 0;
			return undefined;
		}

		const target = offsets.current.get(viewKey) ?? 0;
		element.scrollTop = target;
		if (target === 0) return undefined;

		let frame = 0;
		let lastHeight = 0;
		let handle = requestAnimationFrame(function step() {
			// A fractional scrollTop from a trackpad never compares equal, hence the rounding.
			if (Math.abs(element.scrollTop - target) < 1 || frame >= RESTORE_FRAMES)
				return;

			// Nothing new arrived to make room, so the offset is past the end of a view that will not grow, and forcing it every frame would fight the user.
			const height = element.scrollHeight;
			if (frame > 0 && height === lastHeight) return;

			lastHeight = height;
			element.scrollTop = target;
			frame += 1;
			handle = requestAnimationFrame(step);
		});

		const surrender = () => {
			cancelAnimationFrame(handle);
			frame = RESTORE_FRAMES;
		};

		element.addEventListener("wheel", surrender, { passive: true, once: true });
		element.addEventListener("touchstart", surrender, {
			passive: true,
			once: true,
		});

		return () => {
			cancelAnimationFrame(handle);
			element.removeEventListener("wheel", surrender);
			element.removeEventListener("touchstart", surrender);
		};
	}, [scrollRef, viewKey]);
}
