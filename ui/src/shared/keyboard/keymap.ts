import {
	formatForDisplay,
	type Hotkey,
	matchesKeyboardEvent,
	parseHotkey,
	type RegisterableHotkey,
} from "@tanstack/react-hotkeys";

import type { Phrase } from "@/shared/i18n/en";

export type ShortcutName = Extract<Phrase, `shortcut.${string}`>;
export type ShortcutGroup = Extract<Phrase, `shortcutGroup.${string}`>;

const shifted = (key: string) => `Shift+${key}` as RegisterableHotkey;

// TanStack Hotkeys fires a Ctrl or Meta binding inside a text field unless told otherwise, and there
// a chord that edits text belongs to the field.
const LEAVES_TEXT_FIELDS = { ignoreInputs: true };

export const SCOPE = {
	global: "global",
	nowPlaying: "now playing",
	sidebar: "sidebar",
	playlist: "playlist",
	genres: "genres",
	artist: "artist",
	finder: "finder",
	search: "search",
} as const;

export type Scope = (typeof SCOPE)[keyof typeof SCOPE];

export interface Binding {
	id: string;
	scope: Scope;
	group: ShortcutGroup;
	name: ShortcutName;
	keys: readonly RegisterableHotkey[];
	shown?: readonly string[];
	hidden?: boolean;
	options?: { ignoreInputs?: boolean };
}

const DECLARED = [
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
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "previousTrack",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.previousTrack",
		keys: ["Mod+ArrowLeft"],
		options: LEAVES_TEXT_FIELDS,
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
		id: "toggleShuffle",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.toggleShuffle",
		keys: ["O"],
	},
	{
		id: "playAll",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playback",
		name: "shortcut.playAll",
		keys: ["P"],
	},
	{
		id: "shufflePlay",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playback",
		name: "shortcut.shufflePlay",
		keys: ["S"],
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
		id: "goToPlaying",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.goToPlaying",
		keys: ["N"],
	},
	{
		id: "goBack",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.goBack",
		keys: ["Backspace"],
	},
	// Modified rather than bare `Home`, which the playlist scope binds to the cursor and would shadow
	// it in exactly the long lists this exists for.
	{
		id: "backToTop",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.backToTop",
		keys: ["Mod+Home"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "openSettings",
		scope: SCOPE.global,
		group: "shortcutGroup.navigation",
		name: "shortcut.openSettings",
		// Chrome, Safari and Firefox on macOS may claim Cmd+, for their own preferences before the
		// page sees it.
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
		id: "fullScreen",
		scope: SCOPE.nowPlaying,
		group: "shortcutGroup.nowPlaying",
		name: "shortcut.fullScreen",
		keys: ["F"],
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

	{
		id: "previousTab",
		scope: SCOPE.artist,
		group: "shortcutGroup.artist",
		name: "shortcut.previousTab",
		keys: ["["],
	},
	{
		id: "nextTab",
		scope: SCOPE.artist,
		group: "shortcutGroup.artist",
		name: "shortcut.nextTab",
		keys: ["]"],
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
		options: LEAVES_TEXT_FIELDS,
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
		id: "moveRowsUp",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.moveRowsUp",
		keys: ["Alt+ArrowUp"],
	},
	{
		id: "moveRowsDown",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.moveRowsDown",
		keys: ["Alt+ArrowDown"],
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
] as const satisfies readonly Binding[];

export const KEYMAP: readonly Binding[] = DECLARED;

type Bound = (typeof DECLARED)[number];

export type BindingId = Bound["id"];

export type BindingIdIn<S extends Scope> = Extract<Bound, { scope: S }>["id"];

const PUNCTUATION = /^[^A-Za-z0-9]$/;
const PRINTABLE_ASCII = /^[!-~]$/;

// TanStack Hotkeys falls back from `event.key` to `event.code` read through a QWERTY map, so on
// another Latin layout a punctuation key also matches the character QWERTY has there: Dvorak's `/`
// sits on QWERTY's `[`. Without Shift or Alt, a printable ASCII `event.key` is the character the
// person pressed, and only a binding declaring that character is theirs.
export function isTypedAsAnother(
	event: KeyboardEvent,
	hotkey: RegisterableHotkey,
) {
	const declared =
		typeof hotkey === "string" ? parseHotkey(hotkey).key : hotkey.key;
	return (
		!event.shiftKey &&
		!event.altKey &&
		PUNCTUATION.test(declared) &&
		PRINTABLE_ASCII.test(event.key) &&
		event.key !== declared
	);
}

export const matchesBinding = (event: KeyboardEvent, id: BindingId) =>
	KEYMAP.find((binding) => binding.id === id)?.keys.some(
		(key) =>
			matchesKeyboardEvent(event, key as Hotkey) &&
			!isTypedAsAnother(event, key),
	) ?? false;

const documented = KEYMAP.filter((binding) => !binding.hidden);

export const KEYMAP_GROUPS = [
	...new Set(documented.map((binding) => binding.group)),
];

export const bindingsIn = (group: ShortcutGroup) =>
	documented.filter((binding) => binding.group === group);

// What to print on a keycap drawn beside the thing a binding opens, so a hint cannot come to
// advertise a key the keymap no longer answers to.
export function hintFor(id: BindingId): string | null {
	const binding = KEYMAP.find((entry) => entry.id === id);
	if (!binding) return null;
	return binding.shown?.[0] ?? formatForDisplay(binding.keys[0]);
}
