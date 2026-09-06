import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Whether a `mouseenter` was earned by the pointer moving, as against the element under a stationary
 * pointer being replaced. A list drawn where the pointer already rests gets one on every open and
 * every keystroke, so acting on it hands the active row to wherever the mouse happens to be sitting.
 *
 * `results` re-arms the guard: pass whatever identity changes when the list is redrawn.
 */
export function useEarnedHover(results: unknown) {
	const moved = useRef(false);
	const lastSeen = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		const track = (event: MouseEvent) => {
			moved.current = true;
			lastSeen.current = { x: event.clientX, y: event.clientY };
		};
		window.addEventListener("mousemove", track);
		return () => window.removeEventListener("mousemove", track);
	}, []);

	// A layout effect, so the re-arming lands before the mouseenter that follows paint.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-arms the guard rather than being read here
	useLayoutEffect(() => {
		moved.current = false;
	}, [results]);

	// The flag covers the ordinary case; comparing coordinates covers the first move onto a result,
	// where mouseenter arrives before the mousemove that would have set it. That first enter has no
	// earlier position to compare against, so it is refused and its coordinates become the reference.
	return (event: { clientX: number; clientY: number }) => {
		if (moved.current) return true;
		const previous = lastSeen.current;
		lastSeen.current = { x: event.clientX, y: event.clientY };
		return (
			previous !== null &&
			(event.clientX !== previous.x || event.clientY !== previous.y)
		);
	};
}
