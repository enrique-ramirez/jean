import { type RefObject, useLayoutEffect, useRef } from "react";

import type { SessionOutcome } from "@/domain/player/sessionOperations";

export const TAKES_FOCUS = "[data-takes-focus]";

type FocusAfter = "ifLost" | { awayFrom: string | null };

export function useFocusAfterPress(
	groupRef: RefObject<HTMLElement | null>,
	isOn: boolean,
	sessionId: string | null,
) {
	const focusAfter = useRef<FocusAfter | null>(null);

	const swapByPress = (act: () => void) => {
		focusAfter.current = "ifLost";
		act();
	};

	const moveByPress = (act: () => Promise<SessionOutcome>) => {
		const awaiting = { awayFrom: sessionId };
		focusAfter.current = awaiting;
		void act().then((outcome) => {
			const isStillAwaited = focusAfter.current === awaiting;
			if (!outcome.ok && outcome.reason !== "pending" && isStillAwaited)
				focusAfter.current = null;
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isOn` fires this rather than being read in it.
	useLayoutEffect(() => {
		const after = focusAfter.current;
		if (after === null) return;
		if (after !== "ifLost" && after.awayFrom === sessionId) return;
		focusAfter.current = null;
		if (after === "ifLost" && document.activeElement !== document.body) return;
		groupRef.current
			?.querySelector<HTMLElement>(TAKES_FOCUS)
			?.focus({ preventScroll: true });
	}, [isOn, sessionId]);

	return { swapByPress, moveByPress };
}
