import { useEffect } from "react";
import { audibleAt } from "@/domain/player/position";
import { useListener } from "@/domain/player/useListener";
import {
	usePlayPause,
	usePrevious,
	useSeek,
	useSeekBy,
	useTransport,
} from "@/domain/player/usePlayer";
import { usePlayingPlaylist } from "@/domain/player/usePlayingPlaylist";
import { value } from "@/domain/track/fields";
import { NOW_PLAYING_FIELD } from "@/features/now-playing/nowPlayingFields";
import { useNowPlayingTrack } from "@/features/now-playing/useNowPlayingTrack";
import { artworkUrl } from "@/shared/api/beefweb";
import type { NowPlayingTrack, PlayerSnapshot } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";

const SEEK_STEP_SECONDS = 10;

const session = () =>
	"mediaSession" in navigator ? navigator.mediaSession : null;

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
	const target = session();
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
	const target = session();
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

	const { details } = useNowPlayingTrack({ enabled: live });

	const item = snapshot?.player?.activeItem;
	const playlistId = usePlayingPlaylist(item?.playlistGuid ?? null);
	const isPlaying = snapshot?.player?.playbackState === "playing";
	const album = details ? value(details.row, NOW_PLAYING_FIELD.album) : null;
	const artwork =
		live && item && item.index >= 0 && playlistId
			? artworkUrl(playlistId, item.index)
			: null;

	useEffect(() => {
		const target = session();
		if (!target) return;

		target.metadata = live
			? new MediaMetadata({
					title: track?.title ?? "",
					artist: track?.artist ?? "",
					album: album ?? "",
					// No `sizes` and no `type`: beefweb serves one image at whatever the file holds and has no thumbnail endpoint.
					artwork: artwork ? [{ src: artwork }] : [],
				})
			: null;
	}, [live, track?.title, track?.artist, album, artwork]);

	useEffect(() => {
		const target = session();
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
