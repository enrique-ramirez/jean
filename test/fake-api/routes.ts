import { discoveryRecord } from "./fooJean.ts";
import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { createState } from "./state.ts";

// The routes, with no host in them. `server.ts` wires them to a node socket for
// the suite; the demo build's service worker wires the same ones to a `fetch`
// event.

type FakeState = ReturnType<typeof createState>;

// beefweb's update-stream payload: each key is present only when that part
// changed.
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
	// Known only after `listen`, so it is read per request rather than stored.
	agentPort: number;
	artwork: ArtworkServer;
}

// Answers with the named file under `artwork/`, or 404s. A file on disk for the
// suite, a bundled asset for the demo.
export type ArtworkServer = (
	name: string,
	headers: RequestHeaders,
	response: Responder,
) => boolean | Promise<boolean>;

// beefweb splits the comma-joined columns parameter before evaluating it, which
// is why a multi-argument title-format function such as $if(a,b,c) is unusable
// as a column. Split the same way, so it breaks here too.
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

	// Against an in-memory player every request settles before the next pointer
	// event; a real one does not.
	if (method === "POST" && state.latency > 0) await delay(state.latency);

	// ---- streaming -------------------------------------------------------
	if (method === "GET" && head === "query" && rest[0] === "updates") {
		return streamUpdates({ state, url, response });
	}

	if (method === "GET" && head === "query") {
		const trcolumns = parseColumns(url.searchParams.get("trcolumns"));
		const qcolumns = parseColumns(url.searchParams.get("qcolumns"));
		const payload: UpdatePayload = {};
		if (url.searchParams.get("player") === "true")
			payload.player = state.playerPayload(trcolumns);
		if (url.searchParams.get("playlists") === "true")
			payload.playlists = state.playlistsPayload();
		// `qcolumns` is the spelling that works here, and only here.
		if (url.searchParams.get("playQueue") === "true")
			payload.playQueue = state.queuePayload(qcolumns);
		return json(response, payload);
	}

	// ---- player ----------------------------------------------------------
	if (head === "player") {
		if (method === "GET") {
			// Ignores trcolumns and returns an empty columns array, because the real
			// endpoint does. Now-playing text has to come from /api/query.
			return json(response, { player: { ...state.playerPayload([]) } });
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

	// ---- media library (beefweb 0.11+) ------------------------------------
	//
	// `/library/info` always answers, because that is how a client discovers it
	// has no library. Everything else is 501 when the player has no support,
	// which is what DeaDBeeF does.
	if (head === "library") {
		if (method === "GET" && rest[0] === "info")
			return json(response, state.libraryInfo());

		if (!state.library.supported) return empty(response, 501);

		// `range` is a query parameter here, not a path segment as it is for
		// playlist items, and it is optional: everything is returned without it.
		const range = url.searchParams.get("range");
		const [offset, count] = range ? range.split(":").map(Number) : [0, null];
		const expressions = parseColumns(url.searchParams.get("columns"));

		// The player's own query syntax, which is not the token matching Jean does
		// client-side. Refused rather than approximated.
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

	// ---- playlists -------------------------------------------------------
	if (head === "playlists") {
		if (method === "GET" && rest.length === 0) {
			return json(response, { playlists: state.playlistsPayload() });
		}

		if (method === "GET" && rest.length === 3 && rest[1] === "items") {
			const [offset, count] = rest[2].split(":").map(Number);
			const payload = state.itemsPayload(
				rest[0],
				offset,
				count,
				parseColumns(url.searchParams.get("columns")),
			);
			return payload
				? json(response, payload)
				: json(response, { error: "no such playlist" }, 404);
		}

		if (method === "POST" && rest[0] === "add") {
			return json(
				response,
				state.addPlaylist(url.searchParams.get("title") ?? ""),
			);
		}

		if (method === "POST" && rest[0] === "remove" && rest.length === 2) {
			return state.removePlaylist(rest[1])
				? empty(response)
				: empty(response, 404);
		}

		if (method === "POST" && rest[0] === "move" && rest.length === 3) {
			return state.movePlaylist(rest[1], Number(rest[2]))
				? empty(response)
				: empty(response, 404);
		}

		if (
			method === "POST" &&
			rest.length === 3 &&
			rest[1] === "items" &&
			rest[2] === "sort"
		) {
			return state.sortItems(rest[0], { by: "%path%", ...body })
				? empty(response)
				: empty(response, 404);
		}

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
			rest.length === 4 &&
			rest[2] === "items" &&
			rest[3] === "copy"
		) {
			return state.copyItems(rest[0], rest[1], body?.items ?? [])
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

		if (method === "POST" && rest.length === 1) {
			return state.renamePlaylist(rest[0], body?.title ?? "")
				? empty(response)
				: empty(response, 404);
		}
	}

	if (method === "POST" && head === "playqueue" && rest[0] === "add") {
		// One item per request, and no bulk form: on the live player both
		// {items:[...]} and an array itemIndex come back 400.
		if (!body || !Number.isInteger(body.itemIndex))
			return json(response, { error: "itemIndex" }, 400);
		return state.queueAdd(body.plref, body.itemIndex)
			? empty(response)
			: empty(response, 404);
	}

	if (method === "POST" && head === "playqueue" && rest[0] === "remove") {
		// The live player's words: "either queueIndex or plref plus itemIndex
		// parameters are required". A bulk `items` array is a 400 here too.
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
		// `columns` here, NOT `qcolumns` -- that spelling only works on /api/query,
		// and asking the wrong one is a blank panel rather than an error.
		return json(response, {
			playQueue: state.queuePayload(
				parseColumns(url.searchParams.get("columns")),
			),
		});
	}

	// ---- client config ---------------------------------------------------
	//
	// `null` is a real answer rather than a 404. The component writes this file on
	// every start and removes it on a clean shutdown, so absent is common.
	if (method === "GET" && head === "clientconfig") {
		if (rest[0] !== "foo_jean") return json(response, null);
		return json(response, discoveryRecord(state.fooJean, agentPort));
	}

	// ---- artwork ---------------------------------------------------------
	if (method === "GET" && head === "artwork" && rest[0] === "library") {
		if (!state.library.supported) return empty(response, 501);
		const file = state.libraryArtworkFor(url.searchParams.get("path") ?? "");
		if (!file) return empty(response, 404);
		return artwork(file, headers, response);
	}

	if (method === "GET" && head === "artwork" && rest.length === 2) {
		const file = state.artworkFor(rest[0], Number(rest[1]));
		// 404 is the normal answer for a track with no embedded cover, not an error.
		if (!file) return empty(response, 404);
		return artwork(file, headers, response);
	}

	return false;
}

// beefweb's stream: a full snapshot on connect, then a message whenever
// something changes, carrying only the parts that changed. No heartbeat and no
// position ticks -- long silences are normal.
function streamUpdates({
	state,
	url,
	response,
}: Pick<ApiRequest, "state" | "url" | "response">) {
	const trcolumns = parseColumns(url.searchParams.get("trcolumns"));
	const qcolumns = parseColumns(url.searchParams.get("qcolumns"));
	const wantsPlayer = url.searchParams.get("player") === "true";
	const wantsPlaylists = url.searchParams.get("playlists") === "true";
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
	if (wantsPlayer) snapshot.player = state.playerPayload(trcolumns);
	if (wantsPlaylists) snapshot.playlists = state.playlistsPayload();
	if (wantsQueue) snapshot.playQueue = state.queuePayload(qcolumns);
	send(snapshot);

	const unsubscribe = state.subscribe((changed) => {
		const payload: UpdatePayload = {};
		if (changed.player && wantsPlayer)
			payload.player = state.playerPayload(trcolumns);
		if (changed.playlists && wantsPlaylists)
			payload.playlists = state.playlistsPayload();
		if (changed.playQueue && wantsQueue)
			payload.playQueue = state.queuePayload(qcolumns);
		if (Object.keys(payload).length > 0) send(payload);
	});

	response.on("close", unsubscribe);
	return true;
}

export function handleControl({
	state,
	path,
	body,
	response,
}: Pick<ApiRequest, "state" | "path" | "body" | "response">) {
	const action = path.replace("/__control/", "");

	const input = body ?? {};

	if (action === "state") {
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

	// The desktop reaching into a playlist while Jean is looking at it. Undo holds
	// a range of indices that is only correct while nothing else has touched it.
	if (action === "append") {
		return state.copyItems(input.sourceId, input.targetId, input.items)
			? empty(response)
			: empty(response, 404);
	}

	if (action === "latency") {
		state.latency = Number(input?.ms) || 0;
		return empty(response);
	}

	if (action === "requests") {
		state.requests.length = 0;
		return empty(response);
	}

	return empty(response, 404);
}
