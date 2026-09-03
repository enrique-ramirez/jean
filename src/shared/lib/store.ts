// The listener half of a useSyncExternalStore store. Only the listeners: what each store holds is its own business.
export interface Subscribers {
	subscribe: (listener: () => void) => () => void;
	notify: () => void;
	// So a store that owns a resource can start it on the first subscriber and stop it after the last.
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
		// A copy, because a listener is free to unsubscribe from inside its own notification and mutating the set mid-iteration would skip its neighbour.
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
