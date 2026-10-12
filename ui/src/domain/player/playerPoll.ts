import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { FooJeanCapabilities } from "@/shared/api/discovery";
import { fetchState, type StateDocument } from "@/shared/api/state";
import type {
	ActiveItem,
	PlayerSnapshot,
	PlayerState,
} from "@/shared/api/types";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { forgetHeard, rememberSnapshot } from "./audible";
import { AUDIENCE_POLL_MS } from "./audience";
import {
	notePlayerAnswering,
	notePlayerReached,
	notePlayerUnreached,
} from "./connection";
import {
	followTimeline,
	isListening,
	listeningSnapshot,
	notePlaybackState,
} from "./listenerStore";
import { watchForNobodyListening } from "./nobodyListening";
import { followQueue, forgetQueue } from "./queue";
import {
	noteSessionGone,
	sessionEpoch,
	sessionSnapshot,
	subscribeSession,
} from "./session";
import {
	followSessionDocument,
	forgetSessionDocument,
} from "./sessionDocument";
import { followPlaylists } from "./usePlaylists";

export const PLAYER_KEY = ["player"];

export const POLL_MS = 1000;

export const MARK_FOLLOW_UP_MS = 250;

// Above the poll interval, so a fader held through a tick is confirmed by the next one rather than
// sprung back to the player's last reported level.
export const VOLUME_SETTLE_MS = 2500;

function mergePlayer(
	previous: PlayerState | undefined,
	doc: StateDocument["player"],
	capabilities: FooJeanCapabilities | undefined,
): PlayerState {
	return {
		info: {
			name: capabilities?.playerName ?? previous?.info.name ?? "",
			version: capabilities?.playerVersion ?? previous?.info.version ?? "",
		},
		playbackMode: doc.playbackMode,
		playbackState: doc.playback,
		activeItem: {
			columns: [doc.artist ?? "", doc.title ?? ""],
			duration: doc.duration,
			index: doc.playingLocation?.index ?? -1,
			path: doc.path || null,
			libraryPath: doc.libraryPath,
			album: doc.album,
			albumArtist: doc.albumArtist,
			playlistGuid: doc.playingLocation?.playlistId ?? null,
			// A mark plus how long ago it was taken, per `Position` in the contract: the client adds
			// them to get where playback is now.
			position: doc.position.seconds + doc.position.ageSeconds,
			subsong: doc.subsong,
		},
		volume: {
			type: capabilities?.volumeUnit ?? previous?.volume.type ?? "",
			min: capabilities?.volumeMin ?? previous?.volume.min ?? 0,
			max: capabilities?.volumeMax ?? previous?.volume.max ?? 0,
			value: doc.volume,
			isMuted: doc.muted,
		},
		outputDeviceId: doc.outputDeviceId,
		outputSilent: doc.outputSilent ?? null,
	};
}

const LIBRARY_UNBUILT_KEY = ["library", "unbuilt"];

export function useExportHeldWhenLibraryUnbuilt(): number | null {
	return useCacheOnly<number | null>(LIBRARY_UNBUILT_KEY).data ?? null;
}

interface AnnouncedRevisions {
	queueRevision: number;
	playlistsRevision: number;
	timelineRevision: number;
	sessionRevision: number;
}

// `foo_jean`'s `GET /api/state` body carries no counter that orders two answers, and its `ETag` is
// opaque, so the order the reads were asked in stands in for the order the player answered them.
interface DrawnAnswer {
	asked: number;
	drawn: number;
	tag: string | null;
	revisions: AnnouncedRevisions | null;
	epoch: number;
}

const drawnAnswers = new WeakMap<QueryClient, DrawnAnswer>();

function drawnAnswerOf(client: QueryClient): DrawnAnswer {
	let drawn = drawnAnswers.get(client);
	if (!drawn) {
		drawn = {
			asked: 0,
			drawn: 0,
			tag: null,
			revisions: null,
			epoch: sessionEpoch(),
		};
		drawnAnswers.set(client, drawn);
	}
	return drawn;
}

const pendingMarkFollowUps = new WeakMap<
	QueryClient,
	ReturnType<typeof setTimeout>
>();

function scheduleMarkFollowUp(client: QueryClient, origin: string) {
	if (pendingMarkFollowUps.has(client)) return;
	const timer = setTimeout(() => {
		pendingMarkFollowUps.delete(client);
		void pollPlayerNow(client, origin);
	}, MARK_FOLLOW_UP_MS);
	pendingMarkFollowUps.set(client, timer);
}

function cancelMarkFollowUp(client: QueryClient) {
	const pending = pendingMarkFollowUps.get(client);
	if (!pending) return;
	clearTimeout(pending);
	pendingMarkFollowUps.delete(client);
}

const NOTHING_PLAYING: ActiveItem = {
	columns: ["", ""],
	duration: 0,
	index: -1,
	path: null,
	libraryPath: null,
	album: null,
	albumArtist: null,
	playlistGuid: null,
	position: 0,
	subsong: 0,
};

// `foo_jean` answers the player's name, volume and output whichever session a poll names.
function vacate(
	previous: PlayerSnapshot | undefined,
): PlayerSnapshot | undefined {
	if (!previous) return undefined;
	return {
		player: {
			...previous.player,
			playbackState: "stopped",
			playbackMode: null,
			activeItem: NOTHING_PLAYING,
		},
		syncedAt: performance.now(),
	};
}

function forgetSession(client: QueryClient): boolean {
	const drawn = drawnAnswerOf(client);
	const epoch = sessionEpoch();
	if (drawn.epoch === epoch) return false;

	drawn.epoch = epoch;
	drawn.tag = null;
	drawn.revisions = null;
	drawn.drawn = drawn.asked;
	cancelMarkFollowUp(client);
	forgetQueue(client);
	forgetSessionDocument(client);
	forgetHeard();
	client.setQueryData<PlayerSnapshot | undefined>(PLAYER_KEY, vacate);
	return true;
}

export interface PollFollower {
	heldLibraryStructure: (origin: string) => number;
	answered: (origin: string) => void;
	libraryAnnounced: (origin: string, library: StateDocument["library"]) => void;
}

const UNFOLLOWED: PollFollower = {
	heldLibraryStructure: () => 0,
	answered: () => {},
	libraryAnnounced: () => {},
};

let follower = UNFOLLOWED;

export function followPollWith(next: PollFollower) {
	follower = next;
}

async function applyPoll(
	client: QueryClient,
	origin: string,
	read: "conditional" | "unconditional",
	capabilities?: FooJeanCapabilities,
	onConfigGeneration?: (generation: number) => void,
): Promise<void> {
	forgetSession(client);
	const drawn = drawnAnswerOf(client);
	const epoch = sessionEpoch();
	const session = sessionSnapshot().id;
	drawn.asked += 1;
	const ask = drawn.asked;
	const tag = read === "conditional" ? drawn.tag : null;
	const exportHeldWhenAsked = follower.heldLibraryStructure(origin);
	const askedAt = performance.now();
	const result = await fetchState(origin, tag);
	if (!result.ok && result.reason === "unreachable")
		notePlayerUnreached(askedAt);
	else notePlayerReached();
	if (epoch !== sessionEpoch()) return;
	if (!result.ok) {
		if (result.reason === "noSuchSession" && session !== null)
			noteSessionGone(session);
		return;
	}

	// Asked on every tick the player answers, not only on one that carries a change: a quiet player
	// answers `304` forever, and a read lost under it has nothing else coming to carry its value.
	follower.answered(origin);
	void watchForNobodyListening(client, origin, result.kind !== "unchanged");
	const answersNewerAsk = ask > drawn.drawn;
	if (result.kind === "unchanged") {
		if (answersNewerAsk && tag === drawn.tag) drawn.drawn = ask;
		const { revisions } = drawn;
		if (revisions) {
			followQueue(client, origin, revisions.queueRevision);
			followPlaylists(client, origin, revisions.playlistsRevision);
			followTimeline(origin, revisions.timelineRevision);
			followSessionDocument(client, origin, session, revisions.sessionRevision);
		}
		return;
	}
	if (!answersNewerAsk) return;

	onConfigGeneration?.(result.state.configGeneration);
	notePlayerAnswering(result.state.mainThread.answering, askedAt);

	const previous = client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
	const snapshot: PlayerSnapshot = {
		player: mergePlayer(previous?.player, result.state.player, capabilities),
		syncedAt: performance.now(),
	};
	client.setQueryData<PlayerSnapshot>(PLAYER_KEY, snapshot);
	const sawChangeOrSeek = rememberSnapshot(snapshot);
	notePlaybackState(snapshot.player.playbackState);

	// The mark a library address is checked against: `shared/api/README.md`, *What Jean does about
	// the library*.
	client.setQueryData<number | null>(
		LIBRARY_UNBUILT_KEY,
		result.state.library.ready ? null : exportHeldWhenAsked,
	);

	follower.libraryAnnounced(origin, result.state.library);
	const revisions: AnnouncedRevisions = {
		queueRevision: result.state.player.queueRevision,
		playlistsRevision: result.state.player.playlistsRevision,
		timelineRevision: result.state.player.timelineRevision,
		sessionRevision: result.state.player.sessionRevision,
	};
	drawn.drawn = ask;
	drawn.tag = result.tag;
	drawn.revisions = revisions;
	followQueue(client, origin, revisions.queueRevision);
	followPlaylists(client, origin, revisions.playlistsRevision);
	followSessionDocument(client, origin, session, revisions.sessionRevision);
	const timelineUnmoved = followTimeline(origin, revisions.timelineRevision);

	if (
		sawChangeOrSeek &&
		timelineUnmoved &&
		isListening(listeningSnapshot().phase)
	)
		scheduleMarkFollowUp(client, origin);
}

export async function pollPlayerNow(
	client: QueryClient,
	origin: string,
): Promise<void> {
	await applyPoll(client, origin, "unconditional");
}

export function startPlayerPoll(
	client: QueryClient,
	origin: string,
	capabilities?: FooJeanCapabilities | (() => FooJeanCapabilities | undefined),
	onConfigChange?: () => void,
): () => void {
	drawnAnswerOf(client).tag = null;
	let inFlight = false;
	let lastAskedAt = Number.NEGATIVE_INFINITY;
	let lastGeneration: number | undefined;

	const readCapabilities = () =>
		typeof capabilities === "function" ? capabilities() : capabilities;

	const noticeGeneration = (generation: number) => {
		if (lastGeneration !== undefined && generation !== lastGeneration)
			onConfigChange?.();
		lastGeneration = generation;
	};

	const isDueWhileHidden = (now: number) =>
		isListening(listeningSnapshot().phase) ||
		(sessionSnapshot().role === "controlling" &&
			now - lastAskedAt >= AUDIENCE_POLL_MS.background);

	const tick = async () => {
		if (inFlight) return;
		const now = performance.now();
		if (document.visibilityState !== "visible" && !isDueWhileHidden(now))
			return;

		lastAskedAt = now;
		inFlight = true;
		try {
			await applyPoll(
				client,
				origin,
				"conditional",
				readCapabilities(),
				noticeGeneration,
			);
		} finally {
			inFlight = false;
		}
	};

	const onVisibilityChange = () => void tick();
	const unsubscribeSession = subscribeSession(() => {
		if (forgetSession(client)) void pollPlayerNow(client, origin);
	});

	void tick();
	const timer = setInterval(() => void tick(), POLL_MS);
	document.addEventListener("visibilitychange", onVisibilityChange);
	return () => {
		clearInterval(timer);
		unsubscribeSession();
		document.removeEventListener("visibilitychange", onVisibilityChange);
		cancelMarkFollowUp(client);
	};
}

export function usePlayerPoll(
	origin: string | null,
	capabilities: FooJeanCapabilities | null,
) {
	const client = useQueryClient();
	const { recheck } = useFooJean();

	const capabilitiesRef = useRef(capabilities);
	capabilitiesRef.current = capabilities;
	const isReady = capabilities !== null;

	useEffect(() => {
		if (!origin || !isReady) return undefined;
		return startPlayerPoll(
			client,
			origin,
			() => capabilitiesRef.current ?? undefined,
			recheck,
		);
	}, [client, origin, isReady, recheck]);
}
