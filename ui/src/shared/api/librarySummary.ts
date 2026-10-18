import {
	ask,
	READ_TIMEOUT_MS,
	reach,
	refusalOf,
	retryAfterMs,
	type Schema,
} from "./client";
import {
	type ReadFailure,
	type ReadFailureReason,
	readFailed,
} from "./readFailure";

export type LibrarySummary = Schema["LibrarySummary"];
export type SummaryAlbum = Schema["SummaryAlbum"];
export type SummaryTrack = Schema["SummaryTrack"];
export type SummaryShelf = Schema["SummaryShelf"];
export type SummaryArtist = Schema["SummaryArtist"];

export type SummaryRole =
	| "trackNumber"
	| "discNumber"
	| "title"
	| "artist"
	| "album"
	| "albumArtist"
	| "duration"
	| "playCount"
	| "lastPlayed"
	| "rating"
	| "year"
	| "genre"
	| "codec"
	| "bitrate"
	| "playCountLocal"
	| "lastPlayedLocal"
	| "added";

export type SummaryRoles = Record<SummaryRole, string>;

export type SummaryResult =
	| { ok: true; kind: "unchanged" }
	| { ok: true; kind: "summary"; summary: LibrarySummary; tag: string | null }
	| ReadFailure;

const SUMMARY_REFUSALS: Partial<Record<number, ReadFailureReason>> = {
	202: "notReady",
	400: "refused",
	409: "undeclared",
	413: "refused",
	429: "tooFast",
	503: "unavailable",
};

export async function fetchLibrarySummary(
	origin: string,
	roles: SummaryRoles,
	tag: string | null,
	signal?: AbortSignal,
): Promise<SummaryResult> {
	const answer = await reach(
		ask(
			origin,
			READ_TIMEOUT_MS,
			(api, init) =>
				api.GET("/library/summary", {
					...init,
					params: { query: roles },
					headers: tag ? { "If-None-Match": tag } : undefined,
					cache: "no-store",
				}),
			signal,
		),
		signal,
	);
	if (!answer) return readFailed("unreachable");
	const { data, error, response } = answer;

	if (response.status === 304) return { ok: true, kind: "unchanged" };

	const refusal = SUMMARY_REFUSALS[response.status];
	if (refusal) {
		const { error: said, message } = refusalOf(response, error);
		return readFailed(
			refusal,
			said ? message : "",
			refusal === "tooFast" ? retryAfterMs(response) : null,
		);
	}
	if (!data) return readFailed("failed", `HTTP ${response.status}`);

	return {
		ok: true,
		kind: "summary",
		summary: data as LibrarySummary,
		tag: response.headers.get("ETag"),
	};
}
