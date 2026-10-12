import type { PlaybackMode } from "../../../src/shared/api/types.ts";

// What these functions read of the fake: not `FakeState`, which would have `state.ts` import this
// file and this file import `state.ts` back.
interface DeclaresOrders {
	player: { options?: { id: string; enumNames?: string[] }[] };
}

// foobar2000's stock playback-order names, matched against `enumNames` and translated to
// Jean's own mode names the way `plugins/fb2k/src/core/playback_modes.cpp`'s `kModes` does.
// An order this map does not carry is not offered, exactly as `jeanModeFor` refuses one.
export const JEAN_MODE_BY_ORDER: Record<string, PlaybackMode> = {
	Default: "inOrder",
	"Repeat (playlist)": "repeatAll",
	"Repeat (track)": "repeatOne",
	Random: "random",
	"Shuffle (tracks)": "shuffleTracks",
	"Shuffle (albums)": "shuffleAlbums",
	"Shuffle (folders)": "shuffleFolders",
};

export const jeanModeFor = (order: string): PlaybackMode | null =>
	JEAN_MODE_BY_ORDER[order] ?? null;

// The orders this fixture's player actually declares, in the order it declares them, never the
// full stock list regardless of what a spec asked the player to report.
export const declaredOrders = (state: DeclaresOrders): string[] =>
	state.player.options?.find((entry) => entry.id === "playbackOrder")
		?.enumNames ?? [];

// What GET /api/capabilities offers: the declared orders translated and filtered, so an install
// whose player reports fewer orders, or one this component has no name for, offers fewer modes.
export const playbackModesOf = (state: DeclaresOrders): PlaybackMode[] =>
	declaredOrders(state)
		.map(jeanModeFor)
		.filter((mode): mode is PlaybackMode => mode !== null);

export const PLAYBACK_MODES = new Set<PlaybackMode>(
	Object.values(JEAN_MODE_BY_ORDER),
);

export const orderIndexForMode = (
	state: DeclaresOrders,
	mode: PlaybackMode,
): number | null => {
	const orderName = Object.entries(JEAN_MODE_BY_ORDER).find(
		([, jeanMode]) => jeanMode === mode,
	)?.[0];
	if (orderName === undefined) return null;
	const index = declaredOrders(state).indexOf(orderName);
	return index === -1 ? null : index;
};
