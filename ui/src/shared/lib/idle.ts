const SLICE_MS = 8;
const GAP_MS = 50;

// Safari ships `requestIdleCallback` disabled, so there a short timeout and a fixed slice stand in for it.
export function workWhenIdle(
	step: (hasTime: () => boolean) => boolean,
): () => void {
	let cancelled = false;
	let cancel = () => {};

	const run = (deadline?: IdleDeadline) => {
		if (cancelled) return;
		const started = performance.now();
		const hasTime = deadline
			? () => deadline.timeRemaining() > 1
			: () => performance.now() - started < SLICE_MS;
		if (!step(hasTime)) schedule();
	};

	const schedule = () => {
		if (typeof requestIdleCallback === "function") {
			const handle = requestIdleCallback(run);
			cancel = () => cancelIdleCallback(handle);
		} else {
			const handle = setTimeout(run, GAP_MS);
			cancel = () => clearTimeout(handle);
		}
	};

	schedule();
	return () => {
		cancelled = true;
		cancel();
	};
}

export type Steps<T> = Generator<void, T, void>;

export const SLICE_ROWS = 1024;

export const SLICE_MASK = SLICE_ROWS - 1;

export function finished<T>(steps: Steps<T>): T {
	for (;;) {
		const next = steps.next();
		if (next.done) return next.value;
	}
}

export function advance<T>(
	steps: Steps<T>,
	hasTime: () => boolean,
): { isDone: true; value: T } | { isDone: false } {
	do {
		const next = steps.next();
		if (next.done) return { isDone: true, value: next.value };
	} while (hasTime());
	return { isDone: false };
}
