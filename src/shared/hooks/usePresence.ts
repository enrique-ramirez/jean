import { useEffect, useState } from "react";

/** Whether to keep a layer mounted: while it is open, and for the length of its exit after it closes. Unmounting on the spot cuts the animation off; leaving it mounted leaves whatever it is running running. The caller's `exitMs` has to match its stylesheet, because it is timing that exit. */
export function usePresence(isOpen: boolean, exitMs: number) {
	const [isPresent, setIsPresent] = useState(isOpen);

	useEffect(() => {
		if (isOpen) {
			setIsPresent(true);
			return undefined;
		}

		const timer = setTimeout(() => setIsPresent(false), exitMs);
		return () => clearTimeout(timer);
	}, [isOpen, exitMs]);

	return isPresent;
}
