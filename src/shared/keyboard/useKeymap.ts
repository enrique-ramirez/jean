import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo, useRef } from "react";

import { useKeyboardOwner } from "./keyboardOwner";
import { KEYMAP } from "./keymap";

// A binding's handler. The event and the manager's context are passed through so a handler that needs to preventDefault can.
type HotkeyHandler = (event: KeyboardEvent, context: unknown) => void;

// Registers every binding declared for scope that has a matching handler.
// Handlers live in a ref so the definition array stays stable across renders while callbacks always see current state; handledIds is the memo's dependency for the same reason, since a fresh handlers object every render would re-register every binding every time.
export function useKeymap(
	scope: string,
	handlers: Record<string, HotkeyHandler | undefined>,
	{ enabled = true, owner }: { enabled?: boolean; owner?: string } = {},
) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	// While an overlay holds the keyboard, only registrations naming it survive.
	const keyboardOwner = useKeyboardOwner();
	const live = enabled && (keyboardOwner === null || keyboardOwner === owner);

	const handledIds = Object.keys(handlers).sort().join(",");

	const definitions = useMemo(() => {
		const handled = new Set(handledIds.split(","));

		return KEYMAP.filter(
			(binding) => binding.scope === scope && handled.has(binding.id),
		).flatMap((binding) =>
			binding.keys.map((hotkey) => ({
				hotkey,
				callback: (event: KeyboardEvent, context: unknown) =>
					handlersRef.current[binding.id]?.(event, context),
				options: {
					...binding.options,
					enabled: live,
					meta: { name: binding.name, group: binding.group },
				},
			})),
		);
	}, [scope, handledIds, live]);

	useHotkeys(definitions);
}
