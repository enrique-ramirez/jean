// Composes several sets of React event props onto one element.
//
// Needed the moment two behaviours listen to the same element: a row that both
// opens a menu on press-and-hold and starts a drag shares four pointer handlers,
// and spreading one object after the other silently drops the first.
// Deliberately loose: these are assembled by the gesture hooks, merged, then
// destructured and respread, so pinning every key would restate four hooks'
// return shapes at every stop. The element they land on is what checks them.
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
