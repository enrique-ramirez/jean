import { useSyncExternalStore } from "react";
import { NO_SUBSCRIPTION } from "@/shared/lib/store";

export interface Store<T> {
	subscribe: (listener: () => void) => () => void;
	state: () => T;
}

export function useStoreOr<T>(store: Store<T> | null, empty: T): T {
	return useSyncExternalStore(
		store ? store.subscribe : NO_SUBSCRIPTION,
		store ? store.state : () => empty,
	);
}
