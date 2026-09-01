import { useCallback, useRef } from "react";

// Sends the first value immediately, then keeps only the newest while a request
// is in flight.
//
// One pointer gesture is ~40 moves. A debounce delays the first change, and you
// want to hear volume move as you drag; a request per event can complete out of
// order, so the value that lands last wins rather than the one sent last.
export function useCoalescedWrite<T>(write: (value: T) => unknown) {
	const writeRef = useRef(write);
	writeRef.current = write;

	const inFlight = useRef(false);
	const pending = useRef<T | null>(null);

	const flush = useCallback(async () => {
		if (inFlight.current || pending.current === null) return;

		const value = pending.current as T;
		pending.current = null;
		inFlight.current = true;

		try {
			await writeRef.current(value);
		} catch {
			// Leave the local value alone; the player's next push corrects it.
		} finally {
			inFlight.current = false;
			// Not guarded on being mounted: the queued value is the one the user finished
			// on, and a mounted flag reset in an effect cleanup is never restored by
			// StrictMode's remount, which would drop every coalesced write in development.
			flush();
		}
	}, []);

	return useCallback(
		(value: T) => {
			pending.current = value;
			flush();
		},
		[flush],
	);
}
