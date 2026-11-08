import {
	parseHotkey,
	type RegisterableHotkeyChord,
} from "@tanstack/react-hotkeys";

const CONTROLS = [
	"button",
	"a[href]",
	"summary",
	"select",
	'[role="button"]',
	'[role="link"]',
	'[role^="menuitem"]',
	'[role="switch"]',
	'[role="radio"]',
].join(", ");

const KEEPS_KEYS = "[data-keeps-keys]";

export function isPressOnControl(event: KeyboardEvent) {
	const control = (event.target as Element | null)?.closest?.(CONTROLS);
	return control != null && !control.matches(KEEPS_KEYS);
}

const NON_TEXT_INPUTS = ["button", "submit", "reset"];

// Duck-typed, so it runs without a DOM. A read-only field counts: its keys are still its own.
export function isPressInTextField(event: KeyboardEvent) {
	const target = event.target as {
		tagName?: string;
		type?: string;
		isContentEditable?: boolean;
	} | null;
	const tag = target?.tagName?.toUpperCase();
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT")
		return !NON_TEXT_INPUTS.includes((target?.type ?? "").toLowerCase());
	return target?.isContentEditable === true;
}

// A Ctrl or Meta chord and Escape fire in a text field, every other key stays out of one, and a
// binding's own `ignoreInputs` decides otherwise. Jean decides it because the library's `'auto'` and
// `true` also skip the keys a grid, a menu or a tablist owns, which Jean's grids and menus rely on.
export function keepsOutOfTextFields(
	hotkey: RegisterableHotkeyChord,
	ignoreInputs: boolean | undefined,
) {
	if (ignoreInputs !== undefined) return ignoreInputs;
	const { key, code, ctrl, meta } =
		typeof hotkey === "string" ? parseHotkey(hotkey) : hotkey;
	return !(ctrl || meta || key === "Escape" || code === "Escape");
}
