import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json } from "../http.ts";
import {
	DETACHED_PLAYBACK_MODES,
	type DetachedSession,
	ENGINE_SESSION_ID,
} from "../sessions.ts";
import { NO_SUCH_SESSION, notFound } from "./answers.ts";
import { createsSessions } from "./connection.ts";
import { labelOf, readDeviceIdentity } from "./deviceIdentity.ts";
import type { FooJeanFake } from "./options.ts";
import { playbackModesOf } from "./playbackModes.ts";
import type { AskedBeforeItsSession, FakeState } from "./request.ts";
import { addressOf, namesOf, playerSectionOf } from "./statePoll.ts";
import { engineRoster } from "./stream.ts";

export const SESSION_BY_ID = /^\/api\/sessions\/([^/]+)$/;

const SESSIONS_UNAVAILABLE = { error: "sessions are not available" };
const TOO_MANY_SESSIONS = { error: "too many sessions" };
const DEVICE_ID_REQUIRED = { error: "'deviceId' is required" };
const SHARED_NOT_BOOLEAN = { error: "'shared' must be true or false" };
const ENGINE_UNCHANGEABLE = { error: "the engine session cannot be changed" };

const engineDocumentOf = (state: FakeState, fake: FooJeanFake) => {
	const player = playerSectionOf(state, fake);
	return {
		id: ENGINE_SESSION_ID,
		kind: "engine",
		shared: true,
		playback: player.playback,
		title: player.title,
		artist: player.artist,
		album: player.album,
		albumArtist: player.albumArtist,
		libraryPath: player.libraryPath,
		listeners: engineRoster(state, fake).length,
		playbackModes: playbackModesOf(state),
		chainDropped: false,
		reports: [],
		createdBy: null,
	};
};

const sessionDocumentOf = (
	state: FakeState,
	fake: FooJeanFake,
	session: DetachedSession,
) => {
	const track = session.playingTrack();
	return {
		id: session.id,
		kind: "detached",
		shared: session.shared,
		playback: session.playback(),
		...namesOf(track),
		libraryPath: addressOf(state, fake, track).libraryPath,
		listeners: session.roster().length,
		playbackModes: [...DETACHED_PLAYBACK_MODES],
		chainDropped: session.chainDropped,
		reports: session.reports.map(({ sequence, kind, track: on }) => ({
			sequence,
			kind,
			...addressOf(state, fake, on),
		})),
		createdBy: session.createdBy,
	} satisfies components["schemas"]["Session"];
};

// `POST` and `GET /api/sessions`, and `GET` and `POST /api/sessions/{id}`, in the order
// `foo_jean`'s `routes_sessions.cpp` refuses them.
export function handleSessions({
	state,
	fake,
	method,
	path,
	url,
	body,
	response,
}: AskedBeforeItsSession) {
	const deviceId = labelOf(url.searchParams.get("deviceId"));

	if (path === "/api/sessions" && method === "GET")
		return json(response, {
			sessions: [
				engineDocumentOf(state, fake),
				...state.sessions
					.list()
					.filter((session) => session.sees(deviceId))
					.map((session) => sessionDocumentOf(state, fake, session)),
			],
		});

	if (path === "/api/sessions" && method === "POST") {
		const identity = readDeviceIdentity(body);
		if (!identity.ok) return json(response, { error: identity.refusal }, 400);
		if (!identity.device.deviceId)
			return json(response, DEVICE_ID_REQUIRED, 400);
		if (!createsSessions(fake))
			return json(response, SESSIONS_UNAVAILABLE, 503);
		if (state.sessions.count >= fake.maxSessions)
			return json(response, TOO_MANY_SESSIONS, 503);
		const created = state.sessions.create(identity.device);
		return json(response, sessionDocumentOf(state, fake, created));
	}

	const id = SESSION_BY_ID.exec(path)?.[1] ?? "";

	if (id && method === "GET") {
		if (id === ENGINE_SESSION_ID)
			return json(response, engineDocumentOf(state, fake));
		const session = state.sessions.visible(id, deviceId);
		if (!session) return json(response, NO_SUCH_SESSION, 404);
		return json(response, sessionDocumentOf(state, fake, session));
	}

	if (id && method === "POST") {
		if (id === ENGINE_SESSION_ID)
			return json(response, ENGINE_UNCHANGEABLE, 409);
		if (!deviceId) return json(response, DEVICE_ID_REQUIRED, 400);
		const session = state.sessions.visible(id, deviceId);
		if (!session) return json(response, NO_SUCH_SESSION, 404);
		const shared = (body as { shared?: unknown } | null)?.shared;
		if (typeof shared !== "boolean")
			return json(response, SHARED_NOT_BOOLEAN, 400);
		session.join(deviceId);
		session.share(shared);
		return json(response, sessionDocumentOf(state, fake, session));
	}

	return notFound(response);
}
