import {
	type RefObject,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
} from "react";

const MAX_REMEMBERED = 50;

const RESTORE_FRAMES = 60;

export function useScrollMemory(
	scrollRef: RefObject<HTMLElement | null>,
	viewKey: string,
	{ restore = true }: { restore?: boolean } = {},
) {
	const offsets = useRef(new Map<string, number>());
	const activeKey = useRef(viewKey);

	const isRestoring = useEffectEvent(() => restore);

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

		if (!isRestoring()) {
			element.scrollTop = 0;
			return undefined;
		}

		const target = offsets.current.get(viewKey) ?? 0;
		element.scrollTop = target;
		if (target === 0) return undefined;

		let frame = 0;
		let lastHeight = 0;
		let handle = requestAnimationFrame(function step() {
			// A fractional scrollTop from a trackpad never compares equal, hence the tolerance.
			if (Math.abs(element.scrollTop - target) < 1 || frame >= RESTORE_FRAMES)
				return;

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
