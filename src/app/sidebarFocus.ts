import { createAsk } from "@/shared/lib/ask";

// Somebody asked the sidebar to take the keyboard. Raised by the shell, which owns whether the sidebar is showing at all
// and has to reveal it first; answered by the sidebar, which owns which row the caret lands on.
export const {
	ask: askToFocusSidebar,
	answered: sidebarFocusAnswered,
	useAsked: useSidebarFocusAsked,
} = createAsk();
