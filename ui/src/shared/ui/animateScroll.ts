import { clamp } from "@/shared/lib/math";

const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// `scroll-behavior: smooth` takes a browser-decided duration that grows with distance, so a jump
// across a long list crawls. `getTarget` is re-read every frame rather than captured, because rows
// measured during the flight move where the destination sits.

// Trackpad and mouse momentum keep emitting wheel events after the fingers leave, so one event is
// not a decision; a decaying tail never reaches this and deliberate scrolling does at once.
const CANCEL_DELTA_PX = 40;

const prefersReducedMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function animateScrollTo(
	element: HTMLElement,
	getTarget: () => number | null | undefined,
	{ minMs = 240, maxMs = 700 }: { minMs?: number; maxMs?: number } = {},
) {
	const from = element.scrollTop;
	const initialTarget = getTarget();
	if (initialTarget == null) return () => {};
	if (prefersReducedMotion()) {
		element.scrollTop = initialTarget;
		return () => {};
	}

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

	element.addEventListener("wheel", onWheel, { passive: true });
	element.addEventListener("touchstart", cancel, { passive: true });
	frame = requestAnimationFrame(step);

	return cancel;
}
