// Composes several sets of React event props onto one element: two behaviours on one element share pointer handlers, and spreading one object after the other silently drops the first.
// Deliberately loose: these are assembled by the gesture hooks, merged, then destructured and respread, so pinning every key would restate four hooks' return shapes at every stop.
// biome-ignore lint/suspicious/noExplicitAny: see above
export type PropBag = Record<string, any>;

type Handler = (event: unknown) => void;

// Functions under one name are called in the order they were given; anything else is last-wins, as a plain spread would be.
export const mergeHandlers = (...sets: PropBag[]): PropBag =>
	Object.fromEntries(
		[...new Set(sets.flatMap((set) => Object.keys(set)))].map((name) => {
			const values = sets.filter((set) => name in set).map((set) => set[name]);
			const handlers = values.filter(
				(value): value is Handler => typeof value === "function",
			);

			return [
				name,
				handlers.length > 1
					? (event: unknown) => {
							handlers.forEach((handler) => {
								handler(event);
							});
						}
					: values[values.length - 1],
			];
		}),
	);
