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

const SLICE_BUDGET_MS = 10;

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

// A message queued to a channel is delivered as a task of its own, with no clamp on how soon, which
// `setTimeout` has after a few nested calls; the browser may render or take input before it.
const nextTask = () =>
	new Promise<void>((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = () => {
			port1.close();
			resolve();
		};
		port2.postMessage(null);
	});

export async function inSlices<T>(
	steps: Steps<T>,
	signal: AbortSignal,
): Promise<T> {
	for (;;) {
		const started = performance.now();
		const done = advance(
			steps,
			() => performance.now() - started < SLICE_BUDGET_MS,
		);
		await nextTask();
		signal.throwIfAborted();
		if (done.isDone) return done.value;
	}
}
