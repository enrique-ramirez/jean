import { useAudibleVolume } from "@/domain/player/useListener";
import { useCanControlPlayback } from "@/domain/player/usePlaybackControl";
import {
	KEY_SEEK_SECONDS,
	usePlayPause,
	usePrevious,
	useSeekBy,
	useTransport,
} from "@/domain/player/useTransport";
import { useRateShortcut } from "@/domain/track/useRateShortcut";
import { useNowPlayingRating } from "@/features/now-playing/useNowPlayingRating";
import {
	SETTINGS_KEYBOARD,
	SHORTCUTS_KEYBOARD,
} from "@/shared/keyboard/keyboardOwner";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";

interface ShellShortcuts {
	toggleSettings: () => void;
	toggleShortcuts: () => void;
	globalSearch: () => void;
	backToTop: () => void;
	openPalette: () => void;
	toggleSidebar: () => void;
	focusSidebar: () => void;
	toggleQueue: () => void;
	toggleNowPlaying: () => void;
	goToPlaying: () => void;
	toggleTheme: () => void;
}

function usePlaybackShortcuts() {
	const canControlPlayback = useCanControlPlayback();
	const playPause = usePlayPause();
	const seekBy = useSeekBy();
	const previous = usePrevious();
	const transport = useTransport();
	const volume = useAudibleVolume();

	useKeymap(
		SCOPE.global,
		{
			playPause: () => playPause.mutate(),
			nextTrack: () => transport.next.mutate(),
			previousTrack: () => previous(),
			stop: () => transport.stop.mutate(),
			seekBack: () => seekBy.mutate(-KEY_SEEK_SECONDS),
			seekForward: () => seekBy.mutate(KEY_SEEK_SECONDS),
		},
		{ enabled: canControlPlayback },
	);

	useKeymap(
		SCOPE.global,
		{
			volumeUp: () => volume.up(),
			volumeDown: () => volume.down(),
			toggleMute: () => volume.toggleMute(),
		},
		{ enabled: volume.canMove },
	);
}

export function useGlobalShortcuts({
	toggleSettings,
	toggleShortcuts,
	...shell
}: ShellShortcuts) {
	const { write: ratePlaying } = useNowPlayingRating();
	const rate = useRateShortcut(ratePlaying);

	useKeymap(
		SCOPE.global,
		{ openSettings: toggleSettings },
		{ owner: SETTINGS_KEYBOARD },
	);

	useKeymap(
		SCOPE.global,
		{ showShortcuts: toggleShortcuts },
		{ owner: SHORTCUTS_KEYBOARD },
	);

	usePlaybackShortcuts();

	useKeymap(SCOPE.global, {
		...shell,
		goBack: () => history.back(),
		rate0: () => rate(0),
		rate1: () => rate(1),
		rate2: () => rate(2),
		rate3: () => rate(3),
		rate4: () => rate(4),
		rate5: () => rate(5),
	});
}
