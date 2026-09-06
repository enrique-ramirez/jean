import { useEffect, useState } from "react";

// Keeps a layer mounted for the length of its exit. `exitMs` has to match the caller's stylesheet.
export function usePresence(isOpen: boolean, exitMs: number) {
	// Derived during render rather than in an effect, which would leave one committed render where an
	// opening layer is still absent and its entrance nothing to run on.
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
