import {
	detectPlatform,
	formatForDisplay,
	type Hotkey,
	matchesKeyboardEvent,
	parseHotkey,
	type RegisterableHotkey,
} from "@tanstack/react-hotkeys";

import type { Phrase } from "@/shared/i18n/en";

type ShortcutName = Extract<Phrase, `shortcut.${string}`>;
export type ShortcutGroup = Extract<Phrase, `shortcutGroup.${string}`>;

const shifted = (key: string) => `Shift+${key}` as RegisterableHotkey;

const MENU_CHORD = "Mod+Shift+\\" as RegisterableHotkey;
const MENU_KEYS = [
	"Shift+F10",
	// Chromium drops the native `contextmenu` the Menu key would fire once its keydown is prevented,
	// which every matched binding does, so one press is one menu.
	"ContextMenu",
	MENU_CHORD,
] as const;
// A Mac keyboard has no Menu key and Chromium on macOS fires nothing for Shift+F10, so a Mac is shown
// the chord alone.
const MENU_KEYS_SHOWN = detectPlatform() === "mac" ? [MENU_CHORD] : MENU_KEYS;
const KEY_LABELS = { ContextMenu: "Menu", Delete: "Del" };

// TanStack Hotkeys fires a Ctrl or Meta binding inside a text field unless told otherwise, and there
// a chord that edits text belongs to the field.
const LEAVES_TEXT_FIELDS = { ignoreInputs: true };

export const SCOPE = {
	global: "global",
	nowPlaying: "now playing",
	lyricEditor: "lyric editor",
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
	shown?: readonly RegisterableHotkey[];
	hidden?: boolean;
	leavesControls?: boolean;
	options?: { ignoreInputs?: boolean };
}

const DECLARED = [
	{
		id: "playPause",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.playPause",
		keys: ["Space"],
		leavesControls: true,
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
		id: "playbackOrder",
		scope: SCOPE.global,
		group: "shortcutGroup.playback",
		name: "shortcut.playbackOrder",
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
		keys: ["?" as RegisterableHotkey],
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
		id: "lyricLineNext",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricLineNext",
		keys: ["ArrowDown"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricLinePrevious",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricLinePrevious",
		keys: ["ArrowUp"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricEarlierTenth",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricEarlierTenth",
		keys: ["Alt+ArrowLeft"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricLaterTenth",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricLaterTenth",
		keys: ["Alt+ArrowRight"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricEarlierSecond",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricEarlierSecond",
		keys: ["Alt+Shift+ArrowLeft"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricLaterSecond",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricLaterSecond",
		keys: ["Alt+Shift+ArrowRight"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricSelectAll",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricSelectAll",
		keys: ["Mod+A"],
		options: LEAVES_TEXT_FIELDS,
	},

	{
		id: "lyricStamp",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricStamp",
		keys: ["Enter"],
	},
	{
		id: "lyricPlayFrom",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricPlayFrom",
		keys: ["Shift+Enter"],
	},
	{
		id: "lyricEditWords",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricEditWords",
		keys: ["F2"],
	},
	{
		id: "lyricLineBelow",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricLineBelow",
		keys: ["Mod+Enter"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricRemoveLine",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricRemoveLine",
		keys: ["Mod+Backspace"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricUndo",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricUndo",
		keys: ["Mod+Z"],
		options: LEAVES_TEXT_FIELDS,
	},
	{
		id: "lyricSave",
		scope: SCOPE.lyricEditor,
		group: "shortcutGroup.lyricEditor",
		name: "shortcut.lyricSave",
		keys: ["Mod+S"],
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
		id: "openPlaylistMenu",
		scope: SCOPE.sidebar,
		group: "shortcutGroup.sidebar",
		name: "shortcut.openPlaylistMenu",
		keys: MENU_KEYS,
		shown: MENU_KEYS_SHOWN,
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
		leavesControls: true,
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
		id: "removeRows",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.removeRows",
		keys: ["Delete", "Mod+Backspace"],
		shown: ["Delete"],
	},
	{
		id: "openRowMenu",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.openRowMenu",
		keys: MENU_KEYS,
		shown: MENU_KEYS_SHOWN,
	},
	{
		id: "rowDetails",
		scope: SCOPE.playlist,
		group: "shortcutGroup.playlist",
		name: "shortcut.rowDetails",
		keys: ["I"],
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
		leavesControls: true,
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
// A browser reports a dead key, such as the grave a Spanish layout has where QWERTY has `[`, as
// `event.key === "Dead"`.
const DEAD_KEY = "Dead";
const isCharacterTyped = (key: string) =>
	PRINTABLE_ASCII.test(key) || key === DEAD_KEY;

// TanStack Hotkeys falls back from `event.key` to `event.code` read through a QWERTY map, so on
// another Latin layout a punctuation key also matches the character QWERTY has there: Dvorak's `/`
// sits on QWERTY's `[`. Without Shift or Alt, a printable ASCII `event.key` or a dead key is what
// the person pressed, and only a binding declaring that character is theirs.
export function isTypedAsAnother(
	event: KeyboardEvent,
	hotkey: RegisterableHotkey,
) {
	const declared =
		typeof hotkey === "string" ? parseHotkey(hotkey).key : hotkey.key;
	return (
		declared !== undefined &&
		!event.shiftKey &&
		!event.altKey &&
		PUNCTUATION.test(declared) &&
		isCharacterTyped(event.key) &&
		event.key !== declared
	);
}

const isBareCharacter = (hotkey: RegisterableHotkey) => {
	const { key, ctrl, alt, meta, shift } =
		typeof hotkey === "string" ? parseHotkey(hotkey) : hotkey;
	const isChord = ctrl || alt || meta;
	const isOneCharacter = key !== undefined && [...key].length === 1;
	const isShiftedPunctuation = shift && isOneCharacter && PUNCTUATION.test(key);
	return isOneCharacter && !isChord && (!shift || isShiftedPunctuation);
};

export const isSingleKeyBinding = (binding: Binding) =>
	binding.keys.every(isBareCharacter);

export const isAvailable = (binding: Binding, singleKeys: boolean) =>
	singleKeys || !isSingleKeyBinding(binding);

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

const drawnKeysOf = (binding: Binding) => binding.shown ?? binding.keys;

export const chordsOf = (binding: Binding) =>
	drawnKeysOf(binding).map((key) =>
		formatForDisplay(key, { parts: true, keyLabels: KEY_LABELS }),
	);

export const chordFor = (id: BindingId) =>
	chordsOf(KEYMAP.find((entry) => entry.id === id) as Binding)[0];

export function hintFor(id: BindingId, singleKeys: boolean): string | null {
	const binding = KEYMAP.find((entry) => entry.id === id);
	if (!binding || !isAvailable(binding, singleKeys)) return null;
	return formatForDisplay(drawnKeysOf(binding)[0], { keyLabels: KEY_LABELS });
}
