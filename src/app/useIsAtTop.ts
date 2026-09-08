import { type RefObject, useEffect, useState } from "react";

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
