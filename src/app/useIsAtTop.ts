import { type RefObject, useEffect, useState } from "react";

// A write to scrollTop from outside -- a caller resetting it on its own state change --
// still fires this listener, so nothing besides the ref belongs in the dependency array.
// React bails out on an unchanged value, so this only costs a render at the crossing.
export function useIsAtTop(scrollRef: RefObject<HTMLElement | null>) {
	const [isAtTop, setIsAtTop] = useState(true);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return undefined;

		const read = () => setIsAtTop(scroller.scrollTop <= 0);
		read();
		scroller.addEventListener("scroll", read, { passive: true });
		return () => scroller.removeEventListener("scroll", read);
	}, [scrollRef]);

	return isAtTop;
}
