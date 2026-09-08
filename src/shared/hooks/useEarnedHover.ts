import { useEffect, useLayoutEffect, useRef } from "react";

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-arms the guard rather than being read here
	useLayoutEffect(() => {
		moved.current = false;
	}, [results]);

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
