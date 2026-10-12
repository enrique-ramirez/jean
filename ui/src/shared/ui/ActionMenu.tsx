import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Point } from "@/shared/hooks/useLongPress";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { ActionPopover } from "./ActionPopover";
import { ActionSheet } from "./ActionSheet";
import type { ActionNode, MenuHeader } from "./actionPanel";
import { SHEET_EXIT_MS } from "./BottomSheet";

const ACTION_MENU_KEYBOARD = "actionMenu";

export function ActionMenu({
	isOpen,
	anchor,
	header,
	actions,
	onDismiss,
}: {
	isOpen: boolean;
	anchor: Point | null;
	header?: MenuHeader | null;
	actions: ActionNode[];
	onDismiss: () => void;
}) {
	const isCompact = useIsCompactViewport();
	useKeyboardOwnership(ACTION_MENU_KEYBOARD, isOpen);

	const shown = useRef({ anchor, header, actions });
	if (isOpen) shown.current = { anchor, header, actions };

	const [isLeaving, setIsLeaving] = useState(false);
	const [wasOpen, setWasOpen] = useState(isOpen);

	if (wasOpen !== isOpen) {
		setWasOpen(isOpen);
		setIsLeaving(!isOpen && isCompact);
	}

	useEffect(() => {
		if (!isLeaving) return undefined;
		const timer = setTimeout(() => setIsLeaving(false), SHEET_EXIT_MS);
		return () => clearTimeout(timer);
	}, [isLeaving]);

	if (!isOpen && !isLeaving) return null;

	const view = shown.current;

	return createPortal(
		isCompact ? (
			<ActionSheet
				header={view.header}
				actions={view.actions}
				isLeaving={isLeaving}
				onDismiss={onDismiss}
			/>
		) : (
			<ActionPopover
				key={`${view.anchor?.x},${view.anchor?.y}`}
				anchor={view.anchor as Point}
				header={view.header}
				actions={view.actions}
				onDismiss={onDismiss}
			/>
		),
		document.body,
	);
}
