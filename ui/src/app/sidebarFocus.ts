import { createAsk } from "@/shared/lib/ask";

export const {
	ask: askToFocusSidebar,
	answered: sidebarFocusAnswered,
	useAsked: useSidebarFocusAsked,
} = createAsk();
