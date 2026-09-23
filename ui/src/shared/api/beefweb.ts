async function request(path: string, options?: RequestInit) {
	const response = await fetch(path, options);
	if (!response.ok)
		throw new Error(
			`${options?.method ?? "GET"} ${path} failed: ${response.status}`,
		);
	return response;
}

const post = (path: string, body?: unknown) =>
	request(path, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});

export const playPause = () => post("/api/player/play-pause");

// The player says a track changed and never which direction it moved, so a skip has to be recorded
// where it is asked for. Taken rather than read, and stale after a moment: a skip the player never
// answers must not turn the next track that ends on its own into a step backwards.
const ASKED_MS = 4000;
let asked: { by: number; at: number } | null = null;

export function takeSkipAsked() {
	const last = asked;
	asked = null;
	return last && Date.now() - last.at < ASKED_MS ? last.by : null;
}

const skipping = (by: number) => {
	asked = { by, at: Date.now() };
};

export const nextTrack = () => {
	skipping(1);
	return post("/api/player/next");
};
export const previousTrack = () => {
	skipping(-1);
	return post("/api/player/previous");
};
export const stop = () => post("/api/player/stop");
export const seekTo = (position: number) => post("/api/player", { position });
export const seekBy = (offset: number) =>
	post("/api/player", { relativePosition: offset });
export const setVolume = (volume: number) => post("/api/player", { volume });
export const setMuted = (isMuted: boolean) => post("/api/player", { isMuted });

export const volumeUp = () => post("/api/player/volume/up");
export const volumeDown = () => post("/api/player/volume/down");

// foobar2000 carries the order as an option named `playbackOrder`.
export const setPlaybackOrder = (value: number) =>
	post("/api/player", { options: [{ id: "playbackOrder", value }] });
