// Two behaviours on one element share pointer handlers, and spreading one prop object after the
// other silently drops the first.
// biome-ignore lint/suspicious/noExplicitAny: these bags are assembled by the gesture hooks, merged, destructured and respread, so pinning every key would restate four hooks' return shapes at every stop
export type PropBag = Record<string, any>;

type Handler = (event: unknown) => void;

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
