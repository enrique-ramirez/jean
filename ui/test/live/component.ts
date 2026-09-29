import type {
	PlaybackMode,
	PlaybackState,
} from "../../src/shared/api/types.ts";

export type { PlaybackMode };

// Reaching foo_jean from node, beside the browser Jean is driven in. The origin comes from the
// environment so nothing here names a machine.

export const COMPONENT = () => {
	const live = process.env.LIVE;
	if (!live)
		throw new Error("LIVE must name the origin foo_jean serves Jean from.");
	return new URL(live).origin;
};

const RATE_LIMITED_ATTEMPTS = 20;
const RETRY_AFTER_FALLBACK_MS = 1000;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// foo_jean meters requests per client and answers `429` with `Retry-After` in seconds. Through
// the tunnel this process and the browser beside it are one client, so a poll here can be
// refused for traffic the page made.
const fetchPatiently = async (url: string, init: RequestInit) => {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(url, init);
		if (response.status !== 429 || attempt === RATE_LIMITED_ATTEMPTS)
			return response;
		await response.body?.cancel();
		const seconds = Number(response.headers.get("Retry-After"));
		await wait(seconds > 0 ? seconds * 1000 : RETRY_AFTER_FALLBACK_MS);
	}
};

export const component = async <T>(
	path: string,
	init?: RequestInit,
): Promise<T> => {
	const response = await fetchPatiently(`${COMPONENT()}${path}`, {
		...init,
		headers: {
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

export const rowsOf = (
	id: string,
	offset: number,
	count: number,
	columns: readonly string[] = ["%path%"],
) =>
	component<{
		items: { columns: string[]; libraryPath: string | null }[];
		totalCount: number;
		structure: string;
		revision: string;
	}>(
		// foo_jean takes several columns repeated, never comma-separated, since a title-formatting
		// expression may itself contain a comma.
		`/api/playlists/${id}/items?offset=${offset}&count=${count}&${columns
			.map((column) => `columns=${encodeURIComponent(column)}`)
			.join("&")}`,
	);

export const FIXTURES = "#foo_jean test";

export interface FixtureRow {
	row: number;
	path: string;
	libraryPath: string | null;
}

export const fixtureRows = async () => {
	const found = (await playlists()).find((entry) => entry.title === FIXTURES);
	if (!found)
		throw new Error(
			`no playlist titled ${FIXTURES} holding anything: run plugins/fb2k/scripts/test-fixtures.ps1 on this player first`,
		);
	const { items } = await rowsOf(found.id, 0, found.itemCount);
	const rows: FixtureRow[] = items.map((item, row) => ({
		row,
		path: item.columns[0],
		libraryPath: item.libraryPath,
	}));
	return { playlist: found, rows };
};

// The player's paths are its own platform's, so this compares them as text with either separator,
// never through Node's `path`, which reads a Windows path as relative on a Mac.
const withForwardSlashes = (path: string) =>
	path.replaceAll("\\", "/").replace(/\/+$/, "");

export const underRoot = (path: string, root: string): boolean =>
	withForwardSlashes(path).startsWith(`${withForwardSlashes(root)}/`);

export const writeRating = async (
	target: { track: string; subsong?: number; path: string },
	rating: string,
) => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root || !underRoot(target.path, root))
		throw new Error(
			`refusing to write ${target.path}: not under LIVE_LIBRARY_ROOT (${root ?? "unset"})`,
		);
	const { track, subsong } = target;
	return component("/api/tags", {
		method: "POST",
		body: JSON.stringify({ track, subsong, fields: { rating } }),
	});
};

export const capabilities = () =>
	component<{
		canWrite: boolean;
		canWritePlaylists: boolean;
		canChangeOutput: boolean;
		allowedFields: string[];
		playbackModes: PlaybackMode[];
	}>("/api/capabilities");

export const copyToNewPlaylist = (
	title: string,
	source: string,
	rows: number,
) =>
	component<Playlist>("/api/playlists", {
		method: "POST",
		body: JSON.stringify({ title, source, runs: [[0, rows]] }),
	});

export const copyRowsInto = async (
	id: string,
	source: string,
	rows: number,
) => {
	const response = await fetchPatiently(
		`${COMPONENT()}/api/playlists/${id}/items/copy`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source, runs: [[0, rows]] }),
		},
	);
	await response.body?.cancel();
	return response.status;
};

export const removePlaylist = (id: string) =>
	component<void>(`/api/playlists/${id}`, { method: "DELETE" });

export const playRow = (id: string, index: number) =>
	component<void>(`/api/playlists/${id}/items/${index}/play`, {
		method: "POST",
	});

export const send = (path: string, body?: unknown) =>
	component<void>(path, {
		method: "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

export interface PlayerState {
	playback: PlaybackState;
	path: string;
	subsong: number;
	libraryPath: string | null;
	position: { seconds: number; ageSeconds: number };
	volume: number;
	muted: boolean;
	playbackMode: PlaybackMode;
	title: string | null;
	artist: string | null;
	playingLocation: { playlistId: string; index: number } | null;
	currentPlaylistId: string | null;
	outputDeviceId: string | null;
}

export const state = () =>
	component<{ player: PlayerState; library: { ready: boolean } }>("/api/state");

export const player = async () => (await state()).player;

export interface OutputDevice {
	id: string;
	name: string;
}

export const outputs = () =>
	component<{ devices: OutputDevice[]; active: string | null }>("/api/outputs");

// Answers the status rather than throwing on a refusal, since a refusal is what some cases ask for.
export const switchOutput = async (deviceId: string) => {
	const response = await fetchPatiently(`${COMPONENT()}/api/outputs/active`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ deviceId }),
	});
	const body = await response.text();
	return {
		status: response.status,
		error: body ? (JSON.parse(body) as { error: string }).error : null,
	};
};
