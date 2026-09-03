// Await a list of asynchronous steps one after the next, where Promise.all would arrive in whatever order the network settles on.
export const inSequence = <T>(
	items: readonly T[],
	run: (item: T, index: number) => unknown,
): Promise<unknown> =>
	items.reduce<Promise<unknown>>(
		// Returned, never discarded: void run(...) here still calls each step in turn and then hands undefined to then, so nothing waits for any of them.
		(done, item, index) => done.then(() => run(item, index)),
		Promise.resolve(),
	);

// The same, over a count. Removing by index renumbers everything after it, so a range comes off from the top.
export const descending = (from: number, to: number): number[] =>
	Array.from({ length: Math.max(0, from - to + 1) }, (_, at) => from - at);
