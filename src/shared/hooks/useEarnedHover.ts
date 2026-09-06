import { useEffect, useLayoutEffect, useRef } from "react";

// Tells a `mouseenter` earned by the pointer moving from one raised by the element under a stationary
// pointer being replaced. `results` re-arms the guard: pass whatever identity changes on a redraw.
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

	// The coordinates are the second half, not spare: on the first move onto a result `mouseenter`
	// arrives before the `mousemove` that would have set the flag.
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
