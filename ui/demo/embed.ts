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

interface Seeded {
	player?: { activeItem?: { index: number } };
	playlists?: { id: string; title: string; itemCount: number }[];
}

export const seedPlayback = async () => {
	const state: Seeded | null = await fetch(
		"/api/query?player=true&playlists=true",
	)
		.then((response) => response.json())
		.catch(() => null);
	const playing = state?.player?.activeItem?.index ?? -1;
	if (!state || playing >= 0) return;

	const from = state.playlists?.find(
		(playlist) => playlist.title === SEED_PLAYLIST && playlist.itemCount > 0,
	);
	if (!from) return;

	await fetch(`/api/player/play/${from.id}/0`, { method: "POST" });
	await fetch("/api/player", {
		method: "POST",
		body: JSON.stringify({ position: SEED_POSITION_SECONDS }),
	});
};

export const focusSearch = () => {
	const field = document.querySelector<HTMLInputElement>(
		'input[type="search"]',
	);
	if (!field) return false;
	field.focus();
	return true;
};
