import { useMemo, useSyncExternalStore } from "react";
import { libraryOrigin } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import {
	type WindowedLibrary,
	type WindowedState,
	windowedLibraryOf,
} from "./libraryWindows";

const NOTHING = () => () => {};

const EMPTY_STATE: WindowedState = {
	list: null,
	version: 0,
	runs: null,
	hasDiscs: false,
};

export function useLibraryWindows(isNeeded: boolean): {
	windowed: WindowedLibrary | null;
	state: WindowedState;
} {
	const { discovery } = useFooJean();
	const origin = libraryOrigin(discovery);

	const windowed = useMemo(
		() => (isNeeded && origin ? windowedLibraryOf(origin) : null),
		[isNeeded, origin],
	);

	const state = useSyncExternalStore(
		windowed ? windowed.subscribe : NOTHING,
		windowed ? windowed.state : () => EMPTY_STATE,
	);

	return { windowed, state };
}
