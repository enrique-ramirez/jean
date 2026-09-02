// Every binding in the app is declared here and nowhere else: `useKeymap`
// registers them and ShortcutSheet renders the help from the same array.
//
// `/` is contextual -- it filters whatever list you are looking at -- while
// `Mod+K` always searches the whole library. That distinction is why both exist.
//
// **Punctuation is declared as the character you type, never as the unshifted
// key plus Shift.** The matcher compares `event.key` first and only falls back
// to `event.code` through a QWERTY punctuation map, so `Shift+/` silently means
// "the ? that lives on the physical slash key" -- true on US QWERTY and false
// almost everywhere else. *Measured* against the matcher: a `?` pressed on
// Dvorak arrives as `key: '?', code: 'BracketLeft'`, on Spanish as
// `code: 'Minus'`, on French as `code: 'Comma'`, and `Shift+/` matched none of
// them while `Shift+?` matched all three -- because `?` is compared against
// `event.key`, which every layout reports the same way. Letters are safe either
// way: the matcher returns on the `event.key` comparison and never consults the
// code, so a binding on `T` is the key that types a t, wherever it sits.
//
// The corollary is that a shifted character needs both spellings. `Shift+?`
// covers every layout that shifts to reach it; the bare character covers one
// that does not, and costs a line.

import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

// The hotkeys type excludes Shift+punctuation for the reason above -- it is a
// footgun in the general case and the fix in this one. Spelled once, here.
const shifted = (key: string) => `Shift+${key}` as RegisterableHotkey;

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
	// What the sheet draws, when the registrations are not what a person should
	// be told. Two spellings of `?` are one key to press.
	shown?: string[];
	// Registered, not documented. For bindings that only meet the expectation a
	// list sets anyway -- Shift+arrow extending a selection, Escape dropping it,
	// the arrows and Enter inside the finder. They are Jean's code rather than
	// the browser's, so they must stay bound; they are also what anyone would
	// try first, so a row in the sheet spends attention teaching nothing.
	hidden?: boolean;
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
	// Both spellings, because `=` is unshifted on US and Shift+0 on Spanish,
	// French and German -- which was this file's other known-unfixed layout bug,
	// and is the same bug as `?` was.
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
	// Global rather than per-list, and resolved rather than scoped: the target is
	// the cursor row when a list has one and the playing track otherwise, which
	// is one question with one answer. Declaring these in the list's scope too
	// would put six keys in two scopes for the manager to arbitrate.
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
	// A bare letter, like Q, T, N and V: `Mod+Shift+P` is a private window in
	// Firefox and its derivatives, and a browser keeps that one for itself, so
	// the binding could not fire at all. Every modifier combination worth having
	// is spoken for by some browser; a plain letter is reachable in all of them.
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
		id: "showShortcuts",
		scope: SCOPE.global,
		group: "Navigation",
		name: "Keyboard shortcuts",
		// Shown as one key because it is one key: `?` is what the keycap says and
		// what every layout reports, shifted or not. See the note at the top.
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
	// Registered by PlayActions rather than by the list, so the key and the button
	// cannot drift: it is the same call, and the header is the thing that knows
	// whether shuffling this view is possible at all. That puts it on every view
	// with a Shuffle button -- a playlist, a shelf, All music, search results.
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
	// These fire while a text input holds focus, so ignoreInputs has to be off.
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

// Both are the sheet's, so both see only what the sheet draws -- a group whose
// every binding is hidden must not leave a heading with nothing under it.
const documented = KEYMAP.filter((binding) => !binding.hidden);

export const KEYMAP_GROUPS = [
	...new Set(documented.map((binding) => binding.group)),
];

export const bindingsIn = (group: string) =>
	documented.filter((binding) => binding.group === group);
