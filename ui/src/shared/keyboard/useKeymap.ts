import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo, useRef } from "react";

import { useStoredState } from "@/shared/hooks/useStoredState";
import { useKeyboardOwner } from "./keyboardOwner";
import {
	type BindingIdIn,
	isAvailable,
	isTypedAsAnother,
	KEYMAP,
	type Scope,
} from "./keymap";
import { isPressOnControl } from "./pressOnControl";

type HotkeyHandler = (event: KeyboardEvent, context: unknown) => void;

const SINGLE_KEY_SHORTCUTS_KEY = "jean.singleKeyShortcuts";

export const useSingleKeyShortcuts = () =>
	useStoredState(SINGLE_KEY_SHORTCUTS_KEY, true);

export function useKeymap<S extends Scope>(
	scope: S,
	handlers: Partial<Record<BindingIdIn<S>, HotkeyHandler>>,
	{ enabled = true, owner }: { enabled?: boolean; owner?: string } = {},
) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	const keyboardOwner = useKeyboardOwner();
	const live = enabled && (keyboardOwner === null || keyboardOwner === owner);
	const [singleKeys] = useSingleKeyShortcuts();

	const handledIds = Object.keys(handlers).sort().join(",");

	const definitions = useMemo(() => {
		const handled = new Set(handledIds.split(","));

		return KEYMAP.filter(
			(binding) =>
				binding.scope === scope &&
				handled.has(binding.id) &&
				isAvailable(binding, singleKeys),
		).flatMap((binding) =>
			binding.keys.map((hotkey) => ({
				hotkey,
				callback: (event: KeyboardEvent, context: unknown) => {
					if (isTypedAsAnother(event, hotkey)) return;
					if (binding.leavesControls && isPressOnControl(event)) return;
					(handlersRef.current as Record<string, HotkeyHandler | undefined>)[
						binding.id
					]?.(event, context);
				},
				options: {
					...binding.options,
					// TanStack Hotkeys prevents every matched keydown unless told not to, and on a focused
					// button that cancels the click Enter or Space would make.
					preventDefault: !binding.leavesControls,
					enabled: live,
					meta: { name: binding.name, group: binding.group },
				},
			})),
		);
	}, [scope, handledIds, live, singleKeys]);

	useHotkeys(definitions);
}
