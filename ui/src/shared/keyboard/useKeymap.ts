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
import {
	isPressInTextField,
	isPressOnControl,
	keepsOutOfTextFields,
} from "./pressTarget";

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
					if (
						keepsOutOfTextFields(hotkey, binding.options?.ignoreInputs) &&
						isPressInTextField(event)
					)
						return;
					// A press that stays out of a text field is never claimed, so the claim is made here
					// and not by the library, which would make it before this callback could decline.
					// On a focused button a prevented Enter or Space cancels the click it would make.
					if (!binding.leavesControls) event.preventDefault();
					event.stopPropagation();
					if (isTypedAsAnother(event, hotkey)) return;
					if (binding.leavesControls && isPressOnControl(event)) return;
					handlerOf[binding.id]?.(event, context);
				},
				options: {
					ignoreInputs: false,
					preventDefault: false,
					stopPropagation: false,
					enabled: live,
					meta: { name: binding.name, group: binding.group },
				},
			})),
		),
		{ conflictBehavior: "allow" },
	);
}
