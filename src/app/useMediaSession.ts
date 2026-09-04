import { useEffect } from "react";
import { audibleAt } from "@/domain/player/position";
import { useListener } from "@/domain/player/useListener";
import {
	usePlayPause,
	useSeek,
	useSeekBy,
	useTransport,
} from "@/domain/player/usePlayer";
import { value } from "@/domain/track/fields";
import { NOW_PLAYING_FIELD } from "@/features/now-playing/nowPlayingFields";
import { useNowPlayingTrack } from "@/features/now-playing/useNowPlayingTrack";
import { artworkUrl } from "@/shared/api/beefweb";
import type { NowPlayingTrack, PlayerSnapshot } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";

// The OS media controls: the Android lock screen, macOS Now Playing and the media keys, iOS Control Centre, Bluetooth buttons, Chrome's media hub.

// What a lock screen skips by when it names no offset of its own. The platform convention rather than Jean's keyboard nudge, which is five.
const SEEK_STEP_SECONDS = 10;

// Secure-context only, so an install served over plain HTTP has none of this and must go on working without it.
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

// Every action every time, so dropping the set is the same call as installing it and a handler can never outlive the session it belonged to.
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

// The OS interpolates from `playbackRate` between calls, so this is set on a track change, a seek and a transport press, never per frame.
function setPosition(duration: number, position: number) {
	const target = session();
	if (!target?.setPositionState) return;

	// A live stream's own clock runs past the track it is carrying, and a position beyond the duration is a TypeError in Chrome.
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
		// A duration the browser will not accept costs the scrubber, not the session.
	}
}

/** The values `useDocumentIdentity` derives, handed to the OS while this device is the one making the sound. */
export function useMediaSession(
	snapshot: PlayerSnapshot | null | undefined,
	track: NowPlayingTrack | null,
	hasTrack: boolean,
) {
	const listener = useListener();
	const playPause = usePlayPause().mutate;
	const transport = useTransport();
	const seek = useSeek().mutate;
	const seekBy = useSeekBy().mutate;

	const next = transport.next.mutate;
	const previous = transport.previous.mutate;
	const stopPlayer = transport.stop.mutate;
	const { disconnect } = listener;

	// A media session belongs to whatever is audible, so Jean has one exactly while the stream is attached here and none at all while it is only a remote.
	const live = listener.isOn && hasTrack;

	// Album is not in the update stream, which re-evaluates its expressions on every push. This is the now-playing screen's own read, shared through its cache.
	const { details } = useNowPlayingTrack({ enabled: live });

	const item = snapshot?.player?.activeItem;
	const isPlaying = snapshot?.player?.playbackState === "playing";
	const album = details ? value(details.row, NOW_PLAYING_FIELD.album) : null;
	const artwork =
		live && item && item.index >= 0
			? artworkUrl(item.playlistId, item.index)
			: null;

	useEffect(() => {
		const target = session();
		if (!target) return;

		target.metadata = live
			? new MediaMetadata({
					title: track?.title ?? "",
					artist: track?.artist ?? "",
					album: album ?? "",
					// No `sizes` and no `type`: beefweb serves one image at whatever the file holds and has no thumbnail endpoint, so there is nothing honest to claim.
					artwork: artwork ? [{ src: artwork }] : [],
				})
			: null;
	}, [live, track?.title, track?.artist, album, artwork]);

	useEffect(() => {
		const target = session();
		if (!target) return;
		target.playbackState = !live ? "none" : isPlaying ? "playing" : "paused";
	}, [live, isPlaying]);

	// Keyed on the snapshot rather than on the position inside it: it is replaced on every push, and the few pushes that move no clock cost one call each.
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
			// beefweb offers one toggle, and the OS sends `play` freely including when it already is playing, so each half checks before pressing it.
			play: () => {
				if (!isPlaying) playPause();
			},
			pause: () => {
				if (isPlaying) playPause();
			},
			previoustrack: () => previous(),
			nexttrack: () => next(),
			// Stopping from a lock screen means "I am done with this", so it ends the listening session too: a stopped player with the stream still attached holds the mute for audio nobody is hearing.
			stop: () => {
				stopPlayer();
				disconnect();
			},
			seekbackward: (action) =>
				seekBy(-(action.seekOffset ?? SEEK_STEP_SECONDS)),
			seekforward: (action) => seekBy(action.seekOffset ?? SEEK_STEP_SECONDS),
			// The patch behind this calls `beginSeek`, which holds the display at the target rather than letting it snap back to the audio still in the buffer.
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
