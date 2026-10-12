import { fieldsOf, textOf } from "@/shared/lib/untrusted";

export interface LrclibRecord {
	id: number;
	trackName: string;
	artistName: string;
	albumName: string;
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
}

export type LrclibKind = "synced" | "plain" | "instrumental";

export type LrclibAnswer =
	| { ok: true; value: LrclibRecord[] }
	| { ok: false; error: "failed" | "busy" };

const SEARCH_URL = "https://lrclib.net/api/search";
const PROJECT_PAGE = "https://github.com/enrique-ramirez/jean";
const DEADLINE_MS = 10_000;
const UNSTATED_RETRY_AFTER_MS = 60_000;

const KIND_ORDER: Record<LrclibKind, number> = {
	synced: 0,
	plain: 1,
	instrumental: 2,
};

export const kindOf = (record: LrclibRecord): LrclibKind => {
	if (record.instrumental) return "instrumental";
	return record.syncedLyrics ? "synced" : "plain";
};

export function rankRecords(
	records: LrclibRecord[],
	trackDuration: number | null,
): LrclibRecord[] {
	const distance = (record: LrclibRecord) =>
		trackDuration === null ? 0 : Math.abs(record.duration - trackDuration);
	return [...records].sort(
		(a, b) =>
			KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)] ||
			distance(a) - distance(b),
	);
}

function recordOf(entry: unknown): LrclibRecord[] {
	const sent = fieldsOf(entry);
	const { id, duration } = sent;
	const trackName = textOf(sent.trackName);
	const artistName = textOf(sent.artistName);
	if (
		typeof id !== "number" ||
		typeof duration !== "number" ||
		trackName === null ||
		artistName === null
	)
		return [];

	return [
		{
			id,
			trackName,
			artistName,
			albumName: textOf(sent.albumName) ?? "",
			duration,
			instrumental: sent.instrumental === true,
			plainLyrics: textOf(sent.plainLyrics),
			syncedLyrics: textOf(sent.syncedLyrics),
		},
	];
}

// LRCLIB bans clients that keep sending after a 429 or 503.
let silentUntil = 0;

// Retry-After is either a count of seconds or an HTTP date.
const retryAfterMs = (header: string | null) => {
	if (header === null) return UNSTATED_RETRY_AFTER_MS;
	const seconds = Number(header);
	if (header.trim() !== "" && Number.isFinite(seconds)) return seconds * 1_000;
	const date = Date.parse(header);
	return Number.isNaN(date)
		? UNSTATED_RETRY_AFTER_MS
		: Math.max(0, date - Date.now());
};

export async function searchLrclib(
	query: { title: string; artist: string },
	options: { version: string; signal?: AbortSignal },
): Promise<LrclibAnswer> {
	if (Date.now() < silentUntil) return { ok: false, error: "busy" };

	const url = new URL(SEARCH_URL);
	url.searchParams.set("track_name", query.title);
	url.searchParams.set("artist_name", query.artist);

	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
	const signal = options.signal
		? AbortSignal.any([options.signal, deadline.signal])
		: deadline.signal;

	try {
		const response = await fetch(url, {
			signal,
			referrerPolicy: "no-referrer",
			headers: {
				Accept: "application/json",
				"Lrclib-Client": `Jean ${options.version} (${PROJECT_PAGE})`,
			},
		});
		if (response.status === 429 || response.status === 503) {
			silentUntil =
				Date.now() + retryAfterMs(response.headers.get("Retry-After"));
			return { ok: false, error: "busy" };
		}
		if (!response.ok) return { ok: false, error: "failed" };
		const body: unknown = await response.json();
		if (!Array.isArray(body)) return { ok: false, error: "failed" };
		return { ok: true, value: body.flatMap(recordOf) };
	} catch {
		return { ok: false, error: "failed" };
	} finally {
		clearTimeout(timer);
	}
}
