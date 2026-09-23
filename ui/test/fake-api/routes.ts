import { discoveryRecord } from "./fooJean.ts";
import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

interface UpdatePayload {
	player?: unknown;
	playlists?: unknown;
	playQueue?: unknown;
}

// A parsed JSON request body, or null when there was none or it did not parse.
// Loose on purpose: the router reads whatever field a route expects.
// biome-ignore lint/suspicious/noExplicitAny: see above
type RequestBody = Record<string, any> | null;

interface ApiRequest {
	state: FakeState;
	method: string;
	path: string;
	url: URL;
	body: RequestBody;
	headers: RequestHeaders;
	response: Responder;
	agentPort: number;
	artwork: ArtworkServer;
}

// Answers with the named file under `artwork/`, or 404s. A file on disk for the
// suite, a bundled asset for the demo. The cache terms are the route's: beefweb
// and the component do not agree about them.
export type ArtworkServer = (
	name: string,
	headers: RequestHeaders,
	response: Responder,
	cacheControl: string,
) => boolean | Promise<boolean>;

export const BEEFWEB_ARTWORK_CACHING = "max-age=3, must-revalidate";

const parseColumns = (value: string | null) => (value ? value.split(",") : []);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleApi({
	state,
	method,
	path,
	url,
	body,
	headers,
	response,
	agentPort,
	artwork,
}: ApiRequest) {
	const segments = path.split("/").filter(Boolean).slice(1);
	const [head, ...rest] = segments;

	if (method === "POST" && state.latency > 0) await delay(state.latency);

	if (method === "GET" && head === "query" && rest[0] === "updates") {
		return streamUpdates({ state, url, response });
	}

	if (head === "player") {
		if (method === "GET") {
			return json(response, { player: { ...state.playerPayload() } });
		}
		if (method === "POST" && rest.length === 0) {
			state.patchPlayer(body ?? {});
			return empty(response);
		}
		if (method === "POST" && rest[0] === "play" && rest.length === 3) {
			state.playItem(rest[1], Number(rest[2]));
			return empty(response);
		}
		if (method === "POST" && rest[0] === "play-pause") {
			state.playPause();
			return empty(response);
		}
		if (method === "POST" && rest[0] === "next") {
			state.next();
			return empty(response);
		}
		if (method === "POST" && rest[0] === "previous") {
			state.previous();
			return empty(response);
		}
		if (method === "POST" && rest[0] === "stop") {
			state.stop();
			return empty(response);
		}
		if (method === "POST" && rest[0] === "volume") {
			state.nudgeVolume(rest[1] === "up" ? 1 : -1);
			return empty(response);
		}
	}

	if (head === "library") {
		if (method === "GET" && rest[0] === "info")
			return json(response, state.libraryInfo());

		if (!state.library.supported) return empty(response, 501);

		const range = url.searchParams.get("range");
		const [offset, count] = range ? range.split(":").map(Number) : [0, null];
		const expressions = parseColumns(url.searchParams.get("columns"));

		if (url.searchParams.get("query")) {
			return json(
				response,
				{ error: "the fake does not implement player query syntax" },
				400,
			);
		}

		if (method === "GET" && rest[0] === "items" && rest[1] === "by-path") {
			const payload = state.libraryNodesPayload({
				path: url.searchParams.get("path") ?? "",
				offset,
				count,
				expressions,
			});
			return payload
				? json(response, payload)
				: json(response, { error: "no such folder" }, 404);
		}

		if (method === "GET" && rest[0] === "items" && rest.length === 1) {
			const sort = url.searchParams.get("sort");
			// Bare %field% only. The real player takes any title-format expression;
			// evaluating those is a player's job.
			if (sort && !/^%[^%]+%$/.test(sort)) {
				return json(
					response,
					{ error: "the fake only sorts by a bare %field%" },
					400,
				);
			}
			return json(
				response,
				state.libraryItemsPayload({
					offset,
					count,
					expressions,
					sort,
					desc: url.searchParams.get("desc") === "true",
				}),
			);
		}
	}

	if (head === "playlists") {
		if (
			method === "POST" &&
			rest.length === 3 &&
			rest[1] === "items" &&
			rest[2] === "add-from-library"
		) {
			if (!state.library.supported) return empty(response, 501);
			return state.addFromLibrary(rest[0], body ?? {})
				? empty(response)
				: empty(response, 404);
		}

		if (
			method === "POST" &&
			rest.length === 3 &&
			rest[1] === "items" &&
			rest[2] === "remove"
		) {
			return state.removeItems(rest[0], body?.items ?? [])
				? empty(response)
				: empty(response, 404);
		}
	}

	if (method === "POST" && head === "playqueue" && rest[0] === "add") {
		if (!body || !Number.isInteger(body.itemIndex))
			return json(response, { error: "itemIndex" }, 400);
		return state.queueAdd(body.plref, body.itemIndex)
			? empty(response)
			: empty(response, 404);
	}

	if (method === "POST" && head === "playqueue" && rest[0] === "remove") {
		const hasPair =
			typeof body?.plref === "string" && Number.isInteger(body?.itemIndex);
		if (!body || (!Number.isInteger(body.queueIndex) && !hasPair))
			return json(response, { error: "queueIndex" }, 400);
		return state.queueRemove(body) ? empty(response) : empty(response, 404);
	}

	if (method === "POST" && head === "playqueue" && rest[0] === "clear") {
		state.queueClear();
		return empty(response);
	}

	if (method === "GET" && head === "playqueue") {
		return json(response, {
			playQueue: state.queuePayload(
				parseColumns(url.searchParams.get("columns")),
			),
		});
	}

	// `null` here is a real answer, not an error: it says nothing is stored under
	// this id, not that the request failed. The component writes this file on
	// every start and removes it on a clean shutdown, so absent is common.
	if (method === "GET" && head === "clientconfig") {
		if (rest[0] !== "foo_jean") return json(response, null);
		return json(response, discoveryRecord(state.fooJean, agentPort));
	}

	if (method === "GET" && head === "artwork" && rest[0] === "library") {
		if (!state.library.supported) return empty(response, 501);
		const file = state.libraryArtworkFor(url.searchParams.get("path") ?? "");
		if (!file) return empty(response, 404);
		return artwork(file, headers, response, BEEFWEB_ARTWORK_CACHING);
	}

	if (method === "GET" && head === "artwork" && rest.length === 2) {
		const file = state.artworkFor(rest[0], Number(rest[1]));
		if (!file) return empty(response, 404);
		return artwork(file, headers, response, BEEFWEB_ARTWORK_CACHING);
	}

	return false;
}

function streamUpdates({
	state,
	url,
	response,
}: Pick<ApiRequest, "state" | "url" | "response">) {
	const qcolumns = parseColumns(url.searchParams.get("qcolumns"));
	const wantsPlayer = url.searchParams.get("player") === "true";
	const wantsQueue = url.searchParams.get("playQueue") === "true";

	response.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});

	const send = (payload: UpdatePayload) =>
		response.write(`data: ${JSON.stringify(payload)}\n\n`);

	const snapshot: UpdatePayload = {};
	if (wantsPlayer) snapshot.player = state.playerPayload();
	if (wantsQueue) snapshot.playQueue = state.queuePayload(qcolumns);
	send(snapshot);

	const unsubscribe = state.subscribe((changed) => {
		const payload: UpdatePayload = {};
		if (changed.player && wantsPlayer) payload.player = state.playerPayload();
		if (changed.playQueue && wantsQueue)
			payload.playQueue = state.queuePayload(qcolumns);
		if (Object.keys(payload).length > 0) send(payload);
	});

	const drop = () => {
		unsubscribe();
		state.updateStreams.delete(drop);
		response.end();
	};
	state.updateStreams.add(drop);

	response.on("close", () => {
		unsubscribe();
		state.updateStreams.delete(drop);
	});
	return true;
}

export function handleControl({
	state,
	method,
	path,
	body,
	response,
}: Pick<ApiRequest, "state" | "method" | "path" | "body" | "response">) {
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

	if (action === "dropStream") {
		const dropped = state.updateStreams.size;
		for (const drop of [...state.updateStreams]) drop();
		return json(response, { dropped });
	}

	if (action === "requests") {
		state.requests.length = 0;
		return empty(response);
	}

	return empty(response, 404);
}
