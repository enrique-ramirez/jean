import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { recheckComponentLibrary } from "@/domain/track/playlistStore";
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

export const PLAYER_KEY = ["player"];

export const POLL_MS = 1000;

// Above the poll interval, so a fader held through a tick is confirmed by the next one rather than
// sprung back to the player's last reported level.
export const VOLUME_SETTLE_MS = 2500;

const EMPTY_ACTIVE_ITEM = {
	columns: [],
	index: -1,
	path: null,
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
			changePlaylists:
				capabilities?.canWritePlaylists ??
				previous?.permissions.changePlaylists ??
				true,
			changeOutput:
				capabilities?.canChangeOutput ??
				previous?.permissions.changeOutput ??
				true,
			changeClientConfig: previous?.permissions.changeClientConfig ?? true,
		},
		jeanPlaybackMode: doc.playbackMode,
		playbackState: doc.playback,
		activeItem: {
			...(previous?.activeItem ?? EMPTY_ACTIVE_ITEM),
			columns:
				doc.title != null || doc.artist != null
					? [doc.artist ?? "", doc.title ?? ""]
					: (previous?.activeItem.columns ?? EMPTY_ACTIVE_ITEM.columns),
			duration: doc.duration,
			// The same -1 whether stopped or merely unplaceable; see the field's own comment in types.ts.
			index: doc.playingLocation?.index ?? -1,
			path: doc.path || null,
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
			const result = await fetchState(origin, token, tag);
			if (!result.ok || result.kind === "unchanged") return;

			tag = result.tag;
			const previous = client.getQueryData<PlayerSnapshot>(PLAYER_KEY);
			const snapshot: PlayerSnapshot = {
				player: mergePlayer(
					previous?.player,
					result.state.player,
					capabilities,
				),
				syncedAt: performance.now(),
			};
			client.setQueryData<PlayerSnapshot>(PLAYER_KEY, snapshot);
			rememberSnapshot(snapshot);
			notePlaybackState(snapshot.player.playbackState);
			void recheckComponentLibrary(origin, token, result.state.library);
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
