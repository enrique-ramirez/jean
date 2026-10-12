import { lazy } from "react";

const loadNowPlaying = () => import("@/features/now-playing/NowPlaying");
const loadSettings = () => import("@/features/settings/SettingsDialog");
const loadAutoPlaylist = () =>
	import("@/features/autoplaylist/AutoPlaylistDialog");
const loadShortcuts = () => import("@/shared/keyboard/ShortcutSheet");
const loadPalette = () => import("./CommandPalette");

export const NowPlaying = lazy(() =>
	loadNowPlaying().then((module) => ({ default: module.NowPlaying })),
);
export const SettingsDialog = lazy(() =>
	loadSettings().then((module) => ({ default: module.SettingsDialog })),
);
export const AutoPlaylistDialog = lazy(() =>
	loadAutoPlaylist().then((module) => ({ default: module.AutoPlaylistDialog })),
);
export const ShortcutSheet = lazy(() =>
	loadShortcuts().then((module) => ({ default: module.ShortcutSheet })),
);
export const CommandPalette = lazy(() =>
	loadPalette().then((module) => ({ default: module.CommandPalette })),
);

export const preloadLayers = () => {
	void loadNowPlaying();
	void loadSettings();
	void loadShortcuts();
	void loadPalette();
	return true;
};
