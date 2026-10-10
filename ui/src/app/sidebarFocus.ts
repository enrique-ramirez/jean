import { createAsk } from "@/shared/lib/ask";

const focus = createAsk<{ playlist: string | null }>();

export const askToFocusSidebar = (playlist: string | null = null) =>
	focus.ask({ playlist });

export const {
	answered: sidebarFocusAnswered,
	useAsked: useSidebarFocusAsked,
} = focus;
