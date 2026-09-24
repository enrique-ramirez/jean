import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

// A parsed JSON request body, or null when there was none or it did not parse.
// Loose on purpose: the router reads whatever field a route expects.
// biome-ignore lint/suspicious/noExplicitAny: see above
type RequestBody = Record<string, any> | null;

interface ControlRequest {
	state: FakeState;
	method: string;
	path: string;
	body: RequestBody;
	response: Responder;
}

// Answers with the named file under `artwork/`, or 404s. A file on disk for the
// suite, a bundled asset for the demo.
export type ArtworkServer = (
	name: string,
	headers: RequestHeaders,
	response: Responder,
	cacheControl: string,
) => boolean | Promise<boolean>;

export function handleControl({
	state,
	method,
	path,
	body,
	response,
}: ControlRequest) {
	const action = path.replace("/__control/", "");

	const input = body ?? {};

	if (action === "state") {
		if (method === "POST") {
			// Switches GET /api/state's refusal mid-test, unlike `failWrites`,
			// which only takes effect at fixture construction. Omitting the field
			// (or sending it null) turns the refusal back off.
			state.fooJean.failState =
				typeof input.failState === "number" ? input.failState : null;
			return empty(response);
		}
		return json(response, {
			player: state.player,
			playlists: state.playlists.map((entry) => ({
				id: entry.id,
				title: entry.title,
				isCurrent: entry.isCurrent,
				itemCount: entry.items.length,
			})),
			playQueue: state.queuePayload(),
			requests: state.requests,
		});
	}

	if (action === "play") {
		state.playItem(input.playlistId, input.index);
		return empty(response);
	}

	if (action === "append") {
		return state.copyItems(input.sourceId, input.targetId, input.items)
			? empty(response)
			: empty(response, 404);
	}

	if (action === "removeItems") {
		return state.removeItems(input.playlistId, input.items ?? [])
			? empty(response)
			: empty(response, 404);
	}

	if (action === "latency") {
		state.latency = Number(input?.ms) || 0;
		return empty(response);
	}

	if (action === "writePlaylists") {
		state.fooJean.canWritePlaylists = input.canWrite !== false;
		return empty(response);
	}

	if (action === "lockPlaylist") {
		const id = String(input.id ?? "");
		if (input.locked) state.fooJean.lockedPlaylists.add(id);
		else state.fooJean.lockedPlaylists.delete(id);
		return empty(response);
	}

	// Switches every playlist write's refusal mid-test, the same pattern
	// `/__control/state`'s `failState` uses for `GET /api/state`. Omitting the
	// field (or sending it null) turns the refusal back off.
	if (action === "failPlaylistWrites") {
		state.fooJean.failPlaylistWrites =
			typeof input.status === "number" ? input.status : null;
		return empty(response);
	}

	if (action === "skipGap") {
		state.skipGapMs = Number(input?.ms) || 0;
		return empty(response);
	}

	return empty(response, 404);
}
