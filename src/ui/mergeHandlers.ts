// Composes several sets of React event props onto one element, running every
// handler registered for a name in the order given.
//
// Needed the moment two behaviours listen to the same element: a row that both
// opens a menu on press-and-hold and starts a drag shares four pointer
// handlers, and spreading one object after the other silently drops the first.
// Nothing warns about it -- the gesture just stops working.
// A bag of props on its way to being spread onto an element. Deliberately
// loose: these are assembled by the gesture hooks, merged here, then
// destructured and respread by their consumers, so pinning every key would mean
// restating four hooks' return shapes at every stop along the way -- and the
// element the bag lands on is what actually checks them.
// biome-ignore lint/suspicious/noExplicitAny: see above
export type PropBag = Record<string, any>;

type HandlerSet = PropBag;

export const mergeHandlers = (...sets: HandlerSet[]): HandlerSet =>
	sets.reduce(
		(merged, set) =>
			Object.entries(set).reduce<HandlerSet>((into, [name, handler]) => {
				const existing = into[name];
				return {
					...into,
					[name]:
						typeof existing === "function"
							? (event: unknown) => {
									existing(event);
									(handler as (event: unknown) => void)(event);
								}
							: handler,
				};
			}, merged),
		{} as HandlerSet,
	);
