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
