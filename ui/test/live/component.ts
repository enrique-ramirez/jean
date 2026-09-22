// Reaching foo_jean from node, beside the browser Jean is driven in. Every value comes from the
// environment so nothing here names a machine.

const required = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} must be set`);
	return value;
};

export const COMPONENT = () => required("LIVE_COMPONENT");
export const TOKEN = () => required("LIVE_FOO_JEAN_TOKEN");

export const component = async <T>(
	path: string,
	init?: RequestInit,
): Promise<T> => {
	const response = await fetch(`${COMPONENT()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${TOKEN()}`,
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
	const body = await response.text();
	if (!response.ok)
		throw new Error(
			`${init?.method ?? "GET"} ${path} -> ${response.status} ${body}`,
		);
	return (body ? JSON.parse(body) : undefined) as T;
};

export interface Playlist {
	id: string;
	index: number;
	title: string;
	itemCount: number;
	isAutoPlaylist: boolean;
	role: string | null;
	structure: string;
	revision: string;
}

export const playlists = () =>
	component<{ playlists: Playlist[] }>("/api/playlists").then(
		(answer) => answer.playlists,
	);

export const byTitle = async (title: string) => {
	const found = (await playlists()).find((entry) => entry.title === title);
	if (!found) throw new Error(`no playlist titled ${title}`);
	return found;
};

export const rowsOf = (id: string, offset: number, count: number) =>
	component<{
		items: { columns: string[]; libraryPath: string | null }[];
		totalCount: number;
		structure: string;
		revision: string;
	}>(
		`/api/playlists/${id}/items?offset=${offset}&count=${count}&columns=${encodeURIComponent("%path%")}`,
	);

export const writeRating = (path: string, rating: string) =>
	component("/api/tags", {
		method: "POST",
		body: JSON.stringify({ path, fields: { rating } }),
	});

export const capabilities = () =>
	component<{ canWritePlaylists: boolean }>("/api/capabilities");

export const copyToNewPlaylist = (
	title: string,
	source: string,
	rows: number,
) =>
	component<Playlist>("/api/playlists", {
		method: "POST",
		body: JSON.stringify({ title, source, runs: [[0, rows]] }),
	});

export const removePlaylist = (id: string) =>
	component<void>(`/api/playlists/${id}`, { method: "DELETE" });

export const playRow = (id: string, index: number) =>
	component<void>(`/api/playlists/${id}/items/${index}/play`, {
		method: "POST",
	});

export const state = () =>
	component<{
		player: {
			playback: string;
			playingLocation: { playlistId: string; index: number } | null;
			currentPlaylistId: string | null;
		};
	}>("/api/state");
