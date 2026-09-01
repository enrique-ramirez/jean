import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// A live search mints a key per query, so this is bounded rather than growing
// for the life of the tab. Offsets are numbers; the cap is about hygiene.
const MAX_REMEMBERED = 50;

// Rows stream in a chunk at a time, so the content is often too short to hold
// the offset at the moment the view is restored. Keep trying for about a
// second, and stop the instant the user takes over.
const RESTORE_FRAMES = 60;

// The app has exactly one scroll container, so remembering where each view was
// left is one listener and a map. Navigating to a search and back has to return
// you to the row you were reading, not to the top of thirty thousand.
export function useScrollMemory(
	scrollRef: RefObject<HTMLElement | null>,
	viewKey: string,
) {
	const offsets = useRef(new Map<string, number>());
	const activeKey = useRef(viewKey);

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

		const target = offsets.current.get(viewKey) ?? 0;
		element.scrollTop = target;
		if (target === 0) return undefined;

		let frame = 0;
		let lastHeight = 0;
		let handle = requestAnimationFrame(function step() {
			// Rounding: a fractional scrollTop from a trackpad never compares equal.
			if (Math.abs(element.scrollTop - target) < 1 || frame >= RESTORE_FRAMES)
				return;

			// Nothing new arrived to make room, so the view is as tall as it is going
			// to get and the offset is simply past its end. Forcing it every frame
			// from here would fight the user for a second over a row that no longer
			// exists.
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
