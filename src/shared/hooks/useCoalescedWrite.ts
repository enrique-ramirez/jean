import { useCallback, useRef } from "react";

// A request per pointer move can complete out of order, so the value that lands last would win
// rather than the one sent last.
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
			// Not guarded on being mounted: a flag reset in an effect cleanup is never set back by
			// StrictMode's remount, so the guard would be permanently on in development.
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
