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
