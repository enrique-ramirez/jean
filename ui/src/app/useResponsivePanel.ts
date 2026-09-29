import { useCallback, useState } from "react";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { type Panel, SURFACES } from "./surfaces";

export function useResponsivePanel(panel: Panel) {
	const { dockedKey, docked: dockedByDefault } = SURFACES[panel];
	const isCompactViewport = useIsCompactViewport();
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [isDocked, setIsDocked] = useStoredState<boolean>(
		dockedKey,
		dockedByDefault,
	);

	const isOpen = isCompactViewport ? isDrawerOpen : isDocked;

	const setOpen = useCallback(
		(open: boolean) => {
			if (isCompactViewport) setIsDrawerOpen(open);
			else setIsDocked(open);
		},
		[isCompactViewport, setIsDocked],
	);

	const toggle = useCallback(() => setOpen(!isOpen), [setOpen, isOpen]);

	const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

	return {
		isOpen,
		isDrawerOpen: isCompactViewport && isDrawerOpen,
		isCollapsed: !isCompactViewport && !isDocked,
		setOpen,
		toggle,
		closeDrawer,
	};
}
