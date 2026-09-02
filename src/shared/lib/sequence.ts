// Await a list of asynchronous steps one after the next.
//
// Jean has a surprising amount of genuinely sequential work -- the player
// renumbers the play queue on every removal, only the first chunk of a fill may
// replace, and `Promise.all` over any of it arrives in whatever order the
// network settles on. That was five hand-written `for ... await` loops and one
// `reduce` chain, in five files, plus a sixth copy in the test fixtures.
export const inSequence = <T>(
	items: readonly T[],
	run: (item: T, index: number) => unknown,
): Promise<unknown> =>
	items.reduce<Promise<unknown>>(
		// Returned, never discarded: `void run(...)` here still calls each step in
		// turn and then hands `undefined` to `then`, so nothing waits for any of
		// them and the whole point is quietly lost.
		(done, item, index) => done.then(() => run(item, index)),
		Promise.resolve(),
	);

// The same, over a count. `descending` because that is the shape every one of
// these has: removing by index renumbers everything after it, so a range comes
// off from the top.
export const descending = (from: number, to: number): number[] =>
	Array.from({ length: Math.max(0, from - to + 1) }, (_, at) => from - at);
