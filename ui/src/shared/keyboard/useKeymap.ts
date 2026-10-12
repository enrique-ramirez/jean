import { useHotkeys } from "@tanstack/react-hotkeys";

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
	const keyboardOwner = useKeyboardOwner();
	const live = enabled && (keyboardOwner === null || keyboardOwner === owner);
	const [singleKeys] = useSingleKeyShortcuts();
	const handlerOf = handlers as Record<string, HotkeyHandler | undefined>;

	// TanStack Hotkeys' `useHotkeys` hands each registration its callback and options again after
	// every render, and warns of a hotkey registered twice whether or not both are enabled.
	useHotkeys(
		KEYMAP.filter(
			(binding) =>
				binding.scope === scope &&
				binding.id in handlers &&
				isAvailable(binding, singleKeys),
		).flatMap((binding) =>
			binding.keys.map((hotkey) => ({
				hotkey,
				callback: (event: KeyboardEvent, context: unknown) => {
					if (isTypedAsAnother(event, hotkey)) return;
					if (binding.leavesControls && isPressOnControl(event)) return;
					handlerOf[binding.id]?.(event, context);
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
		),
		{ conflictBehavior: "allow" },
	);
}
