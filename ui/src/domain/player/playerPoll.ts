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

// `info.title` and `info.pluginVersion` are beefweb's own, with no `foo_jean` equivalent, so a client
// that has never seen a full player yet has no better answer than an empty one; the beefweb
// subscription fills them in as soon as it arrives.
function mergePlayer(
	previous: PlayerState | undefined,
	doc: StateDocument["player"],
	capabilities: FooJeanCapabilities | undefined,
): PlayerState {
	return {
		info: {
			name: capabilities?.playerName ?? previous?.info.name ?? "",
			title: previous?.info.title,
			version: capabilities?.playerVersion ?? previous?.info.version ?? "",
			pluginVersion: previous?.info.pluginVersion ?? "",
		},
		options: previous?.options,
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
		// beefweb's own deprecated pair, left to whatever the subscription last wrote: the poll's
		// document carries no numeric ordinal to feed it.
		playbackMode: previous?.playbackMode ?? 0,
		playbackModes: previous?.playbackModes ?? [],
		jeanPlaybackMode: doc.playbackMode,
		playbackState: doc.playback,
		activeItem: {
			...(previous?.activeItem ?? EMPTY_ACTIVE_ITEM),
			columns:
				doc.title != null || doc.artist != null
					? [doc.artist ?? "", doc.title ?? ""]
					: (previous?.activeItem.columns ?? EMPTY_ACTIVE_ITEM.columns),
			duration: doc.duration,
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

// `permissions` and `jeanPlaybackMode` have no equivalent in beefweb's own payload at all, and now
// neither does the playing path or `foo_jean`'s own playlist GUID: beefweb's `activeItem` carries
// `columns`, `duration`, `index`, `playlistId`, `playlistIndex` and `position`, nothing the poll's
// `path`, `subsong` or `playlistGuid` could come from. A push from the subscription carries whatever
// it last had for those, which is stale or absent rather than current, so the poll's own values
// survive a push instead of being blanked by it.
export function keepPollOwned(
	previous: PlayerState | undefined,
	incoming: PlayerState,
): PlayerState {
	if (!previous) return incoming;
	return {
		...incoming,
		activeItem: {
			...incoming.activeItem,
			path: previous.activeItem.path,
			playlistGuid: previous.activeItem.playlistGuid,
			subsong: previous.activeItem.subsong,
		},
		permissions: previous.permissions,
		jeanPlaybackMode: previous.jeanPlaybackMode,
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
			client.setQueryData<PlayerSnapshot>(PLAYER_KEY, {
				player: mergePlayer(
					previous?.player,
					result.state.player,
					capabilities,
				),
				syncedAt: performance.now(),
			});
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
