// Punctuation is declared as the character typed, never as the unshifted key plus Shift. The matcher
// compares `event.key` first and falls back to `event.code` through a QWERTY punctuation map, so
// `Shift+/` means "the ? on the physical slash key" -- true on US QWERTY and false on Dvorak, Spanish
// and French. A shifted character therefore needs both spellings. Letters are safe either way.

import {
	formatForDisplay,
	type RegisterableHotkey,
} from "@tanstack/react-hotkeys";

import type { Phrase } from "@/shared/i18n/en";

export type ShortcutName = Extract<Phrase, `shortcut.${string}`>;
export type ShortcutGroup = Extract<Phrase, `shortcutGroup.${string}`>;

// The hotkeys type excludes Shift+punctuation, so the cast is spelled once, here.
const shifted = (key: string) => `Shift+${key}` as RegisterableHotkey;

export interface Binding {
	id: string;
	scope: string;
	group: ShortcutGroup;
	name: ShortcutName;
	keys: RegisterableHotkey[];
	shown?: string[];
	hidden?: boolean;
	options?: { ignoreInputs?: boolean };
}

export const SCOPE = {
	global: "global",
	nowPlaying: "now playing",
	sidebar: "sidebar",
	playlist: "playlist",
	genres: "genres",
	artist: "artist",
	finder: "finder",
	search: "search",
};

export const KEYMAP: Binding[] = [
	{
		id: "playPause",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.playPause",
		keys: ["Space"],
	},
	{
		id: "nextTrack",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.nextTrack",
		keys: ["Mod+ArrowRight"],
	},
	{
		id: "previousTrack",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.previousTrack",
		keys: ["Mod+ArrowLeft"],
	},
	{
		id: "stop",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.stop",
		keys: ["Mod+."],
	},
	{
		id: "volumeUp",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.volumeUp",
		keys: ["=", shifted("=")],
		shown: ["="],
	},
	{
		id: "volumeDown",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.volumeDown",
		keys: ["-", shifted("-")],
		shown: ["-"],
	},
	{
		id: "toggleMute",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.toggleMute",
		keys: ["M"],
	},

	{
		id: "rate0",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate0",
		keys: ["0"],
	},
	{
		id: "rate1",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate1",
		keys: ["1"],
	},
	{
		id: "rate2",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate2",
		keys: ["2"],
	},
	{
		id: "rate3",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate3",
		keys: ["3"],
	},
	{
		id: "rate4",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate4",
		keys: ["4"],
	},
	{
		id: "rate5",
		scope: SCOPE.global,
		group: "shortcutGroup.rating",
		name: "shortcut.rate5",
		keys: ["5"],
	},

	{
		id: "seekBack",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.seekBack",
		keys: ["ArrowLeft"],
	},
	{
		id: "seekForward",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.seekForward",
		keys: ["ArrowRight"],
	},

	{
		id: "globalSearch",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.globalSearch",
		keys: ["Mod+K"],
	},
	// A bare letter: `Mod+Shift+P` opens a private window in Firefox and never reaches the page.
	{
		id: "openPalette",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.openPalette",
		keys: ["G"],
	},
	{
		id: "toggleSidebar",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.toggleSidebar",
		keys: ["Mod+B"],
	},
	{
		id: "focusSidebar",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.focusSidebar",
		keys: ["B"],
	},
	{
		id: "toggleQueue",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.toggleQueue",
		keys: ["Q"],
	},
	{
		id: "toggleNowPlaying",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.toggleNowPlaying",
		keys: ["W"],
	},
	{
		id: "goToPlayingFrom",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.goToPlayingFrom",
		keys: ["P"],
	},
	// Modified rather than bare `Home`, which the playlist scope binds to the cursor and would shadow
	// it in exactly the long lists this exists for.
	{
		id: "backToTop",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.backToTop",
		keys: ["Mod+Home"],
	},
	{
		id: "openSettings",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.openSettings",
		keys: ["Mod+,"],
	},
	{
		id: "showShortcuts",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.showShortcuts",
		keys: [shifted("?"), "?" as RegisterableHotkey],
		shown: ["?"],
	},

	{
		id: "toggleTheme",
		scope: SCOPE.global,
		group: "shortcutGroup.appearance",
		name: "shortcut.toggleTheme",
		keys: ["T"],
	},

	// Each key is the initial of the tab it opens and the tab strip underlines it. Rename a tab and
	// the letter moves with it, or the hint lies.
	{
		id: "showLyrics",
		scope: SCOPE.nowPlaying,
		group: "shortcutGroup.nowPlaying",
		name: "shortcut.showLyrics",
		keys: ["L"],
	},
	{
		id: "showDetails",
		scope: SCOPE.nowPlaying,
		group: "shortcutGroup.nowPlaying",
		name: "shortcut.showDetails",
		keys: ["D"],
	},
	{
		id: "showArtist",
		scope: SCOPE.nowPlaying,
		group: "shortcutGroup.nowPlaying",
		name: "shortcut.showArtist",
		keys: ["A"],
	},

	{
		id: "movePlaylistUp",
		scope: SCOPE.sidebar,
		group: "shortcutGroup.sidebar",
		name: "shortcut.movePlaylistUp",
		keys: ["Alt+ArrowUp"],
	},
	{
		id: "movePlaylistDown",
		scope: SCOPE.sidebar,
		group: "shortcutGroup.sidebar",
		name: "shortcut.movePlaylistDown",
		keys: ["Alt+ArrowDown"],
	},

	// One key rather than an initial each: `T` for Tracks is the theme toggle, and a scoped binding
	// quietly shadowing a global one is worse than a key that is not a first letter.
	{
		id: "switchArtistTab",
		scope: SCOPE.artist,
		group: "shortcutGroup.artist",
		name: "shortcut.switchArtistTab",
		keys: ["O"],
	},

	{
		id: "findGenre",
		scope: SCOPE.genres,
		group: "shortcutGroup.genres",
		name: "shortcut.findGenre",
		keys: ["/"],
	},
	{
		id: "switchGenreOrder",
		scope: SCOPE.genres,
		group: "shortcutGroup.genres",
		name: "shortcut.switchGenreOrder",
		keys: ["S"],
	},

	{
		id: "openFinder",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.openFinder",
		keys: ["/"],
	},
	{
		id: "cursorDown",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorDown",
		keys: ["ArrowDown"],
	},
	{
		id: "cursorUp",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorUp",
		keys: ["ArrowUp"],
	},
	{
		id: "cursorPageDown",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorPageDown",
		keys: ["PageDown"],
	},
	{
		id: "cursorPageUp",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorPageUp",
		keys: ["PageUp"],
	},
	{
		id: "cursorTop",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorTop",
		keys: ["Home"],
	},
	{
		id: "cursorBottom",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.cursorBottom",
		keys: ["End"],
	},
	{
		id: "playCursor",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.playCursor",
		keys: ["Enter"],
	},
	{
		id: "shufflePlay",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.shufflePlay",
		keys: ["S"],
	},
	{
		id: "jumpToPlaying",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.jumpToPlaying",
		keys: ["N"],
	},
	{
		id: "extendDown",
		hidden: true,
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.extendDown",
		keys: ["Shift+ArrowDown"],
	},
	{
		id: "extendUp",
		hidden: true,
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.extendUp",
		keys: ["Shift+ArrowUp"],
	},
	{
		id: "selectAll",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.selectAll",
		keys: ["Mod+A"],
	},
	{
		id: "clearSelection",
		hidden: true,
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.clearSelection",
		keys: ["Escape"],
	},
	{
		id: "toggleLayout",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.toggleLayout",
		keys: ["V"],
	},
	{
		id: "toggleHeat",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.toggleHeat",
		keys: ["H"],
	},

	{
		id: "saveSearch",
		scope: SCOPE.search,
		group: "shortcutGroup.search",
		name: "shortcut.saveSearch",
		keys: ["Mod+S"],
	},

	{
		id: "finderNext",
		hidden: true,
		scope: SCOPE.finder,
		group: "shortcutGroup.finder",
		name: "shortcut.finderNext",
		keys: ["ArrowDown"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderPrevious",
		hidden: true,
		scope: SCOPE.finder,
		group: "shortcutGroup.finder",
		name: "shortcut.finderPrevious",
		keys: ["ArrowUp"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderConfirm",
		hidden: true,
		scope: SCOPE.finder,
		group: "shortcutGroup.finder",
		name: "shortcut.finderConfirm",
		keys: ["Enter"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderClose",
		hidden: true,
		scope: SCOPE.finder,
		group: "shortcutGroup.finder",
		name: "shortcut.finderClose",
		keys: ["Escape"],
		options: { ignoreInputs: false },
	},
];

const documented = KEYMAP.filter((binding) => !binding.hidden);

export const KEYMAP_GROUPS = [
	...new Set(documented.map((binding) => binding.group)),
];

export const bindingsIn = (group: ShortcutGroup) =>
	documented.filter((binding) => binding.group === group);

// What to print on a keycap drawn beside the thing a binding opens, so a hint cannot come to
// advertise a key the keymap no longer answers to.
export function hintFor(id: string): string | null {
	const binding = KEYMAP.find((entry) => entry.id === id);
	if (!binding) return null;
	return binding.shown?.[0] ?? formatForDisplay(binding.keys[0]);
}
