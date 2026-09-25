import { useCallback, useRef } from "react";

// A request per pointer move can complete out of order, so the value that lands last would win
// rather than the one sent last.
export function useCoalescedWrite<T>(
	write: (value: T) => unknown,
	onError?: (error: unknown) => void,
) {
	const writeRef = useRef(write);
	writeRef.current = write;
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

	const inFlight = useRef(false);
	const pending = useRef<T | null>(null);

	const flush = useCallback(async () => {
		if (inFlight.current || pending.current === null) return;

		const value = pending.current as T;
		pending.current = null;
		inFlight.current = true;

		try {
			await writeRef.current(value);
		} catch (error) {
			// Leave the local value alone; the player's next push corrects it.
			onErrorRef.current?.(error);
		} finally {
			inFlight.current = false;
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
