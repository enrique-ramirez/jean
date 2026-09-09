export const PLAYING_ROUTE = "playing";

export const PANEL_TABS = ["lyrics", "details", "artist"] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

export const playingRoute = (tab?: PanelTab | null) =>
	tab ? `${PLAYING_ROUTE}/${tab}` : PLAYING_ROUTE;

export const isPlayingRoute = (route: string) =>
	route === PLAYING_ROUTE || route.startsWith(`${PLAYING_ROUTE}/`);

export const panelOfRoute = (route: string): PanelTab | null =>
	PANEL_TABS.find((tab) => route === `${PLAYING_ROUTE}/${tab}`) ?? null;
