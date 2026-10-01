import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMemo, useRef } from "react";

import { useKeyboardOwner } from "./keyboardOwner";
import {
	type BindingIdIn,
	isTypedAsAnother,
	KEYMAP,
	type Scope,
} from "./keymap";

type HotkeyHandler = (event: KeyboardEvent, context: unknown) => void;

export function useKeymap<S extends Scope>(
	scope: S,
	handlers: Partial<Record<BindingIdIn<S>, HotkeyHandler>>,
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
				callback: (event: KeyboardEvent, context: unknown) => {
					if (isTypedAsAnother(event, hotkey)) return;
					(handlersRef.current as Record<string, HotkeyHandler | undefined>)[
						binding.id
					]?.(event, context);
				},
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
