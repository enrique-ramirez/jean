export const inSequence = <T>(
	items: readonly T[],
	run: (item: T, index: number) => unknown,
): Promise<unknown> =>
	items.reduce<Promise<unknown>>(
		(done, item, index) => done.then(() => run(item, index)),
		Promise.resolve(),
	);

// Removing by index renumbers everything after it, so a range has to come off from the top.
export const descending = (from: number, to: number): number[] =>
	Array.from({ length: Math.max(0, from - to + 1) }, (_, at) => from - at);
