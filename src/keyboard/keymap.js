// The single source of truth for keyboard control. Every binding in the app is
// declared here and nowhere else: `useKeymap` registers them and ShortcutSheet
// renders the help overlay from the same array, so the two cannot drift.
//
// `/` is contextual — it filters whatever list you are looking at. `Mod+K`
// always searches the whole library. Keep that distinction; it is the reason
// both can exist without competing.

export const SCOPE = {
  global: 'global',
  playlist: 'playlist',
  finder: 'finder',
}

export const KEYMAP = [
  // Playback -------------------------------------------------------------
  { id: 'playPause', scope: SCOPE.global, group: 'Playback', name: 'Play / pause', keys: ['Space'] },
  { id: 'nextTrack', scope: SCOPE.global, group: 'Playback', name: 'Next track', keys: ['Mod+ArrowRight'] },
  { id: 'previousTrack', scope: SCOPE.global, group: 'Playback', name: 'Previous track', keys: ['Mod+ArrowLeft'] },
  { id: 'stop', scope: SCOPE.global, group: 'Playback', name: 'Stop', keys: ['Mod+.'] },
  { id: 'volumeUp', scope: SCOPE.global, group: 'Playback', name: 'Volume up', keys: ['='] },
  { id: 'volumeDown', scope: SCOPE.global, group: 'Playback', name: 'Volume down', keys: ['-'] },
  { id: 'toggleMute', scope: SCOPE.global, group: 'Playback', name: 'Mute / unmute', keys: ['m'] },

  // Only the vertical arrows move the list cursor, so the horizontal pair is
  // free to seek everywhere. Single keys, so they stay out of text inputs.
  { id: 'seekBack', scope: SCOPE.global, group: 'Playback', name: 'Seek back 5 seconds', keys: ['ArrowLeft'] },
  { id: 'seekForward', scope: SCOPE.global, group: 'Playback', name: 'Seek forward 5 seconds', keys: ['ArrowRight'] },

  // Navigation -----------------------------------------------------------
  { id: 'globalSearch', scope: SCOPE.global, group: 'Navigation', name: 'Search the library', keys: ['Mod+k'] },
  { id: 'toggleSidebar', scope: SCOPE.global, group: 'Navigation', name: 'Show / hide sidebar', keys: ['Mod+b'] },
  { id: 'showShortcuts', scope: SCOPE.global, group: 'Navigation', name: 'Keyboard shortcuts', keys: ['Shift+/'] },

  // Appearance -----------------------------------------------------------
  { id: 'toggleTheme', scope: SCOPE.global, group: 'Appearance', name: 'Switch light / dark', keys: ['t'] },

  // In a playlist --------------------------------------------------------
  { id: 'openFinder', scope: SCOPE.playlist, group: 'In a playlist', name: 'Find in this playlist', keys: ['/'] },
  { id: 'cursorDown', scope: SCOPE.playlist, group: 'In a playlist', name: 'Move down', keys: ['ArrowDown', 'j'] },
  { id: 'cursorUp', scope: SCOPE.playlist, group: 'In a playlist', name: 'Move up', keys: ['ArrowUp', 'k'] },
  { id: 'cursorPageDown', scope: SCOPE.playlist, group: 'In a playlist', name: 'Page down', keys: ['PageDown'] },
  { id: 'cursorPageUp', scope: SCOPE.playlist, group: 'In a playlist', name: 'Page up', keys: ['PageUp'] },
  { id: 'cursorTop', scope: SCOPE.playlist, group: 'In a playlist', name: 'First track', keys: ['Home'] },
  { id: 'cursorBottom', scope: SCOPE.playlist, group: 'In a playlist', name: 'Last track', keys: ['End'] },
  { id: 'playCursor', scope: SCOPE.playlist, group: 'In a playlist', name: 'Play the selected track', keys: ['Enter'] },
  { id: 'jumpToPlaying', scope: SCOPE.playlist, group: 'In a playlist', name: 'Jump to now playing', keys: ['n'] },
  { id: 'extendDown', scope: SCOPE.playlist, group: 'In a playlist', name: 'Extend selection down', keys: ['Shift+ArrowDown'] },
  { id: 'extendUp', scope: SCOPE.playlist, group: 'In a playlist', name: 'Extend selection up', keys: ['Shift+ArrowUp'] },
  { id: 'selectAll', scope: SCOPE.playlist, group: 'In a playlist', name: 'Select all', keys: ['Mod+a'] },
  { id: 'clearSelection', scope: SCOPE.playlist, group: 'In a playlist', name: 'Clear selection', keys: ['Escape'] },
  { id: 'toggleLayout', scope: SCOPE.playlist, group: 'In a playlist', name: 'Switch compact / album view', keys: ['v'] },
  { id: 'toggleHeat', scope: SCOPE.playlist, group: 'In a playlist', name: 'Show / hide play-count heat', keys: ['h'] },

  // Finder ---------------------------------------------------------------
  // These fire while a text input holds focus, so ignoreInputs has to be off.
  {
    id: 'finderNext',
    scope: SCOPE.finder,
    group: 'While finding',
    name: 'Next match',
    keys: ['ArrowDown'],
    options: { ignoreInputs: false },
  },
  {
    id: 'finderPrevious',
    scope: SCOPE.finder,
    group: 'While finding',
    name: 'Previous match',
    keys: ['ArrowUp'],
    options: { ignoreInputs: false },
  },
  {
    id: 'finderConfirm',
    scope: SCOPE.finder,
    group: 'While finding',
    name: 'Jump there and play',
    keys: ['Enter'],
    options: { ignoreInputs: false },
  },
  {
    id: 'finderClose',
    scope: SCOPE.finder,
    group: 'While finding',
    name: 'Close the finder',
    keys: ['Escape'],
    options: { ignoreInputs: false },
  },
]

export const KEYMAP_GROUPS = [...new Set(KEYMAP.map((binding) => binding.group))]

export const bindingsIn = (group) => KEYMAP.filter((binding) => binding.group === group)

// For rendering a shortcut next to a menu item without hardcoding it twice.
export const keysFor = (id) => KEYMAP.find((binding) => binding.id === id)?.keys ?? []
