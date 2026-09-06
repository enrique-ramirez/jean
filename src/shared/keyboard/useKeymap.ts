import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo, useRef } from "react";

import { useKeyboardOwner } from "./keyboardOwner";
import { KEYMAP } from "./keymap";

type HotkeyHandler = (event: KeyboardEvent, context: unknown) => void;

// `handledIds` is the memo's dependency rather than `handlers`, which is a fresh object every render
// and would re-register every binding every time.
export function useKeymap(
	scope: string,
	handlers: Record<string, HotkeyHandler | undefined>,
	{ enabled = true, owner }: { enabled?: boolean; owner?: string } = {},
) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

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
