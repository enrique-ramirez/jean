import { useEffect, useState } from "react";

/** Whether to keep a layer mounted: while it is open, and for the length of its exit after it closes. Unmounting on the spot cuts the animation off; leaving it mounted leaves whatever it is running running. The caller's `exitMs` has to match its stylesheet, because it is timing that exit. */
export function usePresence(isOpen: boolean, exitMs: number) {
	// Derived during render rather than in an effect, which would leave one committed render where an opening layer is still absent — so its entrance has nothing to run on until the frame after.
	const [isLeaving, setIsLeaving] = useState(false);
	const [wasOpen, setWasOpen] = useState(isOpen);

	if (wasOpen !== isOpen) {
		setWasOpen(isOpen);
		setIsLeaving(!isOpen);
	}

	useEffect(() => {
		if (!isLeaving) return undefined;

		const timer = setTimeout(() => setIsLeaving(false), exitMs);
		return () => clearTimeout(timer);
	}, [isLeaving, exitMs]);

	return isOpen || isLeaving;
}
