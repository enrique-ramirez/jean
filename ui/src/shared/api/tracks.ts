import {
	type Answer,
	ask,
	demand,
	READ_TIMEOUT_MS,
	type Schema,
	tooFast,
	WRITE_TIMEOUT_MS,
} from "./client";
import type { TrackAddress } from "./types";

export type LibraryTrack = Schema["LibraryTrack"];
export type PlayingTrackColumns = Schema["PlayingTrackColumns"];

export type LibraryTrackAddress = Extract<
	TrackAddress,
	{ kind: "library" | "ordinal" }
>;

const addressQuery = (address: LibraryTrackAddress) =>
	address.kind === "library"
		? { track: address.track, subsong: address.subsong }
		: { ordinal: address.ordinal, structure: address.structure };

const refusingTooFast = async <T>(answer: Promise<Answer<T>>) => {
	const { response } = await answer;
	if (response.status === 429) throw tooFast(response);
	return demand(answer);
};

// foo_jean sends a library delta when it notices a change rather than when a client asks, so this is
// the only way to read one track's current values back.
export const fetchLibraryTrack = (
	origin: string,
	address: LibraryTrackAddress,
	columns: readonly string[],
) =>
	refusingTooFast(
		ask(origin, WRITE_TIMEOUT_MS, (api, init) =>
			api.GET("/track/library", {
				...init,
				params: { query: { ...addressQuery(address), columns: [...columns] } },
			}),
		),
	);

export const fetchPlayingTrack = (
	origin: string,
	columns: readonly string[],
	{ signal }: { signal?: AbortSignal } = {},
) =>
	refusingTooFast(
		ask(
			origin,
			READ_TIMEOUT_MS,
			(api, init) =>
				api.GET("/track/playing", {
					...init,
					params: { query: { columns: [...columns] } },
				}),
			signal,
		),
	);
