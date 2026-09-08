import { useEffect, useState } from "react";

export function usePresence(isOpen: boolean, exitMs: number) {
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
