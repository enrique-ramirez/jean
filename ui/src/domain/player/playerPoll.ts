import {
	type QueryClient,
	skipToken,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	componentLibraryKey,
	playlistSnapshot,
	recheckComponentLibrary,
	retryFailedLibraryRead,
	retryFailedPlaylistReads,
} from "@/domain/track/playlistStore";
import {
	type FooJeanCapabilities,
	fetchState,
	type StateDocument,
} from "@/shared/api/fooJean";
import type { PlayerSnapshot, PlayerState } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { rememberSnapshot } from "./audible";
import { notePlayerReached, notePlayerUnreached } from "./connection";
import {
	followTimeline,
	isListening,
	listeningSnapshot,
	notePlaybackState,
} from "./listenerStore";
import { followQueue } from "./queue";
import { followPlaylists } from "./usePlayer";

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
	};
}

export const LIBRARY_UNBUILT_KEY = ["library", "unbuilt"];

export function useExportHeldWhenLibraryUnbuilt(): number | null {
	const { data = null } = useQuery<number | null>({
		queryKey: LIBRARY_UNBUILT_KEY,
		queryFn: skipToken,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	});
	return data;
}

interface AnnouncedRevisions {
	queueRevision: number;
	playlistsRevision: number;
	timelineRevision: number;
}

// `foo_jean`'s `GET /api/state` body carries no counter that orders two answers, and its `ETag` is
// opaque, so the order the reads were asked in stands in for the order the player answered them.
interface DrawnAnswer {
	asked: number;
	drawn: number;
	tag: string | null;
	revisions: AnnouncedRevisions | null;
}

const drawnAnswers = new WeakMap<QueryClient, DrawnAnswer>();

function drawnAnswerOf(client: QueryClient): DrawnAnswer {
	let drawn = drawnAnswers.get(client);
	if (!drawn) {
		drawn = { asked: 0, drawn: 0, tag: null, revisions: null };
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

async function applyPoll(
	client: QueryClient,
	origin: string,
	read: "conditional" | "unconditional",
	capabilities?: FooJeanCapabilities,
	onConfigGeneration?: (generation: number) => void,
): Promise<void> {
	const drawn = drawnAnswerOf(client);
	drawn.asked += 1;
	const ask = drawn.asked;
	const tag = read === "conditional" ? drawn.tag : null;
	const exportHeldWhenAsked = playlistSnapshot(
		componentLibraryKey(origin),
	).structure;
	const askedAt = performance.now();
	const result = await fetchState(origin, tag);
	if (!result.ok && result.reason === "unreachable")
		notePlayerUnreached(askedAt);
	else notePlayerReached();
	if (!result.ok) return;

	// Asked on every tick the player answers, not only on one that carries a change: a quiet player
	// answers `304` forever, and a read lost under it has nothing else coming to carry its value.
	void retryFailedPlaylistReads(origin);
	void retryFailedLibraryRead(origin);
	const answersNewerAsk = ask > drawn.drawn;
	if (result.kind === "unchanged") {
		if (answersNewerAsk && tag === drawn.tag) drawn.drawn = ask;
		const { revisions } = drawn;
		if (revisions) {
			followQueue(client, origin, revisions.queueRevision);
			followPlaylists(client, origin, revisions.playlistsRevision);
			followTimeline(origin, revisions.timelineRevision);
		}
		return;
	}
	if (!answersNewerAsk) return;

	onConfigGeneration?.(result.state.configGeneration);

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

	void recheckComponentLibrary(origin, result.state.library);
	const revisions: AnnouncedRevisions = {
		queueRevision: result.state.player.queueRevision,
		playlistsRevision: result.state.player.playlistsRevision,
		timelineRevision: result.state.player.timelineRevision,
	};
	drawn.drawn = ask;
	drawn.tag = result.tag;
	drawn.revisions = revisions;
	followQueue(client, origin, revisions.queueRevision);
	followPlaylists(client, origin, revisions.playlistsRevision);
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
	let lastGeneration: number | undefined;

	const readCapabilities = () =>
		typeof capabilities === "function" ? capabilities() : capabilities;

	const noticeGeneration = (generation: number) => {
		if (lastGeneration !== undefined && generation !== lastGeneration)
			onConfigChange?.();
		lastGeneration = generation;
	};

	const tick = async () => {
		if (inFlight) return;
		if (
			document.visibilityState !== "visible" &&
			!isListening(listeningSnapshot().phase)
		)
			return;

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

	void tick();
	const timer = setInterval(() => void tick(), POLL_MS);
	document.addEventListener("visibilitychange", onVisibilityChange);
	return () => {
		clearInterval(timer);
		document.removeEventListener("visibilitychange", onVisibilityChange);
		const pending = pendingMarkFollowUps.get(client);
		if (pending) {
			clearTimeout(pending);
			pendingMarkFollowUps.delete(client);
		}
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
