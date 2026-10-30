import { advance, type Steps } from "../../src/shared/lib/idle.ts";

const SLICE_BUDGET_MS = 10;

// A message queued to a channel is delivered as a task of its own, with no clamp on how soon, which
// `setTimeout` has after a few nested calls; the event loop may take other work before it.
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
