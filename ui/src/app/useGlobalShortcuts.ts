import { useAudibleVolume } from "@/domain/player/useListener";
import {
	KEY_SEEK_SECONDS,
	usePlaybackOrder,
	usePlayPause,
	usePrevious,
	useSeekBy,
	useTransport,
} from "@/domain/player/usePlayer";
import { useRateShortcut } from "@/domain/track/useRateShortcut";
import { useNowPlayingRating } from "@/features/now-playing/useNowPlayingRating";
import { SETTINGS_KEYBOARD } from "@/features/settings/SettingsDialog";
import { permitsPlaybackControl } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { SCOPE } from "@/shared/keyboard/keymap";
import { SHORTCUTS_KEYBOARD } from "@/shared/keyboard/ShortcutSheet";
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
	const { discovery } = useFooJean();
	const playPause = usePlayPause();
	const seekBy = useSeekBy();
	const previous = usePrevious();
	const transport = useTransport();
	const volume = useAudibleVolume();
	const playbackMode = usePlaybackOrder();

	useKeymap(
		SCOPE.global,
		{
			playPause: () => playPause.mutate(),
			nextTrack: () => transport.next.mutate(),
			previousTrack: () => previous(),
			stop: () => transport.stop.mutate(),
			seekBack: () => seekBy.mutate(-KEY_SEEK_SECONDS),
			seekForward: () => seekBy.mutate(KEY_SEEK_SECONDS),
			volumeUp: () => volume.up(),
			volumeDown: () => volume.down(),
			toggleMute: () => volume.toggleMute(),
			toggleShuffle: () => {
				if (playbackMode.canShuffle) playbackMode.toggleShuffle();
			},
		},
		{ enabled: permitsPlaybackControl(discovery) },
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
