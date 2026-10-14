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
			// (or sending it null) turns the refusal back off, and the drop and the hang with it.
			try {
				state.fooJean.failState =
					typeof input.failState === "number"
						? (input.failState as FakeState["fooJean"]["failState"])
						: null;
			} catch (refused) {
				return json(response, { error: String(refused) }, 400);
			}
			state.fooJean.dropState = input.dropState === true;
			state.fooJean.hangState = input.hangState === true;
			return empty(response);
		}
		return json(response, {
			player: state.player,
			playlists: state.playlists.map((entry) => ({
				id: entry.id,
				title: entry.title,
				itemCount: entry.items.length,
			})),
			playQueue: state.queuePayload(),
			requests: state.requests,
		});
	}

	// Destroys every `/api/` connection rather than answering one, the way a closed foobar2000 or a
	// player off the network looks to a browser, and admits them again once cleared.
	if (action === "reachable") {
		state.fooJean.reachable = input.reachable !== false;
		return empty(response);
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

	// With a `route`, one route's answers are held back rather than every write:
	// see `routeLatency` in `fooJean/options.ts`. `ms: 0` takes it off again.
	if (action === "latency") {
		const ms = Number(input.ms) || 0;
		if (typeof input.route !== "string") {
			state.latency = ms;
			return empty(response);
		}
		if (ms > 0 || Number(input.jitterMs) > 0)
			state.fooJean.routeLatency[input.route] = {
				ms,
				jitterMs: Number(input.jitterMs) || 0,
			};
		else delete state.fooJean.routeLatency[input.route];
		return empty(response);
	}

	if (action === "writePlaylists") {
		const next = input.canWrite !== false;
		if (next !== state.fooJean.canWritePlaylists)
			state.fooJean.configGeneration += 1;
		state.fooJean.canWritePlaylists = next;
		return empty(response);
	}

	if (action === "controlPlayback") {
		const next = input.canControl !== false;
		if (next !== state.fooJean.canControlPlayback)
			state.fooJean.configGeneration += 1;
		state.fooJean.canControlPlayback = next;
		return empty(response);
	}

	if (action === "changeOutput") {
		const next = input.canChange !== false;
		if (next !== state.fooJean.canChangeOutput)
			state.fooJean.configGeneration += 1;
		state.fooJean.canChangeOutput = next;
		return empty(response);
	}

	// A switch made at the player rather than asked for through `POST /api/outputs/active`, with no
	// other side effect: `configGeneration` does not move, since nothing in `config.json` changed.
	if (action === "activeOutput") {
		state.setActiveOutput(
			typeof input.deviceId === "string" ? input.deviceId : null,
		);
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

	if (action === "libraryHalted") {
		state.fooJean.libraryHalted = input.halted !== false;
		return empty(response);
	}

	if (action === "previewBusy") {
		state.fooJean.previewBusy = Number(input.times) || 0;
		return empty(response);
	}

	if (action === "skipDelay") {
		state.skipDelayMs = Number(input?.ms) || 0;
		return empty(response);
	}

	return empty(response, 404);
}
