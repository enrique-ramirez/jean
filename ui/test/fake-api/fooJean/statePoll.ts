import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json, one } from "../http.ts";
import type { DetachedSession } from "../sessions.ts";
import type { Track } from "../state.ts";
import { evaluate } from "../titleFormat.ts";
import { ASK_EVERY_TIME, notFound } from "./answers.ts";
import { abandoned, STALLED_READ_MS } from "./latency.ts";
import { libraryBuildOf, libraryStateOf, subsongOf } from "./library.ts";
import type { FooJeanFake } from "./options.ts";
import { isSilentOutput } from "./outputs.ts";
import { declaredOrders, jeanModeFor } from "./playbackModes.ts";
import type { Asked, FakeState } from "./request.ts";

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? "";

// Mirrors the title-formatting scripts in `plugins/fb2k/src/fb2k/playback_watch.cpp`: only the
// title falls back to the filename, and a tag the player resolved to nothing crosses the wire as
// `null` rather than as an empty string.
const nameOf = (track: Track) => ({
	title:
		String(track["%title%"] ?? "") ||
		fileNameOf(String(track["%path%"] ?? "")) ||
		null,
	artist: String(track["%artist%"] ?? "") || null,
	album: String(track["%album%"] ?? "") || null,
	albumArtist: String(track["%album artist%"] ?? "") || null,
});

const NOTHING_PLAYING_NAMES = {
	title: null,
	artist: null,
	album: null,
	albumArtist: null,
};

export const namesOf = (track: Track | null) =>
	track ? nameOf(track) : NOTHING_PLAYING_NAMES;

export const addressOf = (
	state: FakeState,
	fake: FooJeanFake,
	track: Track | null,
) => ({
	path: track ? String(evaluate(track, "%path%") ?? "") : "",
	subsong: track ? subsongOf(track) : 0,
	// The address a write names a library track by, and `null` for a track the
	// snapshot does not hold. A component with no library to look in holds no
	// snapshot at all, so it answers `null` for everything.
	libraryPath:
		track && fake.canReadLibrary ? state.libraryPathFor(track) : null,
});

const positionOf = ({
	seconds,
	takenAtMs,
}: {
	seconds: number;
	takenAtMs: number;
}) => ({
	seconds: Math.max(seconds, 0),
	ageSeconds: Math.max((Date.now() - takenAtMs) / 1000, 0),
});

// What `GET /api/state` answers about the player whichever session it names.
const playerOwnFieldsOf = (state: FakeState, fake: FooJeanFake) => ({
	volume: state.playerHeld ? -100 : state.player.volume.value,
	muted: state.playerHeld ? true : state.player.volume.isMuted,
	currentPlaylistId:
		state.playlists.find((entry) => entry.isCurrent)?.guid ?? null,
	// Rides straight through even where it names no device `GET /api/outputs` lists, which is
	// what an unplugged device looks like: `outputDeviceId` says what the player is set to, not
	// what a picker can still offer.
	outputDeviceId: fake.activeOutput,
	outputSilent:
		fake.activeOutput === null ? null : isSilentOutput(fake.activeOutput),
	playlistsRevision: state.playlistsRevision,
});

// What rides under `player` in `GET /api/state`'s `200`. Position comes from
// `state.positionMark` rather than from `activeItem.position` directly, since
// that is where the age the client interpolates from is kept.
export const playerSectionOf = (state: FakeState, fake: FooJeanFake) => {
	const item = state.playingItem;
	const playlist =
		item && item.index >= 0 ? state.playlistById(item.playlistId) : null;
	const track = state.playingTrack();
	return {
		playback: state.player.playbackState,
		...addressOf(state, fake, track),
		position: positionOf(state.positionMark),
		duration: Math.max(item?.duration ?? 0, 0),
		playbackMode: jeanModeFor(
			declaredOrders(state)[state.player.playbackMode] ?? "",
		),
		...namesOf(track),
		playingLocation:
			fake.knowsPlayingLocation && item && playlist
				? { playlistId: playlist.guid, index: item.index }
				: null,
		...playerOwnFieldsOf(state, fake),
		queueRevision: state.queueRevision,
		timelineRevision: state.timelineRevision,
		sessionRevision: 0,
	};
};

// `contract/openapi.yaml` answers `playingLocation` `null` here: a detached session plays a
// snapshot, which stops matching its playlist at the playlist's first edit.
const sessionPlayerSectionOf = (
	state: FakeState,
	fake: FooJeanFake,
	session: DetachedSession,
) => {
	const track = session.playingTrack();
	return {
		playback: session.playback(),
		...addressOf(state, fake, track),
		position: positionOf(session.position),
		duration: session.duration(),
		playbackMode: session.mode,
		...namesOf(track),
		playingLocation: null,
		...playerOwnFieldsOf(state, fake),
		queueRevision: session.queueRevision,
		timelineRevision: session.timelineRevision,
		sessionRevision: session.sessionRevision,
	};
};

// `tagName` in `plugins/fb2k/src/core/http_server.cpp` folds `phase`,
// `formatted` and `total` for this route alone, rather than a step counter, so
// a build that has stopped moving stops moving the tag too.
const buildTagOf = (build: components["schemas"]["LibraryBuild"] | null) =>
	build ? `${build.phase}:${build.formatted}/${build.total}` : "x";

const libraryTagOf = (state: FakeState, fake: FooJeanFake) =>
	`s${state.libraryFeed.structure}-r${state.libraryFeed.revision}-b${
		fake.libraryHalted ? "halted" : buildTagOf(libraryBuildOf(state, fake))
	}`;

const configTagOf = (fake: FooJeanFake) =>
	`g${fake.configGeneration}${fake.mainThreadStalled ? "-stalled" : ""}`;

// `GET /api/state`'s own validator, distinct from the two binary routes'
// `tagOf`: it folds the player's version and the config generation too, so a
// poll that only drove the player, or only flipped a switch, still sees the
// tag move.
const stateTagOf = (state: FakeState, fake: FooJeanFake, coding: string) =>
	`"${libraryTagOf(state, fake)}-p${state.playerVersion}-${configTagOf(fake)}-${coding}"`;

// `foo_jean`'s `routes_state.cpp` folds what the poll answers about the player, and never the
// player's own playback, so a track change at the player leaves every session's poll a `304`.
const sessionStateTagOf = (
	state: FakeState,
	fake: FooJeanFake,
	session: DetachedSession,
	coding: string,
) =>
	`"${libraryTagOf(state, fake)}-${configTagOf(fake)}-o${encodeURIComponent(
		JSON.stringify(playerOwnFieldsOf(state, fake)),
	)}-x${session.id}-v${session.version}-${coding}"`;

// `kMainThreadStalledAfter` in `plugins/fb2k/src/core/main_thread_watch.h`: the component calls
// the main thread stalled only once a check has waited this long.
const COMPONENT_STALLED_AFTER_MS = 5000;

const mainThreadSectionOf = (
	fake: FooJeanFake,
): components["schemas"]["MainThread"] => {
	if (!fake.mainThreadStalled) {
		fake.mainThreadStalledAt = null;
		return { answering: true, unansweredSeconds: null };
	}
	fake.mainThreadStalledAt ??= Date.now();
	return {
		answering: false,
		unansweredSeconds:
			(Date.now() - fake.mainThreadStalledAt + COMPONENT_STALLED_AFTER_MS) /
			1000,
	};
};

// A player with no media library at all still answers what it is playing: this
// route never 503s on that account, unlike the three `handleLibrary` routes,
// which have nothing to serve without one.
export async function handleState({
	state,
	fake,
	method,
	headers,
	response,
	session,
}: Asked) {
	if (method !== "GET") return notFound(response);
	if (fake.failState) {
		if (fake.failState === 429) response.setHeader("Retry-After", "1");
		return json(
			response,
			{ error: "the state route is not answering", detail: "" },
			fake.failState,
		);
	}
	if (fake.dropState) {
		response.destroy();
		return true;
	}
	if (fake.hangState) {
		await abandoned(response, STALLED_READ_MS);
		return true;
	}

	if (
		fake.libraryRebuilds > 0 &&
		state.libraryFeed.columns.length > 0 &&
		!fake.libraryHalted
	) {
		fake.libraryRebuilds -= 1;
		state.startLibraryBuild(state.libraryFeed.columns);
	}
	if (state.libraryFeed.building && !fake.libraryHalted) {
		if (fake.libraryBuilds > 0) {
			fake.libraryBuilds -= 1;
			state.libraryFeed.buildTicks += 1;
		} else if (fake.libraryReady) state.finishLibraryBuild();
	}
	const tag = session
		? sessionStateTagOf(state, fake, session, "identity")
		: stateTagOf(state, fake, "identity");
	response.setHeader("Vary", "Origin, Accept-Encoding");
	response.setHeader("Cache-Control", ASK_EVERY_TIME);
	response.setHeader("ETag", tag);
	if (one(headers["if-none-match"]) === tag) {
		response.writeHead(304);
		response.end();
		return true;
	}
	return json(response, {
		configGeneration: fake.configGeneration,
		library: libraryStateOf(state, fake),
		player: session
			? sessionPlayerSectionOf(state, fake, session)
			: playerSectionOf(state, fake),
		mainThread: mainThreadSectionOf(fake),
	});
}
