import { seekTo } from "../src/shared/api/playback";
import {
	fetchPlaylistAnnotations,
	playPlaylistItem,
} from "../src/shared/api/playlists";
import { fetchState } from "../src/shared/api/state";

export const isEmbed = (params: URLSearchParams) => params.has("embed");

export const isolateStorage = () => {
	const held = new Map<string, string>();
	const shim = {
		get length() {
			return held.size;
		},
		key: (index: number) => [...held.keys()][index] ?? null,
		getItem: (key: string) => held.get(key) ?? null,
		setItem: (key: string, value: string) => void held.set(key, String(value)),
		removeItem: (key: string) => void held.delete(key),
		clear: () => held.clear(),
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: shim as Storage,
	});
};

export const applySettings = (params: URLSearchParams) => {
	for (const [name, value] of params)
		if (name.startsWith("set."))
			localStorage.setItem(`jean.${name.slice(4)}`, value);
};

// A frame opens on a player with a record in it rather than a stopped one. The playlist is one of
// the demo player's own, from `demo/library.ts`, and its first track carries lyrics.
const SEED_PLAYLIST = "Library";
const SEED_POSITION_SECONDS = 47;

export const seedPlayback = async () => {
	const origin = window.location.origin;

	const state = await fetchState(origin, null);
	if (
		state.ok &&
		state.kind === "state" &&
		state.state.player.playingLocation !== null
	)
		return;

	const playlists = await fetchPlaylistAnnotations(origin);
	const from = playlists?.find(
		(playlist) => playlist.title === SEED_PLAYLIST && playlist.itemCount > 0,
	);
	if (!from) return;

	try {
		await playPlaylistItem(origin, from.id, 0);
		await seekTo(origin, SEED_POSITION_SECONDS);
	} catch {
		// A frame opens on a stopped player rather than not opening at all.
	}
};

export const focusSearch = () => {
	const field = document.querySelector<HTMLInputElement>(
		'input[type="search"]',
	);
	if (!field) return false;
	field.focus();
	return true;
};
