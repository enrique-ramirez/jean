import { createAsk } from "@/shared/lib/ask";

const focus = createAsk<true>();

export const askToFocusSidebar = () => focus.ask(true);

export const {
	answered: sidebarFocusAnswered,
	useAsked: useSidebarFocusAsked,
} = focus;
