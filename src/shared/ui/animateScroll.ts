import { clamp } from "@/shared/lib/math";

const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// Native behavior: 'smooth' has a browser-decided duration that grows with distance, so a jump across a library-sized list crawls for seconds.
// getTarget is re-read every frame rather than captured, because rows measured during the flight move where the destination actually sits.

// A wheel event is not by itself a decision: trackpad and mouse momentum keep emitting for a second after the fingers leave, and a decaying tail never passes this while deliberate scrolling does so in one or two events.
const CANCEL_DELTA_PX = 40;

export function animateScrollTo(
	element: HTMLElement,
	getTarget: () => number | null | undefined,
	{ minMs = 240, maxMs = 700 }: { minMs?: number; maxMs?: number } = {},
) {
	const from = element.scrollTop;
	const initialTarget = getTarget();
	if (initialTarget == null) return () => {};

	const duration = clamp(Math.abs(initialTarget - from) / 8, minMs, maxMs);
	const started = performance.now();

	let frame = 0;
	let cancelled = false;

	let wheeled = 0;

	const onWheel = (event: WheelEvent) => {
		wheeled += Math.abs(event.deltaY);
		if (wheeled >= CANCEL_DELTA_PX) cancel();
	};

	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		if (frame) cancelAnimationFrame(frame);
		element.removeEventListener("wheel", onWheel);
		element.removeEventListener("touchstart", cancel);
	};

	const step = (now: number) => {
		if (cancelled) return;
		const progress = clamp((now - started) / duration, 0, 1);
		const target = getTarget() ?? initialTarget;

		element.scrollTop = from + (target - from) * easeInOutCubic(progress);

		if (progress < 1) frame = requestAnimationFrame(step);
		else cancel();
	};

	// A touch is unambiguous where a wheel event is not, so only touch cancels on its own.
	element.addEventListener("wheel", onWheel, { passive: true });
	element.addEventListener("touchstart", cancel, { passive: true });
	frame = requestAnimationFrame(step);

	return cancel;
}
