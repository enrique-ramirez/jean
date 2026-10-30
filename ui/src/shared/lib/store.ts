export interface Subscribers {
	subscribe: (listener: () => void) => () => void;
	notify: () => void;
	readonly size: number;
}

export function subscribers(): Subscribers {
	const listeners = new Set<() => void>();

	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		notify: () => {
			[...listeners].forEach((listener) => {
				listener();
			});
		},
		get size() {
			return listeners.size;
		},
	};
}

// The subscription of a store that is not there. A module constant rather than a closure
// written at the call: `useSyncExternalStore` tears down and reinstalls a subscription whose
// identity changed.
export const NO_SUBSCRIPTION = () => () => {};
