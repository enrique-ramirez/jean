import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Point } from "@/shared/hooks/useLongPress";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import {
	ACTION_MENU_KEYBOARD,
	useKeyboardOwnership,
} from "@/shared/keyboard/keyboardOwner";
import { ActionPopover } from "./ActionPopover";
import { ActionSheet } from "./ActionSheet";
import { SHEET_EXIT_MS } from "./BottomSheet";
import type { IconComponent } from "./icons";

export interface ActionEntry {
	type?: undefined;
	id: string;
	label: string;
	icon?: IconComponent;
	shortcut?: string;
	danger?: boolean;
	checked?: boolean;
	iconTone?: "accent";
	disabled?: boolean;
	onSelect?: () => void;
	keepOpen?: boolean;
	items?: ActionNode[];
	filter?: string;
}

export interface ActionSeparator {
	type: "separator";
	id?: string;
}

export interface ActionMessage {
	type: "message";
	text: string;
	id?: string;
}

export type ActionNode = ActionEntry | ActionSeparator | ActionMessage;

export interface MenuHeader {
	title: string;
	subtitle?: string | null;
	icon?: IconComponent;
}

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
