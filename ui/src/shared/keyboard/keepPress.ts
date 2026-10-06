import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export const keepPressFromBindings = (event: ReactKeyboardEvent) => {
	if (event.key === "Enter" || event.key === " ") event.stopPropagation();
};
