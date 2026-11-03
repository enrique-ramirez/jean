import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import {
	NO_SUCH_SESSION,
	notFound,
	PLAYER_REFUSED,
} from "./fooJean/answers.ts";
import { handleArtwork } from "./fooJean/artwork.ts";
import { handleAutoPlaylists } from "./fooJean/autoPlaylists.ts";
import { handleConnection } from "./fooJean/connection.ts";
import { labelOf } from "./fooJean/deviceIdentity.ts";
import { deliveredAfter, latencyOf } from "./fooJean/latency.ts";
import { handleLibrary, handlePlayingTrack } from "./fooJean/library.ts";
import { handleOutputs } from "./fooJean/outputs.ts";
import { handlePlayback } from "./fooJean/playback.ts";
import {
	handlePlaylistReads,
	isPlaylistRead,
} from "./fooJean/playlistReads.ts";
import { handlePlaylistRows } from "./fooJean/playlistRows.ts";
import { handlePlaylists } from "./fooJean/playlists.ts";
import { handleQueue } from "./fooJean/queue.ts";
import { bucketOf, refuseTooFast, spend } from "./fooJean/rateLimits.ts";
import type { FakeState } from "./fooJean/request.ts";
import { handleSessions, SESSION_BY_ID } from "./fooJean/sessions.ts";
import { handleState } from "./fooJean/statePoll.ts";
import { handleStream } from "./fooJean/stream.ts";
import { handleTags } from "./fooJean/tags.ts";
import { json, one, type RequestHeaders, type Responder } from "./http.ts";
import type { ArtworkServer } from "./routes.ts";
import { type DetachedSession, ENGINE_SESSION_ID } from "./sessions.ts";
import type { RecordedRequest } from "./state.ts";

const recordingStatus = (
	response: Responder,
	recorded: RecordedRequest,
): Responder => ({
	writeHead: (status, headers) => {
		recorded.status = status;
		return response.writeHead(status, headers);
	},
	setHeader: (name, value) => response.setHeader(name, value),
	write: (chunk) => response.write(chunk),
	end: (body) => response.end(body),
	on: (event, listener) => response.on(event, listener),
	destroy: () => response.destroy(),
});

// `kMaxBodyBytes` in `plugins/fb2k/src/core/http_server.h`, refused before any
// route reads the body.
export const MAX_BODY_BYTES = 256 * 1024;

const BODY_TOO_LARGE = { error: "request too large" };

// Mirrors core/http_server.cpp's isJsonRequest. See src/shared/api/README.md.
const isJsonContentType = (headers: RequestHeaders) =>
	one(headers["content-type"]).toLowerCase().startsWith("application/json");

const SEND_JSON = { error: "send application/json" };

// The component reflects only an origin listed in its own `allowedOrigins`, empty by
// default, so nothing here is ever reflected: the fake carries no such list to check.
const cors = (response: Responder) => {
	response.setHeader("Vary", "Origin");
};

// Word for word what the component's `core/playlists.cpp` describes for the switch.
const PLAYBACK_DISABLED = {
	error:
		"this install has playback control turned off; turn on controlPlayback in config.json to allow it",
	detail: "",
} satisfies components["schemas"]["PlaylistFailed"];

const PLAYBACK_COMMAND_PATHS = new Set([
	"/api/playback/play",
	"/api/playback/play-pause",
	"/api/playback/pause",
	"/api/playback/resume",
	"/api/playback/next",
	"/api/playback/previous",
	"/api/playback/stop",
	"/api/playback/seek",
	"/api/playback/mode",
	"/api/volume",
]);

const PLAY_ROW_PATH = /^\/api\/playlists\/[^/]+\/items\/\d+\/play$/;
const SCRATCH_ITEMS_PATH = "/api/playlists/own/scratch/items";

// Every route criterion 9 names, checked once rather than at each handler so the
// gate always answers first, ahead of a 400, a 409 or a 503 the route would
// otherwise reach for.
const needsPlaybackControl = (method: string, path: string): boolean => {
	if (method === "POST" && PLAYBACK_COMMAND_PATHS.has(path)) return true;
	if (method === "POST" && PLAY_ROW_PATH.test(path)) return true;
	if (method !== "GET" && path.startsWith("/api/queue")) return true;
	if ((method === "POST" || method === "DELETE") && path === SCRATCH_ITEMS_PATH)
		return true;
	return false;
};

// Every route `contract/openapi.yaml` gives the `session` parameter.
const SESSION_SCOPED: [string, RegExp][] = [
	["GET", /^\/api\/state$/],
	["POST", PLAY_ROW_PATH],
	[
		"POST",
		/^\/api\/playback\/(play|play-pause|pause|resume|next|previous|stop|seek|mode)$/,
	],
	["GET", /^\/api\/queue$/],
	["POST", /^\/api\/queue$/],
	["DELETE", /^\/api\/queue$/],
	["POST", /^\/api\/queue\/move$/],
	["DELETE", /^\/api\/queue\/[^/]+$/],
	["GET", /^\/api\/track\/playing$/],
	["GET", /^\/api\/artwork\/playing$/],
	["POST", /^\/api\/stream\/ticket$/],
	["GET", /^\/api\/stream\/listeners$/],
	["POST", /^\/api\/stream\/leave$/],
	["GET", /^\/api\/stream\/timeline$/],
];

const isSessionScoped = (method: string, path: string) =>
	SESSION_SCOPED.some(
		([verb, pattern]) => verb === method && pattern.test(path),
	);

// These two read the device from the body, and `foo_jean` judges the body before the session.
const DEVICE_IN_BODY = new Set(["/api/stream/ticket", "/api/stream/leave"]);

const PLAYLIST_ROWS_PATH = /^\/api\/playlists\/.+\/items(\/|$)/;

export async function handleFooJean({
	state,
	method,
	url,
	headers,
	body,
	bodyBytes = 0,
	client = "",
	response: socket,
	artwork,
}: {
	state: FakeState;
	method: string;
	url: URL;
	headers: RequestHeaders;
	body: unknown;
	bodyBytes?: number;
	// The source address, which `foo_jean` keys its state-poll budget by.
	client?: string;
	response: Responder;
	artwork: ArtworkServer;
}) {
	const fake = state.fooJean;
	const path = url.pathname;

	const recorded = state.record(method, path + url.search, body as never);

	const late = latencyOf(fake, method, path);
	const response = recordingStatus(
		late > 0 ? deliveredAfter(socket, late) : socket,
		recorded,
	);

	cors(response);

	if (method === "OPTIONS") {
		response.writeHead(204);
		return response.end();
	}

	if (bodyBytes > MAX_BODY_BYTES) {
		response.setHeader("Connection", "close");
		return json(response, BODY_TOO_LARGE, 413);
	}

	if (method === "POST" && !isJsonContentType(headers))
		return json(response, SEND_JSON, 415);

	const scoped = isSessionScoped(method, path);
	const named = scoped ? (url.searchParams.get("session") ?? "") : "";
	if (scoped && !named && fake.strictSessions)
		return json(
			response,
			{ error: `strict sessions: ${method} ${path} named no session` },
			500,
		);
	const namesDetached = named !== "" && named !== ENGINE_SESSION_ID;

	if (
		!fake.canControlPlayback &&
		!namesDetached &&
		needsPlaybackControl(method, path)
	)
		return json(response, PLAYBACK_DISABLED, 403);

	const bucket = bucketOf(method, path);
	if (
		bucket &&
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, bucket, client)
	) {
		recorded.limited = bucket;
		return refuseTooFast(response, bucket, path);
	}

	const beforeItsSession = {
		state,
		fake,
		method,
		path,
		url,
		headers,
		body,
		bodyBytes,
		client,
		response,
		recorded,
		named,
		namesDetached,
		artwork,
	};

	if (path === "/api/sessions" || SESSION_BY_ID.test(path))
		return handleSessions(beforeItsSession);

	let session: DetachedSession | null = null;
	if (namesDetached && !DEVICE_IN_BODY.has(path)) {
		const deviceId = labelOf(url.searchParams.get("deviceId"));
		session = state.sessions.visible(named, deviceId);
		if (!session) return json(response, NO_SUCH_SESSION, 404);
		if (path === "/api/state") session.join(deviceId);
	}

	const asked = { ...beforeItsSession, session, addressed: session ?? state };

	if (path === "/api/status" || path === "/api/capabilities")
		return handleConnection(asked);
	if (path === "/api/state") return handleState(asked);

	await state.settledNumbering();
	if (path.startsWith("/api/playback/") || path === "/api/volume")
		return handlePlayback(asked);
	if (path.startsWith("/api/outputs")) return handleOutputs(asked);

	// A write that failed at the player rather than one it refused: a 500, a 429 from the rate
	// limiter, a connection that died. `/api/autoplaylists/preview` is read-only and excluded.
	if (
		fake.failPlaylistWrites &&
		method !== "GET" &&
		(path.startsWith("/api/playlists") || path === "/api/autoplaylists")
	) {
		if (fake.failPlaylistWrites === 429) response.setHeader("Retry-After", "1");
		return json(response, PLAYER_REFUSED, fake.failPlaylistWrites);
	}

	if (path.startsWith("/api/queue")) return handleQueue(asked);
	if (path.startsWith("/api/library/") || path === "/api/track/library")
		return handleLibrary(asked);
	if (path === "/api/track/playing") return handlePlayingTrack(asked);
	if (path.startsWith("/api/artwork")) return handleArtwork(asked);
	if (PLAYLIST_ROWS_PATH.test(path)) return handlePlaylistRows(asked);
	if (isPlaylistRead(method, path)) return handlePlaylistReads(asked);
	if (path.startsWith("/api/playlists")) return handlePlaylists(asked);
	if (path.startsWith("/api/autoplaylists")) return handleAutoPlaylists(asked);
	if (path.startsWith("/api/stream")) return handleStream(asked);
	if (path === "/api/tags") return handleTags(asked);

	return notFound(response);
}
