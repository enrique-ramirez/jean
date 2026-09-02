// The listener half of a `useSyncExternalStore` store, which Jean has five of:
// toasts, the drag gesture, written ratings, the queue clock and the playlist
// loader. Each had its own `Set<() => void>`, its own `subscribe` returning its
// own deletion, and its own loop to notify -- five chances for one of them to
// leak a listener or forget to fire.
//
// Only the listeners. What each store *holds* is its own business, and there is
// no shape those five have in common.
export interface Subscribers {
	// Exactly what `useSyncExternalStore` wants for its first argument.
	subscribe: (listener: () => void) => () => void;
	notify: () => void;
	// So a store that owns a resource -- the queue clock's interval -- can start
	// it on the first subscriber and stop it after the last.
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
		// A copy, because a listener is free to unsubscribe from inside its own
		// notification and mutating the set mid-iteration would skip its neighbour.
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
