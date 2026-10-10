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

export const isPressOnControl = (event: KeyboardEvent) =>
	(event.target as Element | null)?.closest?.(CONTROLS) != null;
