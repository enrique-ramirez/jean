// Every binding in the app is declared here and nowhere else: `useKeymap`
// registers them and ShortcutSheet renders the help from the same array.
//
// `/` is contextual -- it filters whatever list you are looking at -- while
// `Mod+K` always searches the whole library. That distinction is why both exist.

import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

// `ignoreInputs: false` is how a binding stays live inside a text field, which
// only the finder's and the search field's own keys want.
export interface Binding {
	id: string;
	scope: string;
	group: string;
	name: string;
	// Typed by the hotkeys manager rather than as plain strings, so a chord
	// spelled wrong is a compile error instead of a binding that never fires.
	keys: RegisterableHotkey[];
	options?: { ignoreInputs?: boolean };
}

export const SCOPE = {
	global: "global",
	sidebar: "sidebar",
	playlist: "playlist",
	finder: "finder",
	search: "search",
};

export const KEYMAP: Binding[] = [
	// Playback -------------------------------------------------------------
	{
		id: "playPause",
		scope: SCOPE.global,
		group: "Playback",
		name: "Play / pause",
		keys: ["Space"],
	},
	{
		id: "nextTrack",
		scope: SCOPE.global,
		group: "Playback",
		name: "Next track",
		keys: ["Mod+ArrowRight"],
	},
	{
		id: "previousTrack",
		scope: SCOPE.global,
		group: "Playback",
		name: "Previous track",
		keys: ["Mod+ArrowLeft"],
	},
	{
		id: "stop",
		scope: SCOPE.global,
		group: "Playback",
		name: "Stop",
		keys: ["Mod+."],
	},
	{
		id: "volumeUp",
		scope: SCOPE.global,
		group: "Playback",
		name: "Volume up",
		keys: ["="],
	},
	{
		id: "volumeDown",
		scope: SCOPE.global,
		group: "Playback",
		name: "Volume down",
		keys: ["-"],
	},
	{
		id: "toggleMute",
		scope: SCOPE.global,
		group: "Playback",
		name: "Mute / unmute",
		keys: ["M"],
	},

	// Only the vertical arrows move the list cursor, so the horizontal pair is
	// free to seek everywhere. Single keys, so they stay out of text inputs.
	{
		id: "seekBack",
		scope: SCOPE.global,
		group: "Playback",
		name: "Seek back 5 seconds",
		keys: ["ArrowLeft"],
	},
	{
		id: "seekForward",
		scope: SCOPE.global,
		group: "Playback",
		name: "Seek forward 5 seconds",
		keys: ["ArrowRight"],
	},

	// Navigation -----------------------------------------------------------
	{
		id: "globalSearch",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Search the library",
		keys: ["Mod+K"],
	},
	{
		id: "openPalette",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Go to playlist",
		keys: ["Mod+Shift+P"],
	},
	{
		id: "toggleSidebar",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Show / hide sidebar",
		keys: ["Mod+B"],
	},
	{
		id: "showShortcuts",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Keyboard shortcuts",
		keys: [
			// The hotkeys type excludes Shift+punctuation, because Shift+/ is '?' on a US
			// layout and something else elsewhere. Kept because '?' is what the sheet is
			// documented under.
			"Shift+/" as RegisterableHotkey,
		],
	},

	// Appearance -----------------------------------------------------------
	{
		id: "toggleTheme",
		scope: SCOPE.global,
		group: "Appearance",
		name: "Switch light / dark",
		keys: ["T"],
	},

	// In the sidebar -------------------------------------------------------
	// Registered only while a playlist row has focus. The same gesture the drag
	// handle performs, for people who never reach for the mouse.
	{
		id: "movePlaylistUp",
		scope: SCOPE.sidebar,
		group: "In the sidebar",
		name: "Move playlist up",
		keys: ["Alt+ArrowUp"],
	},
	{
		id: "movePlaylistDown",
		scope: SCOPE.sidebar,
		group: "In the sidebar",
		name: "Move playlist down",
		keys: ["Alt+ArrowDown"],
	},

	// In a playlist --------------------------------------------------------
	{
		id: "openFinder",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Find in this playlist",
		keys: ["/"],
	},
	{
		id: "cursorDown",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Move down",
		keys: ["ArrowDown", "J"],
	},
	{
		id: "cursorUp",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Move up",
		keys: ["ArrowUp", "K"],
	},
	{
		id: "cursorPageDown",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Page down",
		keys: ["PageDown"],
	},
	{
		id: "cursorPageUp",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Page up",
		keys: ["PageUp"],
	},
	{
		id: "cursorTop",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "First track",
		keys: ["Home"],
	},
	{
		id: "cursorBottom",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Last track",
		keys: ["End"],
	},
	{
		id: "playCursor",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Play the selected track",
		keys: ["Enter"],
	},
	{
		id: "jumpToPlaying",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Jump to now playing",
		keys: ["N"],
	},
	{
		id: "extendDown",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Extend selection down",
		keys: ["Shift+ArrowDown"],
	},
	{
		id: "extendUp",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Extend selection up",
		keys: ["Shift+ArrowUp"],
	},
	{
		id: "selectAll",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Select all",
		keys: ["Mod+A"],
	},
	{
		id: "clearSelection",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Clear selection",
		keys: ["Escape"],
	},
	{
		id: "toggleLayout",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Switch compact / album view",
		keys: ["V"],
	},
	{
		id: "toggleHeat",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Show / hide play-count heat",
		keys: ["H"],
	},

	// In search results ----------------------------------------------------
	{
		id: "saveSearch",
		scope: SCOPE.search,
		group: "In search results",
		name: "Save results as a playlist",
		keys: ["Mod+S"],
	},

	// Finder ---------------------------------------------------------------
	// These fire while a text input holds focus, so ignoreInputs has to be off.
	{
		id: "finderNext",
		scope: SCOPE.finder,
		group: "While finding",
		name: "Next match",
		keys: ["ArrowDown"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderPrevious",
		scope: SCOPE.finder,
		group: "While finding",
		name: "Previous match",
		keys: ["ArrowUp"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderConfirm",
		scope: SCOPE.finder,
		group: "While finding",
		name: "Jump there and play",
		keys: ["Enter"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderClose",
		scope: SCOPE.finder,
		group: "While finding",
		name: "Close the finder",
		keys: ["Escape"],
		options: { ignoreInputs: false },
	},
];

export const KEYMAP_GROUPS = [
	...new Set(KEYMAP.map((binding) => binding.group)),
];

export const bindingsIn = (group: string) =>
	KEYMAP.filter((binding) => binding.group === group);
