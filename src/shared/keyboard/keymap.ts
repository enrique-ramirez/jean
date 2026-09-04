// Every binding in the app is declared here and nowhere else: `useKeymap` registers them and `ShortcutSheet` renders the help from the same array.
//
// Punctuation is declared as the character typed, never as the unshifted key plus Shift.
// The matcher compares `event.key` first and only falls back to `event.code` through a QWERTY punctuation map, so `Shift+/` means "the ? on the physical slash key", which is true on US QWERTY and false on Dvorak, Spanish and French.
// A shifted character therefore needs both spellings: `Shift+?` for layouts that shift to reach it, and the bare character for those that do not. Letters are safe either way.

import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

// The hotkeys type excludes Shift+punctuation for the reason above, so the cast is spelled once, here.
const shifted = (key: string) => `Shift+${key}` as RegisterableHotkey;

// `ignoreInputs: false` is how a binding stays live inside a text field.
export interface Binding {
	id: string;
	scope: string;
	group: string;
	name: string;
	// Typed by the hotkeys manager, so a chord spelled wrong is a compile error rather than a binding that never fires.
	keys: RegisterableHotkey[];
	// What the sheet draws when the registrations are not what a person should be told: two spellings of `?` are one key to press.
	shown?: string[];
	// Registered, not documented: bindings that only meet the expectation a list sets anyway, and so teach nothing in the sheet.
	hidden?: boolean;
	options?: { ignoreInputs?: boolean };
}

export const SCOPE = {
	global: "global",
	nowPlaying: "now playing",
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
	// Both spellings: `=` is unshifted on US and Shift+0 on Spanish, French and German.
	{
		id: "volumeUp",
		scope: SCOPE.global,
		group: "Playback",
		name: "Volume up",
		keys: ["=", shifted("=")],
		shown: ["="],
	},
	{
		id: "volumeDown",
		scope: SCOPE.global,
		group: "Playback",
		name: "Volume down",
		keys: ["-", shifted("-")],
		shown: ["-"],
	},
	{
		id: "toggleMute",
		scope: SCOPE.global,
		group: "Playback",
		name: "Mute / unmute",
		keys: ["M"],
	},

	// Rating ----------------------------------------------------------------
	//
	// Global rather than per-list: the target is the cursor row when a list has one and the playing track otherwise, which is one question with one answer.
	{
		id: "rate0",
		scope: SCOPE.global,
		group: "Rating",
		name: "Remove rating",
		keys: ["0"],
	},
	{
		id: "rate1",
		scope: SCOPE.global,
		group: "Rating",
		name: "Rate 1 star",
		keys: ["1"],
	},
	{
		id: "rate2",
		scope: SCOPE.global,
		group: "Rating",
		name: "Rate 2 stars",
		keys: ["2"],
	},
	{
		id: "rate3",
		scope: SCOPE.global,
		group: "Rating",
		name: "Rate 3 stars",
		keys: ["3"],
	},
	{
		id: "rate4",
		scope: SCOPE.global,
		group: "Rating",
		name: "Rate 4 stars",
		keys: ["4"],
	},
	{
		id: "rate5",
		scope: SCOPE.global,
		group: "Rating",
		name: "Rate 5 stars",
		keys: ["5"],
	},

	// Only the vertical arrows move the list cursor, so the horizontal pair is free to seek everywhere.
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
	// A bare letter: `Mod+Shift+P` opens a private window in Firefox and never reaches the page, and every modifier combination worth having is spoken for by some browser.
	{
		id: "openPalette",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Go to playlist",
		keys: ["G"],
	},
	{
		id: "toggleSidebar",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Show / hide sidebar",
		keys: ["Mod+B"],
	},
	{
		id: "toggleQueue",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Show / hide the queue",
		keys: ["Q"],
	},
	{
		id: "toggleNowPlaying",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Show / hide what's playing",
		keys: ["W"],
	},
	{
		id: "goToPlayingFrom",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Go to what is playing",
		keys: ["P"],
	},
	{
		id: "openSettings",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Settings",
		keys: ["Mod+,"],
	},
	{
		id: "showShortcuts",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Keyboard shortcuts",
		// Shown as one key because it is one key; see the note at the top.
		keys: [shifted("?"), "?" as RegisterableHotkey],
		shown: ["?"],
	},

	// Appearance -----------------------------------------------------------
	{
		id: "toggleTheme",
		scope: SCOPE.global,
		group: "Appearance",
		name: "Switch light / dark",
		keys: ["T"],
	},

	// On the now-playing screen ---------------------------------------------
	// Each key is the initial of the tab it opens, and the tab strip underlines
	// it. Rename a tab and the letter moves with it, or the hint lies.
	{
		id: "showLyrics",
		scope: SCOPE.nowPlaying,
		group: "While what's playing is open",
		name: "Lyrics",
		keys: ["L"],
	},
	{
		id: "showDetails",
		scope: SCOPE.nowPlaying,
		group: "While what's playing is open",
		name: "Details",
		keys: ["D"],
	},
	{
		id: "showArtist",
		scope: SCOPE.nowPlaying,
		group: "While what's playing is open",
		name: "Artist",
		keys: ["A"],
	},

	// In the sidebar -------------------------------------------------------
	// Registered only while a playlist row has focus.
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
		keys: ["ArrowDown"],
	},
	{
		id: "cursorUp",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Move up",
		keys: ["ArrowUp"],
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
	// Registered by `PlayActions` rather than by the list, so the key and the button cannot drift and every view with a Shuffle button gets it.
	{
		id: "shufflePlay",
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Shuffle play",
		keys: ["S"],
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
		hidden: true,
		scope: SCOPE.playlist,
		group: "In a playlist",
		name: "Extend selection down",
		keys: ["Shift+ArrowDown"],
	},
	{
		id: "extendUp",
		hidden: true,
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
		hidden: true,
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
	// These fire while a text input holds focus, so `ignoreInputs` has to be off.
	{
		id: "finderNext",
		hidden: true,
		scope: SCOPE.finder,
		group: "While finding",
		name: "Next match",
		keys: ["ArrowDown"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderPrevious",
		hidden: true,
		scope: SCOPE.finder,
		group: "While finding",
		name: "Previous match",
		keys: ["ArrowUp"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderConfirm",
		hidden: true,
		scope: SCOPE.finder,
		group: "While finding",
		name: "Jump there and play",
		keys: ["Enter"],
		options: { ignoreInputs: false },
	},
	{
		id: "finderClose",
		hidden: true,
		scope: SCOPE.finder,
		group: "While finding",
		name: "Close the finder",
		keys: ["Escape"],
		options: { ignoreInputs: false },
	},
];

// Both are the sheet's: a group whose every binding is hidden must not leave a heading with nothing under it.
const documented = KEYMAP.filter((binding) => !binding.hidden);

export const KEYMAP_GROUPS = [
	...new Set(documented.map((binding) => binding.group)),
];

export const bindingsIn = (group: string) =>
	documented.filter((binding) => binding.group === group);
