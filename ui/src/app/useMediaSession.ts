import { useEffect, useState } from "react";
import { audibleAt } from "@/domain/player/position";
import { useListener } from "@/domain/player/useListener";
import {
	usePlayPause,
	usePrevious,
	useSeek,
	useSeekBy,
	useTransport,
} from "@/domain/player/usePlayer";
import { coverKey } from "@/domain/track/fields";
import { canonicalPlayingArtworkUrl } from "@/domain/track/librarySource";
import {
	bearer,
	isFooJeanReady,
	playingArtworkUrl,
} from "@/shared/api/fooJean";
import type { NowPlayingTrack, PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { clamp } from "@/shared/lib/math";
import { dropArtwork, holdArtwork } from "@/shared/ui/artworkHandles";

const SEEK_STEP_SECONDS = 10;

// Every read of `navigator.mediaSession` in this file MUST go through here, so the
// secure-context guard (`src/app/CLAUDE.md`, *The media session*) covers the whole module
// in one place.
export const mediaSession = () =>
	isSecureContext && "mediaSession" in navigator
		? navigator.mediaSession
		: null;

const ACTIONS: MediaSessionAction[] = [
	"play",
	"pause",
	"stop",
	"previoustrack",
	"nexttrack",
	"seekbackward",
	"seekforward",
	"seekto",
];

function setHandlers(
	handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>>,
) {
	const target = mediaSession();
	if (!target) return;

	for (const action of ACTIONS) {
		try {
			target.setActionHandler(action, handlers[action] ?? null);
		} catch {
			// A browser that does not know an action throws rather than ignoring it.
		}
	}
}

function setPosition(duration: number, position: number) {
	const target = mediaSession();
	if (!target?.setPositionState) return;

	const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
	try {
		target.setPositionState(
			length === 0
				? undefined
				: {
						duration: length,
						position: clamp(position, 0, length),
						playbackRate: 1,
					},
		);
	} catch {
		// A duration the browser refuses costs the scrubber, not the session.
	}
}

const LOCK_SCREEN_MAX_EDGE = 512;
const LOCK_SCREEN_TYPE = "image/jpeg";
const LOCK_SCREEN_QUALITY = 0.85;

// Chrome on iOS refuses a `blob:` URL on the lock screen, so the cover is redrawn onto a
// canvas and handed over encoded. `blobUrl` names a blob Jean already fetched with the
// token, never an address requested straight from here, so drawing it never taints the
// canvas.
async function shrinkForLockScreen(blobUrl: string): Promise<MediaImage> {
	const image = new Image();
	image.src = blobUrl;
	await image.decode();

	const scale = Math.min(
		1,
		LOCK_SCREEN_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
	);
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no 2d context");
	context.drawImage(image, 0, 0, width, height);

	return {
		src: canvas.toDataURL(LOCK_SCREEN_TYPE, LOCK_SCREEN_QUALITY),
		sizes: `${width}x${height}`,
		type: LOCK_SCREEN_TYPE,
	};
}

export function useMediaSession(
	snapshot: PlayerSnapshot | null | undefined,
	track: NowPlayingTrack | null,
	hasTrack: boolean,
) {
	const listener = useListener();
	const playPause = usePlayPause().mutate;
	const transport = useTransport();
	const previous = usePrevious();
	const seek = useSeek().mutate;
	const seekBy = useSeekBy().mutate;

	const next = transport.next.mutate;
	const stopPlayer = transport.stop.mutate;
	const { disconnect } = listener;

	const live = listener.isOn && hasTrack;

	const { discovery } = useFooJean();

	const item = snapshot?.player?.activeItem;
	const isPlaying = snapshot?.player?.playbackState === "playing";
	const album = item?.album ?? null;
	const credited = item?.albumArtist || item?.columns[0] || null;

	const isReady = isFooJeanReady(discovery);
	const origin = isReady ? discovery.origin : null;
	const token = isReady ? discovery.token : null;

	const canonical = album
		? canonicalPlayingArtworkUrl(origin, album, credited || "")
		: null;

	const playingCover = !track
		? null
		: album
			? coverKey(credited, album)
			: coverKey(track.artist, track.title, "track");
	const artworkUrl = !live ? null : (canonical ?? playingArtworkUrl(origin));

	const [cover, setCover] = useState<MediaImage | null>(null);

	useEffect(() => {
		setCover(null);
		if (!artworkUrl || !playingCover || !token) return;

		const key = playingCover;
		const abort = new AbortController();
		let cancelled = false;

		const read = async () => {
			const response = await fetch(artworkUrl, {
				signal: abort.signal,
				headers: bearer(token),
			});
			if (!response.ok) throw new Error(`no artwork: ${response.status}`);
			return response.blob();
		};

		(async () => {
			let claimed = false;
			try {
				const url = await holdArtwork(key, read);
				claimed = true;
				const built = await shrinkForLockScreen(url);
				if (!cancelled) setCover(built);
			} catch {
				if (!cancelled) setCover(null);
			} finally {
				if (claimed) dropArtwork(key);
			}
		})();

		return () => {
			cancelled = true;
			abort.abort();
		};
	}, [artworkUrl, playingCover, token]);

	useEffect(() => {
		const target = mediaSession();
		if (!target) return;

		target.metadata = live
			? new MediaMetadata({
					title: track?.title ?? "",
					artist: track?.artist ?? "",
					album: album ?? "",
					artwork: cover ? [cover] : [],
				})
			: null;
	}, [live, track?.title, track?.artist, album, cover]);

	useEffect(() => {
		const target = mediaSession();
		if (!target) return;
		target.playbackState = !live ? "none" : isPlaying ? "playing" : "paused";
	}, [live, isPlaying]);

	useEffect(() => {
		if (!live) {
			setPosition(0, 0);
			return;
		}
		setPosition(item?.duration ?? 0, audibleAt(snapshot));
	}, [live, snapshot, item?.duration]);

	useEffect(() => {
		if (!live) {
			setHandlers({});
			return;
		}

		setHandlers({
			play: () => {
				if (!isPlaying) playPause();
			},
			pause: () => {
				if (isPlaying) playPause();
			},
			previoustrack: () => previous(),
			nexttrack: () => next(),
			stop: () => {
				stopPlayer();
				disconnect();
			},
			seekbackward: (action) =>
				seekBy(-(action.seekOffset ?? SEEK_STEP_SECONDS)),
			seekforward: (action) => seekBy(action.seekOffset ?? SEEK_STEP_SECONDS),
			seekto: (action) => {
				if (action.seekTime != null) seek(action.seekTime);
			},
		});

		return () => setHandlers({});
	}, [
		live,
		isPlaying,
		playPause,
		previous,
		next,
		stopPlayer,
		disconnect,
		seek,
		seekBy,
	]);
}
