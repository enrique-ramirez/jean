import { formatForDisplay } from "@tanstack/react-hotkeys";
import { type BindingId, KEYMAP } from "./keymap";

/**
 * How many leading characters of a label its binding spells, for a tab strip to underline. Zero when
 * the key is not the label's initial -- rename a tab and the hint disappears rather than lying about
 * which key opens it.
 */
export function mnemonicOf(label: string, bindingId: BindingId): number {
	const key = KEYMAP.find((binding) => binding.id === bindingId)?.keys[0];
	const shown = key === undefined ? "" : formatForDisplay(key);
	return shown && label.toUpperCase().startsWith(shown.toUpperCase())
		? shown.length
		: 0;
}
