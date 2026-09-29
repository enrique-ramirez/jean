import { useCallback, useEffect, useRef, useState } from "react";

export function useSearchBar(isSearchRoute: boolean, focus: () => void) {
	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		if (isSearchRoute) setIsOpen(true);
	}, [isSearchRoute]);

	// Focus follows only a deliberate reveal, never this effect: arriving at the results with the
	// field already open must not raise a software keyboard over them.
	const focusOnReveal = useRef(false);
	useEffect(() => {
		if (!isOpen || !focusOnReveal.current) return;
		focusOnReveal.current = false;
		focus();
	}, [isOpen, focus]);

	const reveal = useCallback(() => {
		focusOnReveal.current = true;
		setIsOpen(true);
	}, []);

	const close = useCallback(() => setIsOpen(false), []);

	return { isOpen, reveal, close };
}
