import {
	type QueryClient,
	skipToken,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import {
	componentLibraryKey,
	playlistSnapshot,
	recheckComponentLibrary,
	retryFailedPlaylistReads,
} from "@/domain/track/playlistStore";
import {
	type FooJeanCapabilities,
	fetchState,
	type StateDocument,
} from "@/shared/api/fooJean";
import type {
	ActiveItem,
	PlayerSnapshot,
	PlayerState,
} from "@/shared/api/types";
import { rememberSnapshot } from "./audible";
import { notePlaybackState } from "./listenerStore";
import { recheckQueue } from "./queue";
import { recheckPlaylists } from "./usePlayer";

export const PLAYER_KEY = ["player"];

export const POLL_MS = 1000;

// Above the poll interval, so a fader held through a tick is confirmed by the next one rather than
// sprung back to the player's last reported level.
export const VOLUME_SETTLE_MS = 2500;

const EMPTY_ACTIVE_ITEM = {
	columns: [],
	index: -1,
	path: null,
	libraryPath: null,
	album: null,
	albumArtist: null,
	playlistGuid: null,
	playlistId: "",
	playlistIndex: -1,
	subsong: 0,
} satisfies Omit<ActiveItem, "duration" | "position">;

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
		permissions: {
			changeOutput:
				capabilities?.canChangeOutput ??
				previous?.permissions.changeOutput ??
				true,
		},
		jeanPlaybackMode: doc.playbackMode,
		playbackState: doc.playback,
		activeItem: {
			...(previous?.activeItem ?? EMPTY_ACTIVE_ITEM),
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

async function applyPoll(
	client: QueryClient,
	origin: string,
	token: string,
	tag: string | null,
	capabilities: FooJeanCapabilities | undefined,
): Promise<string | null> {
	const exportHeldWhenAsked = playlistSnapshot(
		componentLibraryKey(origin),
	).structure;
	const result = await fetchState(origin, token, tag);
	if (!result.ok) return tag;

	// Asked on every tick the player answers, not only on one that carries a change: a quiet player
	// answers `304` forever, and a read lost under it has nothing else coming to carry its value.
	void retryFailedPlaylistReads(origin, token);
	if (result.kind === "unchanged") return tag;

	const previous = client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
	const snapshot: PlayerSnapshot = {
		player: mergePlayer(previous?.player, result.state.player, capabilities),
		syncedAt: performance.now(),
	};
	client.setQueryData<PlayerSnapshot>(PLAYER_KEY, snapshot);
	rememberSnapshot(snapshot);
	notePlaybackState(snapshot.player.playbackState);

	// The mark a library address is checked against: `shared/api/README.md`, *What Jean does about
	// the library*.
	client.setQueryData<number | null>(
		LIBRARY_UNBUILT_KEY,
		result.state.library.ready ? null : exportHeldWhenAsked,
	);

	void recheckComponentLibrary(origin, token, result.state.library);
	void recheckQueue(client, origin, token, result.state.player.queueRevision);
	void recheckPlaylists(
		client,
		origin,
		token,
		result.state.player.playlistsRevision,
	);
	return result.tag;
}

export async function pollPlayerNow(
	client: QueryClient,
	origin: string,
	token: string,
): Promise<void> {
	await applyPoll(client, origin, token, null, undefined);
}

export function startPlayerPoll(
	client: QueryClient,
	origin: string,
	token: string,
	capabilities?: FooJeanCapabilities,
): () => void {
	let tag: string | null = null;
	let inFlight = false;

	const tick = async () => {
		if (document.visibilityState !== "visible" || inFlight) return;

		inFlight = true;
		try {
			tag = await applyPoll(client, origin, token, tag, capabilities);
		} finally {
			inFlight = false;
		}
	};

	void tick();
	const timer = setInterval(() => void tick(), POLL_MS);
	return () => clearInterval(timer);
}

export function usePlayerPoll(
	origin: string | null,
	token: string | null,
	capabilities: FooJeanCapabilities | null,
) {
	const client = useQueryClient();

	useEffect(() => {
		if (!origin || !token || !capabilities) return undefined;
		return startPlayerPoll(client, origin, token, capabilities);
	}, [client, origin, token, capabilities]);
}
